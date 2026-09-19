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
    drive_to_minutes: int = 0,
    drive_home_minutes: int = 0,
) -> Screening:
    actual_start = datetime(2026, 9, 19, hour, minute)
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
        drive_to_minutes=drive_to_minutes,
        drive_home_minutes=drive_home_minutes,
    )


def test_movie_day_totals_include_drives_from_and_back_home():
    screenings = [
        screening(
            "a",
            "Alpha",
            9,
            0,
            60,
            drive_to_minutes=15,
            drive_home_minutes=40,
        ),
        screening(
            "b",
            "Beta",
            10,
            30,
            60,
            theatre="Theater B",
            point=POINT_B,
            drive_to_minutes=30,
            drive_home_minutes=25,
        ),
    ]
    travel = {(POINT_A, POINT_B): 10}

    plan = plan_movie_day(screenings, ["Alpha", "Beta"], travel)

    itinerary = plan.itineraries[0]
    assert itinerary.showtime_ids == ("a", "b")
    assert itinerary.elapsed_minutes == 190
    assert itinerary.travel_minutes == 50
    assert itinerary.waiting_minutes == 20


def test_outbound_and_return_drives_participate_in_global_sorting():
    screenings = [
        screening(
            "early-long-outbound",
            "Alpha",
            9,
            0,
            60,
            drive_to_minutes=45,
            drive_home_minutes=0,
        ),
        screening(
            "later-short-trip",
            "Alpha",
            10,
            0,
            60,
            drive_to_minutes=5,
            drive_home_minutes=10,
        ),
    ]

    elapsed = plan_movie_day(screenings, ["Alpha"], {}, sort_by="elapsed")
    driving = plan_movie_day(screenings, ["Alpha"], {}, sort_by="driving")

    assert [item.showtime_ids for item in elapsed.itineraries] == [
        ("later-short-trip",),
        ("early-long-outbound",),
    ]
    assert [item.showtime_ids for item in driving.itineraries] == [
        ("later-short-trip",),
        ("early-long-outbound",),
    ]
    assert elapsed.itineraries[0].elapsed_minutes == 75
    assert elapsed.itineraries[0].travel_minutes == 15
