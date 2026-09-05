from datetime import datetime

from movie_showtime_aggregator.amc import (
    AMCShowtime,
    AMCTheatre,
    _a_list_eligibility,
    _has_no_a_list,
    _parse_showtime,
    _seat_percentage,
    _ticket_price,
    match_showtime,
)
from movie_showtime_aggregator.location import GeoPoint


def test_adult_ticket_price_includes_reported_tax():
    assert (
        _ticket_price(
            [
                {"priceType": "Child", "price": 8, "tax": 1},
                {"type": "ADULT", "price": 12.5, "tax": 1.25},
            ]
        )
        == 13.75
    )


def test_a_list_eligibility_is_unknown_without_official_attributes():
    assert _a_list_eligibility(None) is None
    assert _a_list_eligibility([]) is True
    assert _a_list_eligibility([{"code": "NOALIST"}]) is False


def test_noalist_attribute_is_detected_from_official_showtime_attributes():
    assert _has_no_a_list([{"code": "NOALIST", "name": "Excluded from A-List"}]) is True
    assert _has_no_a_list([{"code": "IMAX", "name": "IMAX"}]) is False


def test_seat_percentage_uses_v3_can_reserve_seats():
    payload = {
        "rows": 1,
        "columns": 4,
        "seats": [
            {"type": "CanReserve", "available": True},
            {"type": "CanReserve", "available": False},
            {"type": "NotASeat", "available": True},
            {"type": "Wheelchair", "available": True},
        ],
    }

    assert _seat_percentage(payload) == 50.0


def test_showtime_prefers_performance_number_for_seating_lookup():
    theatre = AMCTheatre(1, "AMC Test 10", GeoPoint(33.5, -112.1))
    parsed = _parse_showtime(
        {
            "id": 26250458,
            "performanceNumber": 97027,
            "theatreId": 1,
            "sortableTitleName": "Test Movie",
            "showDateTimeLocal": "2026-09-05T19:00:00",
            "attributes": [],
        },
        {1: theatre},
    )

    assert parsed is not None
    assert parsed.performance_id == 97027
    assert parsed.a_list_eligible is True


def test_match_showtime_uses_title_time_and_theatre_location():
    fandango_point = GeoPoint(33.5, -112.1)
    matching = AMCShowtime(
        performance_id=10,
        theatre=AMCTheatre(1, "AMC Arizona Center 24", GeoPoint(33.5, -112.1)),
        movie_name="Test Movie",
        start_local=datetime(2026, 9, 5, 19, 0),
        ticket_price=12,
        a_list_eligible=True,
        purchase_url="https://www.amctheatres.com/",
    )
    wrong = AMCShowtime(
        performance_id=11,
        theatre=AMCTheatre(2, "AMC Far Away", GeoPoint(34.5, -113.1)),
        movie_name="Test Movie",
        start_local=datetime(2026, 9, 5, 19, 0),
        ticket_price=12,
        a_list_eligible=True,
        purchase_url="",
    )

    result = match_showtime(
        "Test Movie",
        "AMC Arizona Center 24",
        datetime(2026, 9, 5, 19, 0),
        fandango_point,
        [wrong, matching],
    )

    assert result == matching
