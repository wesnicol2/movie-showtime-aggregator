from datetime import datetime, timedelta

from movie_showtime_aggregator.location import GeoPoint
from movie_showtime_aggregator.models import Screening
from movie_showtime_aggregator.planner import plan_movie_day

POINT_A = GeoPoint(33.45, -112.07)
POINT_B = GeoPoint(33.50, -112.10)


def screening(
    showtime_id: str,
    movie: str,
    hour: int,
    minute: int,
    runtime_minutes: int,
    *,
    theatre: str = "Theater A",
    point: GeoPoint = POINT_A,
    drive_home_minutes: int | None = 0,
) -> Screening:
    actual_start = datetime(2026, 9, 30, hour, minute)
    return Screening(
        showtime_id=showtime_id,
        movie=movie,
        theatre=theatre,
        chain="Test Chain",
        format="Standard",
        advertised_start=actual_start - timedelta(minutes=20),
        actual_start=actual_start,
        estimated_end=actual_start + timedelta(minutes=runtime_minutes),
        runtime_minutes=runtime_minutes,
        distance_miles=1,
        purchase_url="https://example.test/tickets",
        theatre_latitude=point.latitude,
        theatre_longitude=point.longitude,
        drive_to_minutes=0,
        drive_home_minutes=drive_home_minutes,
    )


def test_latest_end_requires_arriving_home_by_deadline():
    screenings = [
        screening("too-late-home", "Alpha", 16, 0, 30, drive_home_minutes=40),
        screening("home-in-time", "Alpha", 16, 10, 30, drive_home_minutes=15),
    ]

    plan = plan_movie_day(
        screenings,
        ["Alpha"],
        {},
        latest_end=datetime(2026, 9, 30, 17, 0),
    )

    assert plan.total_itineraries == 1
    assert [itinerary.showtime_ids for itinerary in plan.itineraries] == [("home-in-time",)]


def test_home_by_requires_known_return_travel_time():
    plan = plan_movie_day(
        [screening("unknown-home", "Alpha", 16, 0, 30, drive_home_minutes=None)],
        ["Alpha"],
        {},
        latest_end=datetime(2026, 9, 30, 17, 0),
    )

    assert plan.total_itineraries == 0


def test_home_by_check_is_applied_to_final_stop_not_every_intermediate_showing():
    screenings = [
        screening(
            "far-first",
            "Alpha",
            16,
            0,
            30,
            theatre="Theater A",
            point=POINT_A,
            drive_home_minutes=60,
        ),
        screening(
            "near-home-final",
            "Beta",
            16,
            40,
            10,
            theatre="Theater B",
            point=POINT_B,
            drive_home_minutes=5,
        ),
    ]

    plan = plan_movie_day(
        screenings,
        ["Alpha", "Beta"],
        {(POINT_A, POINT_B): 5},
        latest_end=datetime(2026, 9, 30, 17, 0),
    )

    assert plan.total_itineraries == 1
    assert plan.itineraries[0].showtime_ids == ("far-first", "near-home-final")
