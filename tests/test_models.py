from datetime import datetime

from movie_showtime_aggregator.models import apply_preview_minutes, normalize_showtime


def raw_showtime(**overrides):
    raw = {
        "id": 123,
        "movieName": "Test Movie",
        "theatreName": "AMC Test 10",
        "chainName": "AMC",
        "showDateTimeLocal": "2026-09-04T18:00:00",
        "runTime": 132,
        "distanceMiles": 4.2,
        "premiumFormat": "Dolby Cinema",
        "purchaseUrl": "https://example.com/tickets",
        "isCanceled": False,
        "isSoldOut": False,
        "isExpired": False,
    }
    raw.update(overrides)
    return raw


def test_normalize_leaves_actual_start_and_end_unknown():
    screening = normalize_showtime(raw_showtime())

    assert screening is not None
    assert screening.showtime_id == "123"
    assert screening.theatre == "AMC Test 10"
    assert screening.chain == "AMC"
    assert screening.advertised_start == datetime(2026, 9, 4, 18, 0)
    assert screening.actual_start is None
    assert screening.estimated_end is None
    assert screening.runtime_minutes == 132
    assert screening.distance_miles == 4.2


def test_preview_minutes_derives_actual_start_and_end():
    screening = normalize_showtime(raw_showtime())
    assert screening is not None

    calculated = apply_preview_minutes(screening, 25)

    assert calculated.actual_start == datetime(2026, 9, 4, 18, 25)
    assert calculated.estimated_end == datetime(2026, 9, 4, 20, 37)


def test_zero_preview_minutes_is_a_valid_configuration():
    screening = normalize_showtime(raw_showtime())
    assert screening is not None

    calculated = apply_preview_minutes(screening, 0)

    assert calculated.actual_start == screening.advertised_start


def test_unknown_runtime_keeps_end_unknown_after_preview_is_configured():
    screening = normalize_showtime(raw_showtime(runTime=0))
    assert screening is not None

    calculated = apply_preview_minutes(screening, 25)

    assert calculated.actual_start == datetime(2026, 9, 4, 18, 25)
    assert calculated.runtime_minutes is None
    assert calculated.estimated_end is None


def test_normalize_ignores_unavailable_showtimes():
    for flag in ("isSoldOut", "isCanceled", "isExpired"):
        assert normalize_showtime(raw_showtime(**{flag: True})) is None


def test_format_can_be_derived_from_attributes():
    screening = normalize_showtime(
        raw_showtime(premiumFormat="", attributes=[{"name": "IMAX with Laser"}])
    )

    assert screening is not None
    assert screening.format == "IMAX"
