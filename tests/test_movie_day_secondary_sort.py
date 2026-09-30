from datetime import datetime, timedelta

import pytest

from movie_showtime_aggregator.models import Screening
from movie_showtime_aggregator.planner import plan_movie_day


def screening(
    showtime_id: str,
    movie: str,
    runtime: int,
    *,
    drive_to_minutes: int,
    drive_home_minutes: int,
) -> Screening:
    actual_start = datetime(2026, 9, 10, 9, 0)
    return Screening(
        showtime_id=showtime_id,
        movie=movie,
        theatre="Test Theater",
        chain="Test",
        format="Standard",
        advertised_start=actual_start,
        actual_start=actual_start,
        estimated_end=actual_start + timedelta(minutes=runtime),
        runtime_minutes=runtime,
        distance_miles=1,
        purchase_url="https://example.test/tickets",
        drive_to_minutes=drive_to_minutes,
        drive_home_minutes=drive_home_minutes,
    )


def test_secondary_sort_breaks_primary_elapsed_ties():
    higher_want_more_driving = screening(
        "alpha",
        "Alpha",
        80,
        drive_to_minutes=10,
        drive_home_minutes=10,
    )
    lower_want_less_driving = screening(
        "gamma",
        "Gamma",
        100,
        drive_to_minutes=0,
        drive_home_minutes=0,
    )
    screenings = [higher_want_more_driving, lower_want_less_driving]

    driving_tiebreak = plan_movie_day(
        screenings,
        ["Alpha", "Gamma"],
        {},
        target_movie_count=1,
        sort_by="elapsed",
        secondary_sort_by="driving",
    )
    want_tiebreak = plan_movie_day(
        screenings,
        ["Alpha", "Gamma"],
        {},
        target_movie_count=1,
        sort_by="elapsed",
        secondary_sort_by="want",
    )

    assert [itinerary.elapsed_minutes for itinerary in driving_tiebreak.itineraries] == [100, 100]
    assert driving_tiebreak.itineraries[0].movies == ("Gamma",)
    assert want_tiebreak.itineraries[0].movies == ("Alpha",)


def test_default_secondary_sort_preserves_existing_elapsed_then_driving_order():
    screenings = [
        screening("alpha", "Alpha", 80, drive_to_minutes=10, drive_home_minutes=10),
        screening("gamma", "Gamma", 100, drive_to_minutes=0, drive_home_minutes=0),
    ]

    plan = plan_movie_day(
        screenings,
        ["Alpha", "Gamma"],
        {},
        target_movie_count=1,
        sort_by="elapsed",
    )

    assert plan.secondary_sort_by == "driving"
    assert plan.itineraries[0].movies == ("Gamma",)


def test_secondary_sort_must_differ_from_primary():
    screenings = [
        screening("alpha", "Alpha", 80, drive_to_minutes=0, drive_home_minutes=0),
    ]

    with pytest.raises(ValueError, match="secondary_sort_by must differ"):
        plan_movie_day(
            screenings,
            ["Alpha"],
            {},
            sort_by="elapsed",
            secondary_sort_by="elapsed",
        )
