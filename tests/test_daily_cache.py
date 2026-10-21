from datetime import date

from movie_showtime_aggregator.config import Settings
from movie_showtime_aggregator.daily_cache import DailyCache
from movie_showtime_aggregator.location import GeoPoint
from movie_showtime_aggregator.service import ScreeningService


def test_daily_snapshots_survive_restart_and_expire_at_local_day_boundary(tmp_path):
    today = ["2026-10-21"]
    path = tmp_path / "daily.sqlite3"
    first = DailyCache(path, day=lambda: today[0])
    first.set("base", "2026-10-21|85004|25|50", [{"id": "1"}])

    second = DailyCache(path, day=lambda: today[0])
    assert second.get("base", "2026-10-21|85004|25|50") == [{"id": "1"}]
    assert second.status()["base_dates"] == 1

    today[0] = "2026-10-22"
    assert second.get("base", "2026-10-21|85004|25|50") is None
    second.set("responses", "85004|25|2026-10-22|a", {"count": 1})
    second.set("responses", "85005|25|2026-10-22|a", {"count": 2})
    second.delete_prefix("responses", "85004|25|")
    assert second.get("responses", "85004|25|2026-10-22|a") is None
    assert second.get("responses", "85005|25|2026-10-22|a") == {"count": 2}


class StaticLocator:
    def lookup_zip(self, zip_code):
        assert zip_code == "85004"
        return GeoPoint(0, 0)


class CountingClient:
    def __init__(self):
        self.calls = 0

    def fetch_showtimes(self, zip_code, show_date, *, page_limit=50):
        self.calls += 1
        assert (zip_code, page_limit) == ("85004", 50)
        return [
            {
                "id": "one",
                "movieName": "Test Movie",
                "theatreName": "AMC One",
                "chainName": "AMC",
                "theatreZip": "85004",
                "theatreLatitude": 0,
                "theatreLongitude": 0,
                "showDateTimeLocal": show_date.isoformat() + "T18:00:00",
                "runTime": 100,
            }
        ]


def test_service_reuses_persistent_base_and_force_replaces_it(tmp_path):
    cache = DailyCache(tmp_path / "daily.sqlite3")
    show_date = date(2026, 10, 21)
    first_client = CountingClient()
    first = ScreeningService(first_client, Settings(), locator=StaticLocator(), daily_cache=cache)
    assert first.get_screenings(show_date)[0].movie == "Test Movie"
    assert first_client.calls == 1

    second_client = CountingClient()
    restarted = ScreeningService(
        second_client, Settings(), locator=StaticLocator(), daily_cache=cache
    )
    assert restarted.get_screenings(show_date)[0].movie == "Test Movie"
    assert second_client.calls == 0

    restarted.refresh_date(show_date, zip_code="85004", radius_miles=25)
    assert second_client.calls == 1
    assert restarted.get_screenings(show_date, {"AMC": 0})[0].actual_start.hour == 18
