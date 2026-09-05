"""HTTP-level tests for the WSGI entrypoint."""

import io
import json
from datetime import datetime

import pytest

import movie_showtime_aggregator.api as api
from movie_showtime_aggregator.location import GeoPoint
from movie_showtime_aggregator.models import Screening
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
    monkeypatch.setattr(api, "_ZIP_LOCATOR", FakeZipLocator())


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


def test_health_is_ok():
    code, payload = call("/health")
    assert code == 200
    assert payload == {"status": "ok"}


def test_root_serves_table_dashboard():
    code, body = call("/")
    assert code == 200
    assert '<table id="screening-table">' in body
    assert '<tr id="screenings-head"></tr>' in body
    assert 'id="saved-view-select"' in body
    assert 'id="save-view"' in body
    assert 'href="/movies"' in body
    assert 'href="/settings"' in body
    assert 'id="column-menu"' in body
    assert 'class="filters"' not in body


def test_movie_selection_page_is_served():
    code, body = call("/movies")
    assert code == 200
    assert 'id="movie-grid"' in body
    assert 'id="movie-sort"' in body
    assert 'src="/movies.js"' in body


def test_settings_page_is_served():
    code, body = call("/settings")
    assert code == 200
    assert "Theater search" in body
    assert 'id="location-zip"' in body
    assert 'id="location-radius"' in body
    assert 'id="home-address"' in body
    assert 'id="amc-key"' in body
    assert 'id="amc-a-list"' in body
    assert 'id="omdb-key"' in body
    assert "Preview time by chain" in body
    assert 'src="/settings.js"' in body


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
    assert payload["count"] == 1
    assert payload["total_count"] == 2
    assert payload["preview_minutes_by_chain"] == {"AMC": 25}
    assert payload["location"] == {"zip_code": "85281", "radius_miles": 15}
    assert payload["screenings"][0]["movie"] == "Movie A"
    assert payload["screenings"][0]["distance_miles"] == 4.2
    assert payload["facets"]["chains"] == ["AMC", "Harkins Theatres"]
    assert payload["preferences"]["amc_vendor_key_set"] is False


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


def test_empty_settings_cookie_keeps_preview_times_unknown(monkeypatch):
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
