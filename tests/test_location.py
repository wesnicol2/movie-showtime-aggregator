import pytest

from movie_showtime_aggregator.location import GeoPoint, _parse_zip_payload, distance_miles


def test_parse_zip_payload_returns_coordinates():
    payload = {"places": [{"latitude": "33.451", "longitude": "-112.071"}]}

    point = _parse_zip_payload(payload, "85004")

    assert point == GeoPoint(33.451, -112.071)


def test_distance_miles_is_zero_for_same_point():
    point = GeoPoint(33.45, -112.07)

    assert distance_miles(point, point) == 0


def test_one_degree_longitude_at_equator_is_about_69_miles():
    distance = distance_miles(GeoPoint(0, 0), GeoPoint(0, 1))

    assert distance == pytest.approx(69.09, abs=0.1)


def test_zip_payload_without_coordinates_is_rejected():
    with pytest.raises(ValueError, match="usable coordinates"):
        _parse_zip_payload({"places": [{}]}, "85004")
