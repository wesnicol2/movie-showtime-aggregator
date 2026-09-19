from movie_showtime_aggregator.location import GeoPoint
from movie_showtime_aggregator.routing import (
    OsrmRouter,
    _parse_all_pairs_duration_matrix,
    _parse_duration_matrix,
    _parse_geocode_payload,
)


def test_geocode_payload_parses_matched_home_address():
    result = _parse_geocode_payload(
        [{"lat": "33.45", "lon": "-112.07", "display_name": "123 Main St, Phoenix, AZ"}]
    )

    assert result.point == GeoPoint(33.45, -112.07)
    assert result.display_name == "123 Main St, Phoenix, AZ"


def test_duration_matrix_returns_outbound_and_return_minutes():
    destination = GeoPoint(33.5, -112.1)
    result = _parse_duration_matrix(
        {
            "code": "Ok",
            "durations": [
                [0, 901],
                [1201, 0],
            ],
        },
        [destination],
    )

    assert result[destination] == (16, 21)


def test_all_pairs_matrix_preserves_directional_drive_times():
    first = GeoPoint(33.45, -112.07)
    second = GeoPoint(33.50, -112.10)

    result = _parse_all_pairs_duration_matrix(
        {"code": "Ok", "durations": [[0, 901], [1201, 0]]},
        [first, second],
    )

    assert result[(first, second)] == 16
    assert result[(second, first)] == 21


def test_router_fetches_one_all_theater_matrix_and_reuses_directed_legs(monkeypatch):
    first = GeoPoint(33.45, -112.07)
    second = GeoPoint(33.50, -112.10)
    third = GeoPoint(33.55, -112.15)
    router = OsrmRouter()
    calls = []

    def fake_fetch(points):
        calls.append(points)
        return {
            "code": "Ok",
            "durations": [[0, 60, 120], [90, 0, 60], [150, 90, 0]],
        }

    monkeypatch.setattr(router, "_fetch_table", fake_fetch)

    first_result = router.travel_matrix([first, second, third])
    second_result = router.travel_matrix([third, second, first])

    assert len(calls) == 1
    assert first_result[(first, third)] == 2
    assert second_result[(third, first)] == 3
