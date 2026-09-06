from __future__ import annotations

import json
import math
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

ZIP_API_BASE_URL = "https://api.zippopotam.us"
EARTH_RADIUS_MILES = 3958.7613


class LocationError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class GeoPoint:
    latitude: float
    longitude: float


class ZipLocator:
    def __init__(self, *, timeout_seconds: int = 10) -> None:
        self.timeout_seconds = timeout_seconds
        self._cache: dict[str, GeoPoint] = {}
        self._lock = threading.Lock()

    def lookup_zip(self, zip_code: str) -> GeoPoint:
        with self._lock:
            cached = self._cache.get(zip_code)
            if cached is not None:
                return cached

        url = f"{ZIP_API_BASE_URL}/us/{urllib.parse.quote(zip_code)}"
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "movie-showtime-aggregator/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise ValueError(f"ZIP code {zip_code} was not found") from exc
            raise LocationError(f"ZIP lookup returned HTTP {exc.code}") from exc
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            json.JSONDecodeError,
        ) as exc:
            raise LocationError(f"ZIP lookup failed: {exc}") from exc

        point = _parse_zip_payload(payload, zip_code)
        with self._lock:
            self._cache[zip_code] = point
        return point


def _parse_zip_payload(payload: object, zip_code: str) -> GeoPoint:
    if not isinstance(payload, dict):
        raise LocationError("ZIP lookup returned an unexpected response")

    places = payload.get("places")
    if not isinstance(places, list):
        raise LocationError("ZIP lookup did not return places")

    coordinates: list[GeoPoint] = []
    for place in places:
        if not isinstance(place, dict):
            continue
        try:
            latitude = float(place["latitude"])
            longitude = float(place["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if -90 <= latitude <= 90 and -180 <= longitude <= 180:
            coordinates.append(GeoPoint(latitude, longitude))

    if not coordinates:
        raise ValueError(f"ZIP code {zip_code} did not include usable coordinates")

    return GeoPoint(
        latitude=sum(point.latitude for point in coordinates) / len(coordinates),
        longitude=sum(point.longitude for point in coordinates) / len(coordinates),
    )


def distance_miles(origin: GeoPoint, destination: GeoPoint) -> float:
    lat1 = math.radians(origin.latitude)
    lat2 = math.radians(destination.latitude)
    delta_lat = lat2 - lat1
    delta_lon = math.radians(destination.longitude - origin.longitude)
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(value))


def bearing_degrees(origin: GeoPoint, destination: GeoPoint) -> float:
    lat1 = math.radians(origin.latitude)
    lat2 = math.radians(destination.latitude)
    delta_lon = math.radians(destination.longitude - origin.longitude)
    x = math.sin(delta_lon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360
