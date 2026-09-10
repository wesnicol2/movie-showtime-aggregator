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


def test_planner_globally_sorts_feasible_itineraries_by_minimum_elapsed_time():
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
        ("a-morning", "b-midday"),
        ("b-early", "a-morning"),
        ("b-midday", "a-night"),
        ("a-morning", "b-night"),
        ("b-early", "a-night"),
    ]
    shortest = plan.itineraries[0]
    assert shortest.elapsed_minutes == 240
    assert shortest.travel_minutes == 15
    assert shortest.legs[0].gap_minutes == 20
    assert shortest.waiting_minutes == 5
    assert "openstreetmap.org/directions" in shortest.legs[0].route_source_url


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
    assert all(len(itinerary.movies) == 3 for itinerary in plan.itineraries)
    assert plan.itineraries[0].showtime_ids == ("a-night", "b-night", "c-night")


def test_planner_paginates_in_global_rank_order_without_losing_exact_count():
    screenings = [
        screening("a-1", "Alpha", 9, 0, 60),
        screening("a-2", "Alpha", 12, 0, 60),
        screening("b-1", "Beta", 10, 0, 60),
        screening("b-2", "Beta", 13, 0, 60),
    ]

    plan = plan_movie_day(screenings, ["Alpha", "Beta"], {}, offset=1, limit=1)

    assert plan.total_itineraries == 4
    assert [itinerary.showtime_ids for itinerary in plan.itineraries] == [("a-2", "b-2")]
    assert plan.to_dict()["has_more"] is True


def test_minimum_driving_sort_can_prefer_a_longer_same_theater_day():
    screenings = [
        screening("a", "Alpha", 9, 0, 60),
        screening("b-fast", "Beta", 10, 30, 60, theatre="Theater B", point=POINT_B),
        screening("b-local", "Beta", 12, 0, 60),
    ]
    travel = {(POINT_A, POINT_B): 15, (POINT_B, POINT_A): 18}

    plan = plan_movie_day(screenings, ["Alpha", "Beta"], travel, sort_by="driving")

    assert [itinerary.showtime_ids for itinerary in plan.itineraries] == [
        ("a", "b-local"),
        ("a", "b-fast"),
    ]
    assert plan.itineraries[0].travel_minutes == 0
    assert plan.itineraries[0].elapsed_minutes > plan.itineraries[1].elapsed_minutes


def test_target_movie_count_allows_each_itinerary_to_drop_different_movies():
    screenings = [
        screening("a", "Alpha", 9, 0, 60),
        screening("b", "Beta", 10, 10, 60),
        screening("c", "Gamma", 18, 0, 60),
    ]

    plan = plan_movie_day(
        screenings,
        ["Alpha", "Beta", "Gamma"],
        {},
        target_movie_count=2,
        sort_by="elapsed",
    )

    assert plan.target_movie_count == 2
    assert plan.total_itineraries == 3
    assert plan.itineraries[0].movies == ("Alpha", "Beta")
    assert plan.itineraries[0].dropped_movies == ("Gamma",)
    assert {itinerary.dropped_movies for itinerary in plan.itineraries} == {
        ("Alpha",),
        ("Beta",),
        ("Gamma",),
    }


def test_start_and_end_bounds_apply_to_actual_start_and_calculated_end():
    screenings = [
        screening("early", "Alpha", 8, 30, 60),
        screening("middle", "Beta", 10, 0, 60),
        screening("late", "Gamma", 16, 30, 90),
    ]

    plan = plan_movie_day(
        screenings,
        ["Alpha", "Beta", "Gamma"],
        {},
        target_movie_count=1,
        earliest_start=datetime(2026, 9, 10, 9, 0),
        latest_end=datetime(2026, 9, 10, 17, 0),
    )

    assert plan.total_itineraries == 1
    assert plan.itineraries[0].movies == ("Beta",)
    assert plan.missing_movies == ("Alpha", "Gamma")


def test_same_theater_needs_no_coordinates_or_route_lookup():
    screenings = [
        screening("a", "Alpha", 9, 0, 60, point=None),
        screening("b", "Beta", 10, 0, 60, point=None),
    ]

    plan = plan_movie_day(screenings, ["Alpha", "Beta"], {})

    assert plan.total_itineraries == 1
    assert plan.itineraries[0].travel_minutes == 0


def test_unknown_preview_or_runtime_only_blocks_required_cardinality():
    alpha = screening("a", "Alpha", 9, 0, 60)
    beta = replace(screening("b", "Beta", 11, 0, 60), actual_start=None, estimated_end=None)

    all_required = plan_movie_day([alpha, beta], ["Alpha", "Beta"], {})
    flexible = plan_movie_day([alpha, beta], ["Alpha", "Beta"], {}, target_movie_count=1)

    assert all_required.total_itineraries == 0
    assert all_required.missing_movies == ("Beta",)
    assert all_required.unplannable_showings == 1
    assert flexible.total_itineraries == 1
    assert flexible.itineraries[0].movies == ("Alpha",)
    assert flexible.itineraries[0].dropped_movies == ("Beta",)
