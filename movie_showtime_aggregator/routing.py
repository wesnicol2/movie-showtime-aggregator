from __future__ import annotations

import json
import math
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from time import monotonic, sleep

from .location import GeoPoint

NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"
OSRM_BASE_URL = "https://router.project-osrm.org"
USER_AGENT = (
    "movie-showtime-aggregator/1.0 (https://github.com/wesnicol2/movie-showtime-aggregator)"
)


class GeocodingError(RuntimeError):
    pass


class RoutingError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class GeocodedAddress:
    point: GeoPoint
    display_name: str


class AddressGeocoder:
    def __init__(self, *, timeout_seconds: int = 10) -> None:
        self.timeout_seconds = timeout_seconds
        self._cache: dict[str, GeocodedAddress] = {}
        self._lock = threading.Lock()
        self._last_request_started = 0.0

    def geocode(self, address: str) -> GeocodedAddress:
        normalized = " ".join(address.split()).strip()
        if not normalized:
            raise ValueError("home address is required")

        cache_key = normalized.casefold()
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached

            wait_seconds = 1.0 - (monotonic() - self._last_request_started)
            if wait_seconds > 0:
                sleep(wait_seconds)
            self._last_request_started = monotonic()

            query = urllib.parse.urlencode(
                {
                    "q": normalized,
                    "format": "jsonv2",
                    "limit": 1,
                    "countrycodes": "us",
                }
            )
            request = urllib.request.Request(
                f"{NOMINATIM_BASE_URL}/search?{query}",
                headers={
                    "Accept": "application/json",
                    "User-Agent": USER_AGENT,
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    payload = json.loads(response.read())
            except urllib.error.HTTPError as exc:
                raise GeocodingError(f"address lookup returned HTTP {exc.code}") from exc
            except (
                urllib.error.URLError,
                TimeoutError,
                OSError,
                json.JSONDecodeError,
            ) as exc:
                raise GeocodingError(f"address lookup failed: {exc}") from exc

            result = _parse_geocode_payload(payload)
            self._cache[cache_key] = result
            return result


class OsrmRouter:
    def __init__(self, *, timeout_seconds: int = 10) -> None:
        self.timeout_seconds = timeout_seconds
        self._cache: dict[tuple[GeoPoint, GeoPoint], tuple[int | None, int | None]] = {}
        self._matrix_cache: dict[tuple[GeoPoint, GeoPoint], int | None] = {}
        self._lock = threading.Lock()

    def travel_minutes(
        self,
        home: GeoPoint,
        destinations: list[GeoPoint],
    ) -> dict[GeoPoint, tuple[int | None, int | None]]:
        unique_destinations = list(dict.fromkeys(destinations))
        results: dict[GeoPoint, tuple[int | None, int | None]] = {}
        missing: list[GeoPoint] = []

        with self._lock:
            for destination in unique_destinations:
                cached = self._cache.get((home, destination))
                if cached is None:
                    missing.append(destination)
                else:
                    results[destination] = cached

        for start in range(0, len(missing), 24):
            chunk = missing[start : start + 24]
            chunk_results = self._fetch_matrix(home, chunk)
            with self._lock:
                for destination, durations in chunk_results.items():
                    self._cache[(home, destination)] = durations
                    results[destination] = durations

        return results

    def travel_matrix(
        self,
        points: list[GeoPoint],
    ) -> dict[tuple[GeoPoint, GeoPoint], int | None]:
        unique_points = list(dict.fromkeys(points))
        if len(unique_points) > 100:
            raise RoutingError("movie-day routing supports at most 100 theaters")
        if not unique_points:
            return {}
        if len(unique_points) == 1:
            point = unique_points[0]
            return {(point, point): 0}

        keys = [(origin, destination) for origin in unique_points for destination in unique_points]
        with self._lock:
            if all(key in self._matrix_cache for key in keys):
                return {key: self._matrix_cache[key] for key in keys}

        payload = self._fetch_table(unique_points)
        fetched = _parse_all_pairs_duration_matrix(payload, unique_points)
        with self._lock:
            self._matrix_cache.update(fetched)
            return {key: self._matrix_cache[key] for key in keys}

    def _fetch_matrix(
        self,
        home: GeoPoint,
        destinations: list[GeoPoint],
    ) -> dict[GeoPoint, tuple[int | None, int | None]]:
        if not destinations:
            return {}

        points = [home, *destinations]
        payload = self._fetch_table(points)
        return _parse_duration_matrix(payload, destinations)

    def _fetch_table(self, points: list[GeoPoint]) -> object:
        coordinates = ";".join(f"{point.longitude:.6f},{point.latitude:.6f}" for point in points)
        request = urllib.request.Request(
            f"{OSRM_BASE_URL}/table/v1/driving/{coordinates}?annotations=duration",
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            raise RoutingError(f"routing returned HTTP {exc.code}") from exc
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            json.JSONDecodeError,
        ) as exc:
            raise RoutingError(f"routing failed: {exc}") from exc

        return payload


def _parse_geocode_payload(payload: object) -> GeocodedAddress:
    if not isinstance(payload, list) or not payload or not isinstance(payload[0], dict):
        raise ValueError("home address was not found")

    first = payload[0]
    try:
        latitude = float(first["lat"])
        longitude = float(first["lon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise GeocodingError("address lookup returned unusable coordinates") from exc

    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise GeocodingError("address lookup returned unusable coordinates")

    display_name = str(first.get("display_name") or "").strip()
    if not display_name:
        display_name = "Matched address"
    return GeocodedAddress(GeoPoint(latitude, longitude), display_name)


def _parse_duration_matrix(
    payload: object,
    destinations: list[GeoPoint],
) -> dict[GeoPoint, tuple[int | None, int | None]]:
    if not isinstance(payload, dict) or payload.get("code") != "Ok":
        raise RoutingError("routing returned an unexpected response")

    durations = payload.get("durations")
    expected_size = len(destinations) + 1
    if not isinstance(durations, list) or len(durations) != expected_size:
        raise RoutingError("routing returned an unexpected duration matrix")
    if any(not isinstance(row, list) or len(row) != expected_size for row in durations):
        raise RoutingError("routing returned an unexpected duration matrix")

    result: dict[GeoPoint, tuple[int | None, int | None]] = {}
    for index, destination in enumerate(destinations, start=1):
        result[destination] = (
            _duration_minutes(durations[0][index]),
            _duration_minutes(durations[index][0]),
        )
    return result


def _parse_all_pairs_duration_matrix(
    payload: object,
    points: list[GeoPoint],
) -> dict[tuple[GeoPoint, GeoPoint], int | None]:
    if not isinstance(payload, dict) or payload.get("code") != "Ok":
        raise RoutingError("routing returned an unexpected response")
    durations = payload.get("durations")
    expected_size = len(points)
    if not isinstance(durations, list) or len(durations) != expected_size:
        raise RoutingError("routing returned an unexpected duration matrix")
    if any(not isinstance(row, list) or len(row) != expected_size for row in durations):
        raise RoutingError("routing returned an unexpected duration matrix")

    return {
        (origin, destination): _duration_minutes(durations[origin_index][destination_index])
        for origin_index, origin in enumerate(points)
        for destination_index, destination in enumerate(points)
    }


def _duration_minutes(value: object) -> int | None:
    if value is None:
        return None
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None
    if seconds < 0 or not math.isfinite(seconds):
        return None
    return math.ceil(seconds / 60)


def route_source_url(origin: GeoPoint, destination: GeoPoint) -> str:
    return (
        "https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route="
        f"{origin.latitude:.6f}%2C{origin.longitude:.6f}%3B"
        f"{destination.latitude:.6f}%2C{destination.longitude:.6f}"
    )
