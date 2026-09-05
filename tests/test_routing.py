from movie_showtime_aggregator.location import GeoPoint
from movie_showtime_aggregator.routing import _parse_duration_matrix, _parse_geocode_payload


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
