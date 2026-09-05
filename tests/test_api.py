"""HTTP-level tests for the WSGI entrypoint."""

import json
from datetime import datetime

import movie_showtime_aggregator.api as api
from movie_showtime_aggregator.models import Screening


def call(
    path: str,
    method: str = "GET",
    query: str = "",
    cookie: str = "",
) -> tuple[int, dict | str]:
    captured: dict[str, object] = {}

    def start_response(status: str, headers: list[tuple[str, str]]) -> None:
        captured["status"] = status
        captured["headers"] = headers

    environ = {"PATH_INFO": path, "REQUEST_METHOD": method, "QUERY_STRING": query}
    if cookie:
        environ["HTTP_COOKIE"] = cookie

    body = b"".join(api.application(environ, start_response))
    code = int(str(captured["status"]).split(" ", 1)[0])
    content_type = dict(captured["headers"])["Content-Type"]
    if str(content_type).startswith("application/json"):
        return code, json.loads(body)
    return code, body.decode("utf-8")


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
        purchase_url="https://example.com/tickets",
    )


class StubService:
    def __init__(self, screenings):
        self.screenings = screenings
        self.preview_minutes_by_chain = None

    def get_screenings(self, show_date, preview_minutes_by_chain=None):
        self.preview_minutes_by_chain = preview_minutes_by_chain
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
    assert 'href="/settings"' in body
    assert 'id="column-menu"' in body
    assert 'class="filters"' not in body


def test_settings_page_is_served():
    code, body = call("/settings")
    assert code == 200
    assert "Preview time by chain" in body
    assert 'id="save-settings"' in body
    assert 'src="/settings.js"' in body


def test_unknown_path_is_404():
    code, payload = call("/nope")
    assert code == 404
    assert payload["path"] == "/nope"


def test_write_methods_are_rejected():
    code, _ = call("/health", method="POST")
    assert code == 405


def test_api_passes_chain_previews_and_returns_chain_facets(monkeypatch):
    screenings = [
        sample_screening(),
        sample_screening(movie="Movie B", format_name="IMAX", chain="Harkins Theatres"),
    ]
    service = StubService(screenings)
    monkeypatch.setattr(api, "_SERVICE", service)

    code, payload = call(
        "/api/screenings",
        query="date=2026-09-04&preview=AMC%3A25&movie=Movie+A&end_by=21%3A00",
    )

    assert code == 200
    assert service.preview_minutes_by_chain == {"AMC": 25}
    assert payload["count"] == 1
    assert payload["total_count"] == 2
    assert payload["preview_minutes_by_chain"] == {"AMC": 25}
    assert payload["screenings"][0]["movie"] == "Movie A"
    assert payload["facets"]["chains"] == ["AMC", "Harkins Theatres"]


def test_settings_cookie_takes_precedence_over_preview_query(monkeypatch):
    service = StubService([sample_screening()])
    monkeypatch.setattr(api, "_SERVICE", service)

    code, payload = call(
        "/api/screenings",
        query="date=2026-09-04&preview=AMC%3A10",
        cookie='movie_preview_minutes=%7B%22AMC%22%3A25%7D',
    )

    assert code == 200
    assert service.preview_minutes_by_chain == {"AMC": 25}
    assert payload["preview_minutes_by_chain"] == {"AMC": 25}


def test_empty_settings_cookie_keeps_preview_times_unknown(monkeypatch):
    service = StubService([sample_screening()])
    monkeypatch.setattr(api, "_SERVICE", service)

    code, _ = call(
        "/api/screenings",
        query="date=2026-09-04&preview=AMC%3A10",
        cookie="movie_preview_minutes=%7B%7D",
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


def test_invalid_time_is_400(monkeypatch):
    monkeypatch.setattr(api, "_SERVICE", StubService([sample_screening()]))

    code, payload = call("/api/screenings", query="date=2026-09-04&end_by=nope")

    assert code == 400
    assert "Invalid time" in payload["error"]
