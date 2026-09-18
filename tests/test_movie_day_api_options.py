import io
import json
from datetime import datetime, timedelta

import movie_showtime_aggregator.api as api
from movie_showtime_aggregator.models import Screening


def call_movie_day(payload: dict) -> tuple[int, dict]:
    captured: dict[str, object] = {}

    def start_response(status: str, headers: list[tuple[str, str]]) -> None:
        captured["status"] = status
        captured["headers"] = headers

    encoded = json.dumps(payload).encode("utf-8")
    environ = {
        "PATH_INFO": "/api/movie-day",
        "REQUEST_METHOD": "POST",
        "CONTENT_LENGTH": str(len(encoded)),
        "CONTENT_TYPE": "application/json",
        "wsgi.input": io.BytesIO(encoded),
    }
    body = b"".join(api.application(environ, start_response))
    return int(str(captured["status"]).split(" ", 1)[0]), json.loads(body)


def screening(showtime_id: str, movie: str, hour: int) -> Screening:
    actual_start = datetime(2026, 9, 10, hour, 0)
    return Screening(
        showtime_id=showtime_id,
        movie=movie,
        theatre="Test Theater",
        chain="Test",
        format="Standard",
        advertised_start=actual_start,
        actual_start=actual_start,
        estimated_end=actual_start + timedelta(minutes=60),
        runtime_minutes=60,
        distance_miles=1,
        purchase_url="https://example.test/tickets",
    )


class StubService:
    def __init__(self, screenings: list[Screening]) -> None:
        self.screenings = screenings

    def get_screenings(self, *args, **kwargs) -> list[Screening]:
        return list(self.screenings)


class NoTravelRouter:
    def travel_matrix(self, points):
        return {}


def test_movie_day_api_threads_cardinality_time_bounds_and_sort(monkeypatch):
    monkeypatch.setattr(
        api,
        "_SERVICE",
        StubService(
            [
                screening("alpha", "Alpha", 9),
                screening("beta", "Beta", 11),
                screening("gamma", "Gamma", 18),
            ]
        ),
    )
    monkeypatch.setattr(api, "_ROUTER", NoTravelRouter())

    code, payload = call_movie_day(
        {
            "date": "2026-09-10",
            "movies": ["Alpha", "Beta", "Gamma"],
            "showtime_ids": ["alpha", "beta", "gamma"],
            "target_movie_count": 2,
            "earliest_start": "2026-09-10T09:00:00",
            "latest_end": "2026-09-10T17:00:00",
            "sort_by": "driving",
            "minimum_buffer_minutes": 0,
        }
    )

    assert code == 200
    assert payload["target_movie_count"] == 2
    assert payload["sort_by"] == "driving"
    assert payload["earliest_start"] == "2026-09-10T09:00"
    assert payload["latest_end"] == "2026-09-10T17:00"
    assert payload["plannable_movie_count"] == 2
    assert payload["missing_movies"] == ["Gamma"]
    assert payload["itineraries"][0]["movies"] == ["Alpha", "Beta"]
    assert payload["itineraries"][0]["dropped_movies"] == ["Gamma"]


def test_movie_day_api_threads_rank_order_pins_and_want_sort(monkeypatch):
    monkeypatch.setattr(
        api,
        "_SERVICE",
        StubService(
            [
                screening("alpha", "Alpha", 9),
                screening("beta", "Beta", 11),
                screening("gamma", "Gamma", 18),
            ]
        ),
    )
    monkeypatch.setattr(api, "_ROUTER", NoTravelRouter())

    code, payload = call_movie_day(
        {
            "date": "2026-09-10",
            "movies": ["Gamma", "Alpha", "Beta"],
            "required_movies": ["Beta"],
            "showtime_ids": ["alpha", "beta", "gamma"],
            "target_movie_count": 2,
            "sort_by": "want",
            "minimum_buffer_minutes": 0,
        }
    )

    assert code == 200
    assert payload["selected_movies"] == ["Gamma", "Alpha", "Beta"]
    assert payload["required_movies"] == ["Beta"]
    assert payload["sort_by"] == "want"
    assert payload["total_itineraries"] == 2
    assert payload["itineraries"][0]["movies"] == ["Beta", "Gamma"]
    assert payload["itineraries"][0]["want_score"] == 4
    assert all("Beta" in itinerary["movies"] for itinerary in payload["itineraries"])


def test_movie_day_api_rejects_unknown_sort(monkeypatch):
    monkeypatch.setattr(api, "_SERVICE", StubService([screening("alpha", "Alpha", 9)]))
    monkeypatch.setattr(api, "_ROUTER", NoTravelRouter())

    code, payload = call_movie_day(
        {
            "date": "2026-09-10",
            "movies": ["Alpha"],
            "showtime_ids": ["alpha"],
            "sort_by": "fastest-looking",
        }
    )

    assert code == 400
    assert "sort_by" in payload["error"]
