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


def test_last_location_profile_persists_across_startups_and_calendar_days(tmp_path):
    day = ["2026-10-21"]
    path = tmp_path / "daily.sqlite3"
    original = DailyCache(path, day=lambda: day[0])
    original.remember_profile("85020", 30, {"AMC": 15})
    day[0] = "2026-10-22"
    restarted = DailyCache(path, day=lambda: day[0])
    assert restarted.last_profile() == ("85020", 30, {"AMC": 15})
    restarted.remember_profile("85004", 25, {})
    assert original.last_profile() == ("85004", 25, {})


def test_refresh_start_time_survives_restart_and_reports_next_run(tmp_path):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    path = tmp_path / "daily.sqlite3"
    now = datetime(2026, 10, 21, 8, 30, tzinfo=ZoneInfo("America/Phoenix"))
    original = DailyCache(path)
    assert original.last_refresh_started() is None
    original.mark_refresh_started(now)
    restarted = DailyCache(path)
    assert restarted.last_refresh_started() == now
    status = restarted.status()
    assert status["refresh_interval_hours"] == 4
    assert status["last_refresh_started_at"] == now.isoformat()
    assert status["next_refresh_at"] == "2026-10-21T12:30:00-07:00"


def test_replacement_of_date_response_is_targeted(tmp_path):
    cache = DailyCache(tmp_path / "cache.sqlite3")
    cache.set("responses", "85004|25|2026-10-21|old", {"count": 12})
    cache.set("responses", "85004|25|2026-10-22|untouched", {"count": 4})
    cache.replace_prefix(
        "responses",
        "85004|25|2026-10-21|",
        "85004|25|2026-10-21|new",
        {"count": 15},
    )
    assert cache.get("responses", "85004|25|2026-10-21|old") is None
    assert cache.get("responses", "85004|25|2026-10-21|new") == {"count": 15}
    assert cache.get("responses", "85004|25|2026-10-22|untouched") == {"count": 4}


def test_interrupted_refresh_can_be_retried_after_restart(tmp_path):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    now = datetime(2026, 10, 21, 12, 0, tzinfo=ZoneInfo("America/Phoenix"))
    path = tmp_path / "cache.sqlite3"
    cache = DailyCache(path)
    cache.mark_refresh_started(now)
    assert DailyCache(path).status()["interrupted_refresh"] is True
    cache.mark_refresh_completed(now + timedelta(minutes=5))
    assert DailyCache(path).status()["interrupted_refresh"] is False
    cache.mark_refresh_started(now + timedelta(hours=4))
    assert DailyCache(path).status()["interrupted_refresh"] is True
