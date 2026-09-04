from datetime import datetime

from movie_showtime_aggregator.models import normalize_showtime


def raw_showtime(**overrides):
    raw = {
        "id": 123,
        "movieName": "Test Movie",
        "showDateTimeLocal": "2026-09-04T18:00:00",
        "runTime": 132,
        "premiumFormat": "Dolby Cinema",
        "purchaseUrl": "https://example.com/tickets",
        "isCanceled": False,
        "isSoldOut": False,
    }
    raw.update(overrides)
    return raw


def test_normalize_derives_actual_start_and_end():
    screening = normalize_showtime(
        raw_showtime(), theatre_name="AMC Test 10", preshow_minutes=25
    )

    assert screening is not None
    assert screening.advertised_start == datetime(2026, 9, 4, 18, 0)
    assert screening.actual_start == datetime(2026, 9, 4, 18, 25)
    assert screening.estimated_end == datetime(2026, 9, 4, 20, 37)
    assert screening.runtime_minutes == 132


def test_normalize_ignores_sold_out_or_canceled_showtimes():
    assert (
        normalize_showtime(
            raw_showtime(isSoldOut=True), theatre_name="AMC Test 10", preshow_minutes=25
        )
        is None
    )
    assert (
        normalize_showtime(
            raw_showtime(isCanceled=True), theatre_name="AMC Test 10", preshow_minutes=25
        )
        is None
    )


def test_normalize_ignores_missing_or_invalid_runtime():
    assert (
        normalize_showtime(
            raw_showtime(runTime=None), theatre_name="AMC Test 10", preshow_minutes=25
        )
        is None
    )
    assert (
        normalize_showtime(
            raw_showtime(runTime=0), theatre_name="AMC Test 10", preshow_minutes=25
        )
        is None
    )


def test_format_can_be_derived_from_attributes():
    screening = normalize_showtime(
        raw_showtime(premiumFormat="", attributes=[{"name": "IMAX with Laser"}]),
        theatre_name="AMC Test 10",
        preshow_minutes=25,
    )

    assert screening is not None
    assert screening.format == "IMAX"
