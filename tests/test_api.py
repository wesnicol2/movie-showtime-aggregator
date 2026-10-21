"""HTTP-level tests for the WSGI entrypoint."""

import io
import json
import re
from dataclasses import replace
from datetime import date, datetime, timedelta

import pytest

import movie_showtime_aggregator.api as api
from movie_showtime_aggregator.daily_cache import DailyCache
from movie_showtime_aggregator.experience import ExperienceDeviation
from movie_showtime_aggregator.location import GeoPoint
from movie_showtime_aggregator.models import Screening
from movie_showtime_aggregator.provider_cache import ProviderCache
from movie_showtime_aggregator.routing import GeocodedAddress
from movie_showtime_aggregator.storage import SettingsStore


def call(
    path: str,
    method: str = "GET",
    query: str = "",
    cookie: str = "",
    json_body: dict | None = None,
) -> tuple[int, dict | str]:
    captured: dict[str, object] = {}

    def start_response(status: str, headers: list[tuple[str, str]]) -> None:
        captured["status"] = status
        captured["headers"] = headers

    environ = {"PATH_INFO": path, "REQUEST_METHOD": method, "QUERY_STRING": query}
    if cookie:
        environ["HTTP_COOKIE"] = cookie
    if json_body is not None:
        encoded = json.dumps(json_body).encode("utf-8")
        environ["CONTENT_LENGTH"] = str(len(encoded))
        environ["CONTENT_TYPE"] = "application/json"
        environ["wsgi.input"] = io.BytesIO(encoded)

    body = b"".join(api.application(environ, start_response))
    code = int(str(captured["status"]).split(" ", 1)[0])
    content_type = dict(captured["headers"])["Content-Type"]
    if str(content_type).startswith("application/json"):
        return code, json.loads(body)
    return code, body.decode("utf-8")


class FakeZipLocator:
    def lookup_zip(self, zip_code):
        return GeoPoint(33.45, -112.07)


@pytest.fixture(autouse=True)
def isolated_shared_settings(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "_STORE", SettingsStore(tmp_path / "common" / "settings.json"))
    monkeypatch.setattr(
        api,
        "_PROVIDER_CACHE",
        ProviderCache(tmp_path / "common" / "provider-cache.sqlite3"),
    )
    monkeypatch.setattr(api, "_ZIP_LOCATOR", FakeZipLocator())
    monkeypatch.setattr(api, "_DAILY_CACHE", DailyCache(tmp_path / "data" / "daily.sqlite3"))
    api._OMDB_CLIENTS.clear()
    api._AMC_CLIENTS.clear()


def sample_screening(movie="Movie A", format_name="Standard", chain="AMC"):
    return Screening(
        showtime_id="1",
        movie=movie,
        theatre=f"{chain} Test 10",
        chain=chain,
        format=format_name,
        advertised_start=datetime(2026, 9, 4, 18, 0),
        actual_start=datetime(2026, 9, 4, 18, 25) if chain == "AMC" else None,
        estimated_end=datetime(2026, 9, 4, 20, 25) if chain == "AMC" else None,
        runtime_minutes=120,
        distance_miles=4.2,
        purchase_url="https://example.com/tickets",
    )


class StubService:
    def __init__(self, screenings):
        self.screenings = screenings
        self.preview_minutes_by_chain = None
        self.location = None

    def get_screenings(
        self,
        show_date,
        preview_minutes_by_chain=None,
        *,
        zip_code=None,
        radius_miles=None,
    ):
        self.preview_minutes_by_chain = preview_minutes_by_chain
        self.location = (zip_code, radius_miles)
        return list(self.screenings)


def test_local_poster_route_has_binary_type_caching_and_head(monkeypatch, tmp_path):
    from movie_showtime_aggregator.poster_cache import PosterCache

    cache = PosterCache(tmp_path / "posters")
    cache.path.mkdir(parents=True)
    digest = "a" * 64
    binary = b"\xff\xd8\xffposter\xff\xd9"
    (cache.path / digest).write_bytes(binary)
    monkeypatch.setattr(api, "_POSTER_CACHE", cache)
    headers = {}

    def capture(status, fields):
        headers.update(dict(fields))
        headers["status"] = status

    url = f"/api/posters/{digest}"
    assert b"".join(api.application({"PATH_INFO": url, "REQUEST_METHOD": "GET"}, capture)) == binary
    assert headers["Content-Type"] == "image/jpeg"
    assert headers["Cache-Control"] == "public, max-age=31536000, immutable"
    assert b"".join(api.application({"PATH_INFO": url, "REQUEST_METHOD": "HEAD"}, capture)) == b""
    assert call("/api/posters/" + "b" * 64)[0] == 404
    assert call("/api/posters/../../settings.json")[0] == 404
    assert call(url, method="POST")[0] == 405


def test_health_is_ok():
    code, payload = call("/health")
    assert code == 200
    assert payload["status"] == "ok"
    assert set(payload["build"]) == {
        "commit",
        "commit_short",
        "source",
        "dirty",
        "image_tag",
        "branch",
        "commit_at",
        "built_at",
    }


def test_spa_routes_serve_the_same_react_shell():
    root_code, root_body = call("/")
    movies_code, movies_body = call("/movies")
    settings_code, settings_body = call("/settings")
    plan_code, plan_body = call("/plan")
    showtimes_code, showtimes_body = call("/showtimes")

    assert root_code == movies_code == settings_code == plan_code == showtimes_code == 200
    assert root_body == movies_body == settings_body == plan_body == showtimes_body
    assert '<div id="root"></div>' in root_body
    assert "/assets/" in root_body
    assert "movie decision workstation" not in root_body.lower()


def test_vite_asset_referenced_by_shell_is_served():
    _, body = call("/")
    match = re.search(r'src="(/assets/[^"]+\.js)"', body)
    assert match is not None

    code, asset = call(match.group(1))
    assert code == 200
    assert isinstance(asset, str)
    assert asset


def test_legacy_frontend_routes_are_removed():
    for path in ("/app.js", "/movies.js", "/settings.js", "/styles.css"):
        code, payload = call(path)
        assert code == 404
        assert payload["path"] == path


def test_shared_settings_api_never_returns_saved_secret_values():
    code, payload = call(
        "/api/settings",
        method="POST",
        json_body={
            "amc_vendor_key": "amc-secret",
            "omdb_api_key": "omdb-secret",
            "amc_a_list": True,
        },
    )

    assert code == 200
    assert payload["amc_vendor_key_set"] is True
    assert payload["omdb_api_key_set"] is True
    assert payload["amc_a_list"] is True
    assert payload["provider_usage"]["omdb"]["published_daily_limit"] == 1000
    assert payload["provider_usage"]["amc"]["published_daily_limit"] is None
    assert "amc-secret" not in str(payload)
    assert "omdb-secret" not in str(payload)
    assert api._STORE.load().amc_vendor_key == "amc-secret"
    assert api._STORE.load().omdb_api_key == "omdb-secret"


def test_home_address_is_geocoded_before_persisting(monkeypatch):
    class FakeGeocoder:
        def geocode(self, address):
            assert address == "123 Main St, Phoenix, AZ"
            return GeocodedAddress(GeoPoint(33.45, -112.07), "123 Main St, Phoenix, Arizona")

    monkeypatch.setattr(api, "_GEOCODER", FakeGeocoder())

    code, payload = call(
        "/api/settings",
        method="POST",
        json_body={"home_address": "123 Main St, Phoenix, AZ"},
    )

    assert code == 200
    assert payload["home_configured"] is True
    assert payload["home_display_name"] == "123 Main St, Phoenix, Arizona"
    assert api._STORE.load().home_latitude == 33.45


def test_unknown_path_is_404():
    code, payload = call("/nope")
    assert code == 404
    assert payload["path"] == "/nope"


def test_write_methods_are_rejected_outside_settings():
    code, _ = call("/health", method="POST")
    assert code == 405


def test_api_passes_chain_previews_location_and_returns_chain_facets(monkeypatch):
    screenings = [
        sample_screening(),
        sample_screening(movie="Movie B", format_name="IMAX", chain="Harkins Theatres"),
    ]
    service = StubService(screenings)
    monkeypatch.setattr(api, "_SERVICE", service)

    code, payload = call(
        "/api/screenings",
        query=("date=2026-09-04&preview=AMC%3A25&movie=Movie+A&end_by=21%3A00&zip=85281&radius=15"),
    )

    assert code == 200
    assert service.preview_minutes_by_chain == {"AMC": 25}
    assert service.location == ("85281", 15)
    assert payload["enrichment_enabled"] is True
    assert payload["count"] == 1
    assert payload["total_count"] == 2
    assert payload["preview_minutes_by_chain"] == {"AMC": 25}
    assert payload["location"] == {"zip_code": "85281", "radius_miles": 15}
    assert payload["screenings"][0]["movie"] == "Movie A"
    assert payload["screenings"][0]["distance_miles"] == 4.2
    assert payload["facets"]["chains"] == ["AMC", "Harkins Theatres"]
    assert payload["preferences"]["amc_vendor_key_set"] is False


def test_api_can_skip_optional_enrichment(monkeypatch):
    service = StubService([sample_screening()])
    monkeypatch.setattr(api, "_SERVICE", service)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("optional enrichment should not run")

    monkeypatch.setattr(api, "enrich_movie_metadata", fail_if_called)
    monkeypatch.setattr(api, "enrich_amc_details", fail_if_called)
    monkeypatch.setattr(api, "enrich_travel_times", fail_if_called)

    code, payload = call(
        "/api/screenings",
        query="date=2026-09-04&zip=85004&radius=25&enrich=0",
    )

    assert code == 200
    assert payload["enrichment_enabled"] is False
    assert payload["count"] == 1
    assert payload["facets"]["chains"] == ["AMC"]


def test_movie_day_api_revalidates_showtimes_and_returns_feasible_paths(monkeypatch):
    alpha = replace(
        sample_screening(movie="Alpha"),
        showtime_id="alpha",
        theatre_latitude=33.45,
        theatre_longitude=-112.07,
    )
    beta_start = datetime(2026, 9, 4, 20, 45)
    beta = replace(
        sample_screening(movie="Beta", chain="Harkins"),
        showtime_id="beta",
        advertised_start=beta_start - timedelta(minutes=20),
        actual_start=beta_start,
        estimated_end=beta_start + timedelta(minutes=100),
        runtime_minutes=100,
        theatre_latitude=33.50,
        theatre_longitude=-112.10,
    )
    monkeypatch.setattr(api, "_SERVICE", StubService([alpha, beta]))

    class FakeRouter:
        def travel_matrix(self, points):
            assert len(points) == 2
            return {(points[0], points[1]): 15, (points[1], points[0]): 18}

    monkeypatch.setattr(api, "_ROUTER", FakeRouter())

    code, payload = call(
        "/api/movie-day",
        method="POST",
        cookie="movie_preview_minutes=%7B%22AMC%22%3A25%2C%22Harkins%22%3A20%7D",
        json_body={
            "date": "2026-09-04",
            "movies": ["Alpha", "Beta"],
            "showtime_ids": ["alpha", "beta", "not-canonical"],
            "minimum_buffer_minutes": 5,
        },
    )

    assert code == 200
    assert payload["total_itineraries"] == 1
    assert payload["itineraries"][0]["showtime_ids"] == ["alpha", "beta"]
    assert payload["itineraries"][0]["travel_minutes"] == 15
    assert payload["minimum_buffer_minutes"] == 5
    assert payload["routing_available"] is True


def test_movie_day_api_falls_back_to_same_theater_paths_when_routing_fails(monkeypatch):
    from movie_showtime_aggregator.routing import RoutingError

    alpha = replace(sample_screening(movie="Alpha"), showtime_id="alpha")
    beta = replace(
        sample_screening(movie="Beta"),
        showtime_id="beta",
        actual_start=datetime(2026, 9, 4, 20, 30),
        estimated_end=datetime(2026, 9, 4, 22, 30),
    )
    monkeypatch.setattr(api, "_SERVICE", StubService([alpha, beta]))

    class FailedRouter:
        def travel_matrix(self, points):
            raise RoutingError("offline")

    monkeypatch.setattr(api, "_ROUTER", FailedRouter())

    code, payload = call(
        "/api/movie-day",
        method="POST",
        json_body={"movies": ["Alpha", "Beta"], "showtime_ids": ["alpha", "beta"]},
    )

    assert code == 200
    assert payload["routing_available"] is False
    assert payload["total_itineraries"] == 1


def test_movie_day_api_rejects_an_empty_movie_selection():
    code, payload = call(
        "/api/movie-day",
        method="POST",
        json_body={"movies": [], "showtime_ids": []},
    )

    assert code == 400
    assert "movies must contain at least one value" in payload["error"]


def test_invalid_enrichment_flag_is_400(monkeypatch):
    monkeypatch.setattr(api, "_SERVICE", StubService([sample_screening()]))

    code, payload = call("/api/screenings", query="date=2026-09-04&enrich=maybe")

    assert code == 400
    assert "enrich must be true or false" in payload["error"]


def test_settings_cookie_takes_precedence_over_preview_query(monkeypatch):
    service = StubService([sample_screening()])
    monkeypatch.setattr(api, "_SERVICE", service)
    settings_cookie = "movie_preview_minutes=%7B%22AMC%22%3A25%7D"

    code, payload = call(
        "/api/screenings",
        query="date=2026-09-04&preview=AMC%3A10",
        cookie=settings_cookie,
    )

    assert code == 200
    assert service.preview_minutes_by_chain == {"AMC": 25}
    assert payload["preview_minutes_by_chain"] == {"AMC": 25}


def test_location_cookie_takes_precedence_over_query(monkeypatch):
    service = StubService([sample_screening()])
    monkeypatch.setattr(api, "_SERVICE", service)
    location_cookie = "movie_location=%7B%22zipCode%22%3A%2285004%22%2C%22radiusMiles%22%3A30%7D"

    code, payload = call(
        "/api/screenings",
        query="date=2026-09-04&zip=85281&radius=5",
        cookie=location_cookie,
    )

    assert code == 200
    assert service.location == ("85004", 30)
    assert payload["location"] == {"zip_code": "85004", "radius_miles": 30}


def test_empty_settings_cookie_keeps_preview_overrides_empty(monkeypatch):
    service = StubService([sample_screening()])
    monkeypatch.setattr(api, "_SERVICE", service)
    settings_cookie = "movie_preview_minutes=%7B%7D"

    code, _ = call(
        "/api/screenings",
        query="date=2026-09-04&preview=AMC%3A10",
        cookie=settings_cookie,
    )

    assert code == 200
    assert service.preview_minutes_by_chain == {}


def test_zero_preview_minutes_is_accepted():
    assert api._parse_preview_minutes(["AMC:0"]) == {"AMC": 0}


def test_invalid_preview_minutes_are_400(monkeypatch):
    monkeypatch.setattr(api, "_SERVICE", StubService([sample_screening()]))

    code, payload = call("/api/screenings", query="date=2026-09-04&preview=AMC%3A181")

    assert code == 400
    assert "between 0 and 180" in payload["error"]


def test_invalid_location_is_400(monkeypatch):
    monkeypatch.setattr(api, "_SERVICE", StubService([sample_screening()]))

    code, payload = call("/api/screenings", query="date=2026-09-04&zip=Phoenix&radius=25")

    assert code == 400
    assert "five-digit US ZIP" in payload["error"]


def test_invalid_radius_is_400(monkeypatch):
    monkeypatch.setattr(api, "_SERVICE", StubService([sample_screening()]))

    code, payload = call("/api/screenings", query="date=2026-09-04&zip=85004&radius=101")

    assert code == 400
    assert "between 1 and 100" in payload["error"]


def test_invalid_time_is_400(monkeypatch):
    monkeypatch.setattr(api, "_SERVICE", StubService([sample_screening()]))

    code, payload = call("/api/screenings", query="date=2026-09-04&end_by=nope")

    assert code == 400
    assert "Invalid time" in payload["error"]


def test_experience_deviation_settings_persist_and_apply_to_screenings(monkeypatch):
    imax = replace(
        sample_screening(movie="Premium", format_name="IMAX"),
        experience_deviations=(
            ExperienceDeviation(
                id="format:imax",
                label="IMAX",
                category="presentation",
                polarity="positive",
                score_delta=1,
            ),
        ),
    )
    monkeypatch.setattr(api, "_SERVICE", StubService([imax]))

    code, settings = call(
        "/api/settings",
        method="POST",
        json_body={
            "experience_deviations": [
                {"id": "format:imax", "enabled": True, "score_delta": 3},
            ]
        },
    )

    assert code == 200
    imax_setting = next(
        item for item in settings["experience_deviations"] if item["id"] == "format:imax"
    )
    assert imax_setting["enabled"] is True
    assert imax_setting["score_delta"] == 3
    assert api._STORE.load().experience_deviation_impacts["format:imax"] == 3

    code, payload = call("/api/screenings", query="date=2026-09-04&enrich=0")
    assert code == 200
    assert payload["screenings"][0]["experience_score_adjustment"] == 3
    assert payload["screenings"][0]["experience_deviations"][0]["score_delta"] == 3

    class NoTravelRouter:
        def travel_matrix(self, points):
            return {}

    monkeypatch.setattr(api, "_ROUTER", NoTravelRouter())
    code, movie_day = call(
        "/api/movie-day",
        method="POST",
        json_body={
            "date": "2026-09-04",
            "movies": ["Premium"],
            "showtime_ids": ["1"],
            "sort_by": "want",
        },
    )
    assert code == 200
    assert movie_day["itineraries"][0]["base_want_score"] == 1
    assert movie_day["itineraries"][0]["experience_adjustment"] == 3
    assert movie_day["itineraries"][0]["want_score"] == 4

    code, _ = call(
        "/api/settings",
        method="POST",
        json_body={
            "experience_deviations": [
                {"id": "format:imax", "enabled": False, "score_delta": 3},
            ]
        },
    )
    assert code == 200

    code, payload = call("/api/screenings", query="date=2026-09-04&enrich=0")
    assert code == 200
    assert payload["screenings"][0]["experience_score_adjustment"] == 0
    assert payload["screenings"][0]["experience_deviations"] == []


def test_future_availability_counts_distinct_days_and_showtimes(monkeypatch):
    class Service:
        def get_screenings(self, show_date, _previews, *, zip_code, radius_miles):
            assert (zip_code, radius_miles) == ("85004", 25)
            if show_date == date(2026, 10, 21):
                return [
                    replace(
                        sample_screening("Alpha"),
                        showtime_id="a1",
                        advertised_start=datetime(2026, 10, 21, 12),
                    ),
                    replace(
                        sample_screening("Alpha"),
                        showtime_id="a2",
                        advertised_start=datetime(2026, 10, 21, 20),
                    ),
                ]
            if show_date == date(2026, 10, 23):
                return [
                    replace(
                        sample_screening("Alpha"),
                        showtime_id="a3",
                        advertised_start=datetime(2026, 10, 23, 19),
                    )
                ]
            return []

    monkeypatch.setattr(api, "_SERVICE", Service())
    status, payload = call("/api/movie-availability", query="after=2026-10-20")
    assert status == 200
    assert payload["after_date"] == "2026-10-20"
    assert payload["window_end"] == "2026-11-03"
    assert len(payload["checked_dates"]) == 14
    assert payload["unavailable_dates"] == []
    assert payload["movies"]["Alpha"] == {
        "scheduled_days": 2,
        "showtime_count": 3,
        "last_scheduled_date": "2026-10-23",
    }


def test_future_availability_is_explicitly_partial(monkeypatch):
    class Service:
        def get_screenings(self, show_date, _previews, *, zip_code, radius_miles):
            if show_date == date(2026, 10, 22):
                raise ValueError("provider unavailable")
            return []

    monkeypatch.setattr(api, "_SERVICE", Service())
    status, payload = call("/api/movie-availability", query="after=2026-10-20")
    assert status == 200
    assert payload["unavailable_dates"] == ["2026-10-22"]
    assert payload["movies"] == {}


def test_future_availability_requires_reference_date():
    status, payload = call("/api/movie-availability")
    assert status == 400
    assert "after" in payload["error"]


def test_screening_response_uses_daily_snapshot_and_invalidates_by_region(monkeypatch):
    service = StubService([sample_screening("First Movie")])
    monkeypatch.setattr(api, "_SERVICE", service)
    first_code, first = call("/api/screenings", query="date=2026-10-21&enrich=0")
    assert first_code == 200
    assert first["screenings"][0]["movie"] == "First Movie"

    service.screenings = [sample_screening("Changed Movie")]
    second_code, second = call("/api/screenings", query="date=2026-10-21&enrich=0")
    assert second_code == 200
    assert second["screenings"][0]["movie"] == "First Movie"

    api._DAILY_CACHE.delete_prefix("responses", "85004|25|2026-10-21|")
    _, refreshed = call("/api/screenings", query="date=2026-10-21&enrich=0")
    assert refreshed["screenings"][0]["movie"] == "Changed Movie"


def test_cache_status_and_refresh_routes_check_methods(monkeypatch):
    class StubCacheService:
        def __init__(self):
            self.days = []

        def refresh_date(self, show_date, *, zip_code, radius_miles):
            self.days.append((show_date, zip_code, radius_miles))

        def get_screenings(
            self, show_date, preview_minutes_by_chain=None, *, zip_code=None, radius_miles=None
        ):
            return [sample_screening()]

    service = StubCacheService()
    monkeypatch.setattr(api, "_SERVICE", service)
    assert call("/api/cache/refresh")[0] == 405
    code, status = call("/api/cache/status")
    assert code == 200
    assert status["base_dates"] == 0
    assert status["day"]


def test_four_hour_background_refresh_due_and_rollover():
    from zoneinfo import ZoneInfo

    phx = ZoneInfo("America/Phoenix")
    first = datetime(2026, 10, 21, 8, 0, tzinfo=phx)
    assert api._scheduled_refresh_due(first, None, 0)
    assert not api._scheduled_refresh_due(
        first + timedelta(hours=3, minutes=59), first, 15,
        completed=first + timedelta(minutes=1)
    )
    assert api._scheduled_refresh_due(
        first + timedelta(hours=4), first, 15, completed=first + timedelta(minutes=1)
    )
    assert api._scheduled_refresh_due(
        datetime(2026, 10, 22, 0, 5, tzinfo=phx),
        datetime(2026, 10, 21, 23, 58, tzinfo=phx),
        0,
        completed=datetime(2026, 10, 21, 23, 59, tzinfo=phx),
    )
    assert not api._scheduled_refresh_due(
        datetime(2026, 10, 22, 0, 5, tzinfo=phx),
        datetime(2026, 10, 21, 23, 58, tzinfo=phx),
        15,
        completed=datetime(2026, 10, 21, 23, 59, tzinfo=phx),
    )


def test_scheduler_tick_uses_remembered_location_without_browser(monkeypatch):
    from zoneinfo import ZoneInfo

    now = datetime(2026, 10, 21, 12, tzinfo=ZoneInfo("America/Phoenix"))
    api._DAILY_CACHE.remember_profile("85020", 30, {"AMC": 0})
    calls = []
    monkeypatch.setattr(api, "_start_refresh", lambda *args: calls.append(args))
    assert api._scheduled_refresh_tick(now)
    assert calls == [("85020", 30, {"AMC": 0})]
    api._DAILY_CACHE.mark_refresh_started(now)
    api._DAILY_CACHE.mark_refresh_completed(now + timedelta(minutes=1))
    assert not api._scheduled_refresh_tick(now + timedelta(hours=1))


def test_rebuilding_response_keeps_existing_snapshot_until_ready(monkeypatch):
    service = StubService([sample_screening("Old Movie")])
    monkeypatch.setattr(api, "_SERVICE", service)
    query = "date=2026-10-21&enrich=0"
    assert call("/api/screenings", query=query)[1]["screenings"][0]["movie"] == "Old Movie"
    service.screenings = [sample_screening("New Movie")]
    assert call("/api/screenings", query=query)[1]["screenings"][0]["movie"] == "Old Movie"

    codes = []
    body = b"".join(
        api._screenings_response(
            {
                "REQUEST_METHOD": "GET",
                "QUERY_STRING": query,
                "MOVIE_CACHE_REBUILD": True,
            },
            lambda status, _headers: codes.append(status),
            "GET",
        )
    )
    assert codes == ["200 OK"]
    assert b'"New Movie"' in body
    assert call("/api/screenings", query=query)[1]["screenings"][0]["movie"] == "New Movie"


def test_unfinished_refresh_is_due_after_restart():
    from zoneinfo import ZoneInfo

    phoenix = ZoneInfo("America/Phoenix")
    start = datetime(2026, 10, 21, 8, tzinfo=phoenix)
    current = start + timedelta(minutes=10)
    assert api._scheduled_refresh_due(current, start, 15, completed=None)
    assert api._scheduled_refresh_due(
        current, start, 15, completed=start - timedelta(hours=3)
    )
    assert not api._scheduled_refresh_due(
        current, start, 15, completed=start + timedelta(minutes=5)
    )
