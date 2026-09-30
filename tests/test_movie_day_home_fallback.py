import io
import json
from datetime import datetime, timedelta

import movie_showtime_aggregator.api as api
from movie_showtime_aggregator.location import GeoPoint
from movie_showtime_aggregator.models import Screening
from movie_showtime_aggregator.storage import PersistentSettings

THEATRE_POINT = GeoPoint(33.45, -112.07)


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


def screening() -> Screening:
    actual_start = datetime(2026, 9, 30, 16, 0)
    return Screening(
        showtime_id="alpha",
        movie="Alpha",
        theatre="Test Theater",
        chain="Test",
        format="Standard",
        advertised_start=actual_start,
        actual_start=actual_start,
        estimated_end=actual_start + timedelta(minutes=30),
        runtime_minutes=30,
        distance_miles=1,
        purchase_url="https://example.test/tickets",
        theatre_latitude=THEATRE_POINT.latitude,
        theatre_longitude=THEATRE_POINT.longitude,
    )


class StubService:
    def get_screenings(self, *args, **kwargs) -> list[Screening]:
        return [screening()]


class StubStore:
    def __init__(self, settings: PersistentSettings) -> None:
        self.settings = settings

    def load(self) -> PersistentSettings:
        return self.settings


class StubRouter:
    def travel_matrix(self, points):
        return {}

    def travel_minutes(self, origin, destinations):
        return dict.fromkeys(destinations, (5, 20))


def request_payload() -> dict:
    return {
        "date": "2026-09-30",
        "movies": ["Alpha"],
        "showtime_ids": ["alpha"],
        "target_movie_count": 1,
        "latest_end": "2026-09-30T16:45:00",
        "sort_by": "elapsed",
    }


def test_movie_day_without_home_falls_back_to_movie_end(monkeypatch):
    monkeypatch.setattr(api, "_SERVICE", StubService())
    monkeypatch.setattr(api, "_STORE", StubStore(PersistentSettings()))
    monkeypatch.setattr(api, "_ROUTER", StubRouter())

    code, payload = call_movie_day(request_payload())

    assert code == 200
    assert payload["total_itineraries"] == 1
    assert payload["itineraries"][0]["ends_at"] == "2026-09-30T16:30"


def test_movie_day_with_home_includes_return_travel(monkeypatch):
    monkeypatch.setattr(api, "_SERVICE", StubService())
    monkeypatch.setattr(
        api,
        "_STORE",
        StubStore(
            PersistentSettings(
                home_address="Home",
                home_display_name="Home",
                home_latitude=33.44,
                home_longitude=-112.06,
            )
        ),
    )
    monkeypatch.setattr(api, "_ROUTER", StubRouter())

    code, payload = call_movie_day(request_payload())

    assert code == 200
    assert payload["total_itineraries"] == 0
