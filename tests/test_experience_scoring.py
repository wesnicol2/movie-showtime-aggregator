from datetime import datetime, timedelta

from movie_showtime_aggregator.experience import ExperienceDeviation
from movie_showtime_aggregator.location import GeoPoint
from movie_showtime_aggregator.models import Screening
from movie_showtime_aggregator.planner import plan_movie_day

POINT = GeoPoint(33.45, -112.07)


def screening(
    showtime_id: str,
    movie: str,
    hour: int,
    minute: int,
    *,
    deviations: tuple[ExperienceDeviation, ...] = (),
) -> Screening:
    actual_start = datetime(2026, 10, 1, hour, minute)
    return Screening(
        showtime_id=showtime_id,
        movie=movie,
        theatre="Test Theater",
        chain="Test Chain",
        format="Standard",
        advertised_start=actual_start - timedelta(minutes=20),
        actual_start=actual_start,
        estimated_end=actual_start + timedelta(minutes=60),
        runtime_minutes=60,
        distance_miles=1,
        purchase_url="https://example.test/tickets",
        theatre_latitude=POINT.latitude,
        theatre_longitude=POINT.longitude,
        drive_home_minutes=0,
        experience_deviations=deviations,
    )


def deviation(label: str, delta: int) -> ExperienceDeviation:
    return ExperienceDeviation(
        id=label.casefold().replace(" ", "-"),
        label=label,
        category="presentation" if delta > 0 else "seating",
        polarity="positive" if delta > 0 else "negative",
        score_delta=delta,
    )


def test_want_sort_prefers_positive_experience_even_when_it_takes_longer():
    screenings = [
        screening("alpha", "Alpha", 9, 0),
        screening("beta-standard", "Beta", 10, 10),
        screening("beta-imax", "Beta", 12, 0, deviations=(deviation("IMAX", 1),)),
    ]

    plan = plan_movie_day(screenings, ["Alpha", "Beta"], {}, sort_by="want")

    assert [item.showtime_ids for item in plan.itineraries] == [
        ("alpha", "beta-imax"),
        ("alpha", "beta-standard"),
    ]
    assert [item.base_want_score for item in plan.itineraries] == [3, 3]
    assert [item.experience_adjustment for item in plan.itineraries] == [1, 0]
    assert [item.want_score for item in plan.itineraries] == [4, 3]


def test_negative_experience_reduces_itinerary_want_score_by_one():
    screenings = [
        screening("alpha", "Alpha", 9, 0),
        screening(
            "beta",
            "Beta",
            10,
            10,
            deviations=(deviation("No Signature Recliners", -1),),
        ),
    ]

    itinerary = plan_movie_day(screenings, ["Alpha", "Beta"], {}, sort_by="want").itineraries[0]

    assert itinerary.base_want_score == 3
    assert itinerary.experience_adjustment == -1
    assert itinerary.want_score == 2
    assert itinerary.to_dict()["experience_adjustment"] == -1


def test_positive_and_negative_deviations_can_cancel_without_disappearing_from_screening():
    mixed = screening(
        "beta-mixed",
        "Beta",
        10,
        10,
        deviations=(
            deviation("IMAX", 1),
            deviation("No Signature Recliners", -1),
        ),
    )

    itinerary = plan_movie_day(
        [screening("alpha", "Alpha", 9, 0), mixed],
        ["Alpha", "Beta"],
        {},
        sort_by="want",
    ).itineraries[0]

    assert mixed.experience_score_adjustment == 0
    assert len(mixed.experience_deviations) == 2
    assert itinerary.base_want_score == itinerary.want_score
    assert itinerary.experience_adjustment == 0
