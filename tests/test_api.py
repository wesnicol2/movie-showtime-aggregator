"""HTTP-level tests for the WSGI entrypoint."""

import json
from datetime import datetime

import movie_showtime_aggregator.api as api
from movie_showtime_aggregator.models import Screening


def call(path: str, method: str = "GET", query: str = "") -> tuple[int, dict | str]:
    captured: dict[str, object] = {}

    def start_response(status: str, headers: list[tuple[str, str]]) -> None:
        captured["status"] = status
        captured["headers"] = headers

    body = b"".join(
        api.application(
            {"PATH_INFO": path, "REQUEST_METHOD": method, "QUERY_STRING": query},
            start_response,
        )
    )
    code = int(str(captured["status"]).split(" ", 1)[0])
    content_type = dict(captured["headers"])["Content-Type"]
    if str(content_type).startswith("application/json"):
        return code, json.loads(body)
    return code, body.decode("utf-8")


def sample_screening(movie="Movie A", format_name="Standard"):
    return Screening(
        showtime_id=1,
        movie=movie,
        theatre="AMC Test 10",
        format=format_name,
        advertised_start=datetime(2026, 9, 4, 18, 0),
        actual_start=datetime(2026, 9, 4, 18, 25),
        estimated_end=datetime(2026, 9, 4, 20, 25),
        runtime_minutes=120,
        purchase_url="https://example.com/tickets",
    )


class StubService:
    def __init__(self, screenings):
        self.screenings = screenings

    def get_screenings(self, show_date):
        return list(self.screenings)


def test_health_is_ok():
    code, payload = call("/health")
    assert code == 200
    assert payload == {"status": "ok"}


def test_root_serves_dashboard():
    code, body = call("/")
    assert code == 200
    assert "Movie options, minus the noise." in body
    assert "Ends by" in body


def test_unknown_path_is_404():
    code, payload = call("/nope")
    assert code == 404
    assert payload["path"] == "/nope"


def test_write_methods_are_rejected():
    code, _ = call("/health", method="POST")
    assert code == 405


def test_api_applies_filters_and_returns_facets(monkeypatch):
    screenings = [sample_screening(), sample_screening(movie="Movie B", format_name="IMAX")]
    monkeypatch.setattr(api, "_SERVICE", StubService(screenings))

    code, payload = call(
        "/api/screenings",
        query="date=2026-09-04&movie=Movie+B&format=IMAX&end_by=21%3A00",
    )

    assert code == 200
    assert payload["count"] == 1
    assert payload["total_count"] == 2
    assert payload["screenings"][0]["movie"] == "Movie B"
    assert payload["facets"]["movies"] == ["Movie A", "Movie B"]


def test_invalid_time_is_400(monkeypatch):
    monkeypatch.setattr(api, "_SERVICE", StubService([sample_screening()]))

    code, payload = call("/api/screenings", query="date=2026-09-04&end_by=nope")

    assert code == 400
    assert "Invalid time" in payload["error"]
