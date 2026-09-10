from dataclasses import replace
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
    runtime: int,
    *,
    theatre: str = "Theater A",
    point: GeoPoint | None = POINT_A,
) -> Screening:
    actual_start = datetime(2026, 9, 10, hour, minute)
    return Screening(
        showtime_id=showtime_id,
        movie=movie,
        theatre=theatre,
        chain="Test Chain",
        format="Standard",
        advertised_start=actual_start - timedelta(minutes=20),
        actual_start=actual_start,
        estimated_end=actual_start + timedelta(minutes=runtime),
        runtime_minutes=runtime,
        distance_miles=1,
        purchase_url="https://example.test/tickets",
        theatre_latitude=point.latitude if point else None,
        theatre_longitude=point.longitude if point else None,
    )


def test_planner_enumerates_each_feasible_time_order_with_directed_travel():
    screenings = [
        screening("a-morning", "Alpha", 9, 0, 120),
        screening("a-night", "Alpha", 20, 0, 120),
        screening("b-early", "Beta", 6, 0, 120, theatre="Theater B", point=POINT_B),
        screening("b-midday", "Beta", 11, 20, 100, theatre="Theater B", point=POINT_B),
        screening("b-night", "Beta", 20, 30, 100, theatre="Theater B", point=POINT_B),
    ]
    travel = {(POINT_A, POINT_B): 15, (POINT_B, POINT_A): 18}

    plan = plan_movie_day(screenings, ["Alpha", "Beta"], travel, minimum_buffer_minutes=5)

    assert plan.total_itineraries == 5
    assert [itinerary.showtime_ids for itinerary in plan.itineraries] == [
        ("b-early", "a-morning"),
        ("b-early", "a-night"),
        ("a-morning", "b-midday"),
        ("a-morning", "b-night"),
        ("b-midday", "a-night"),
    ]
    midday = plan.itineraries[2]
    assert midday.travel_minutes == 15
    assert midday.legs[0].gap_minutes == 20
    assert midday.waiting_minutes == 5
    assert "openstreetmap.org/directions" in midday.legs[0].route_source_url


def test_three_movie_day_combines_morning_and_night_showings():
    screenings = [
        screening("a-morning", "Alpha", 9, 0, 60),
        screening("a-night", "Alpha", 18, 0, 60),
        screening("b-morning", "Beta", 10, 10, 60),
        screening("b-night", "Beta", 19, 10, 60),
        screening("c-night", "Gamma", 20, 20, 60),
    ]

    plan = plan_movie_day(screenings, ["Alpha", "Beta", "Gamma"], {})

    assert plan.total_itineraries == 4
    assert [itinerary.showtime_ids for itinerary in plan.itineraries] == [
        ("a-morning", "b-morning", "c-night"),
        ("a-morning", "b-night", "c-night"),
        ("b-morning", "a-night", "c-night"),
        ("a-night", "b-night", "c-night"),
    ]


def test_planner_paginates_without_losing_the_exact_combination_count():
    screenings = [
        screening("a-1", "Alpha", 9, 0, 60),
        screening("a-2", "Alpha", 12, 0, 60),
        screening("b-1", "Beta", 10, 0, 60),
        screening("b-2", "Beta", 13, 0, 60),
    ]

    plan = plan_movie_day(screenings, ["Alpha", "Beta"], {}, offset=1, limit=1)

    assert plan.total_itineraries == 4
    assert [itinerary.showtime_ids for itinerary in plan.itineraries] == [("a-1", "b-2")]
    assert plan.to_dict()["has_more"] is True


def test_same_theater_needs_no_coordinates_or_route_lookup():
    screenings = [
        screening("a", "Alpha", 9, 0, 60, point=None),
        screening("b", "Beta", 10, 0, 60, point=None),
    ]

    plan = plan_movie_day(screenings, ["Alpha", "Beta"], {})

    assert plan.total_itineraries == 1
    assert plan.itineraries[0].travel_minutes == 0


def test_unknown_preview_or_runtime_explains_why_a_movie_cannot_be_planned():
    alpha = screening("a", "Alpha", 9, 0, 60)
    beta = replace(screening("b", "Beta", 11, 0, 60), actual_start=None, estimated_end=None)

    plan = plan_movie_day([alpha, beta], ["Alpha", "Beta"], {})

    assert plan.total_itineraries == 0
    assert plan.missing_movies == ("Beta",)
    assert plan.unplannable_showings == 1
