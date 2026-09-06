from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, time
from time import monotonic
from typing import Protocol

from .config import Settings
from .location import GeoPoint, ZipLocator, bearing_degrees, distance_miles
from .models import Screening, apply_preview_minutes, normalize_showtime


class ShowtimeClient(Protocol):
    def fetch_showtimes(
        self, zip_code: str, show_date: date, *, page_limit: int = 50
    ) -> list[dict[str, object]]: ...


class LocationClient(Protocol):
    def lookup_zip(self, zip_code: str) -> GeoPoint: ...


@dataclass(frozen=True, slots=True)
class ScreeningFilters:
    movies: frozenset[str] = frozenset()
    theatres: frozenset[str] = frozenset()
    formats: frozenset[str] = frozenset()
    start_after: str | None = None
    start_before: str | None = None
    end_by: str | None = None


class ScreeningService:
    def __init__(
        self,
        client: ShowtimeClient,
        settings: Settings,
        locator: LocationClient | None = None,
    ) -> None:
        self.client = client
        self.settings = settings
        self.locator = locator or ZipLocator()
        self._cache: dict[tuple[date, str, int], tuple[float, list[Screening]]] = {}
        self._lock = threading.Lock()

    def get_screenings(
        self,
        show_date: date,
        preview_minutes_by_chain: dict[str, int] | None = None,
        *,
        zip_code: str | None = None,
        radius_miles: int | None = None,
    ) -> list[Screening]:
        location_zip = self.settings.zip_code if zip_code is None else zip_code
        location_radius = self.settings.radius_miles if radius_miles is None else radius_miles
        base_screenings = self._get_base_screenings(
            show_date,
            location_zip,
            location_radius,
        )
        previews = preview_minutes_by_chain or {}
        screenings = [
            apply_preview_minutes(screening, previews.get(screening.chain))
            for screening in base_screenings
        ]
        screenings.sort(
            key=lambda screening: (
                screening.actual_start or screening.advertised_start,
                screening.movie.casefold(),
                screening.theatre.casefold(),
            )
        )
        return screenings

    def _get_base_screenings(
        self,
        show_date: date,
        zip_code: str,
        radius_miles: int,
    ) -> list[Screening]:
        cache_key = (show_date, zip_code, radius_miles)
        now = monotonic()
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached is not None and now - cached[0] < self.settings.cache_ttl_seconds:
                return list(cached[1])

        origin = self.locator.lookup_zip(zip_code)
        raw_showtimes = self._fetch_radius_showtimes(
            zip_code,
            show_date,
            origin,
            radius_miles,
        )
        screenings: list[Screening] = []
        for raw in raw_showtimes:
            distance = _raw_distance_miles(origin, raw)
            if distance is None or distance > radius_miles:
                continue

            located_raw = dict(raw)
            located_raw["distanceMiles"] = round(distance, 1)
            screening = normalize_showtime(located_raw)
            if screening is not None:
                screenings.append(screening)

        screenings.sort(key=lambda screening: screening.advertised_start)
        with self._lock:
            self._cache[cache_key] = (now, screenings)
        return list(screenings)

    def _fetch_radius_showtimes(
        self,
        zip_code: str,
        show_date: date,
        origin: GeoPoint,
        radius_miles: int,
    ) -> list[dict[str, object]]:
        combined = _dedupe_raw_showtimes(
            self.client.fetch_showtimes(
                zip_code,
                show_date,
                page_limit=self.settings.market_page_limit,
            )
        )
        queried_zips = {zip_code}

        for probe_limit in (8, 4):
            probe_zips = _probe_zip_codes(
                combined.values(),
                origin,
                radius_miles,
                excluded=queried_zips,
            )[:probe_limit]
            if not probe_zips:
                break

            queried_zips.update(probe_zips)
            with ThreadPoolExecutor(max_workers=min(4, len(probe_zips))) as executor:
                futures = {
                    executor.submit(
                        self.client.fetch_showtimes,
                        probe_zip,
                        show_date,
                        page_limit=self.settings.market_page_limit,
                    ): probe_zip
                    for probe_zip in probe_zips
                }
                for future in as_completed(futures):
                    try:
                        rows = future.result()
                    except RuntimeError:
                        continue
                    combined.update(_dedupe_raw_showtimes(rows))

        return list(combined.values())


def filter_screenings(
    screenings: list[Screening],
    filters: ScreeningFilters,
) -> list[Screening]:
    start_after = _parse_time(filters.start_after)
    start_before = _parse_time(filters.start_before)
    end_by = _parse_time(filters.end_by)

    return [
        screening
        for screening in screenings
        if _selected(screening.movie, filters.movies)
        and _selected(screening.theatre, filters.theatres)
        and _selected(screening.format, filters.formats)
        and _datetime_at_or_after(
            screening.actual_start,
            start_after,
            screening.advertised_start,
        )
        and _datetime_at_or_before(
            screening.actual_start,
            start_before,
            screening.advertised_start,
        )
        and _datetime_at_or_before(
            screening.estimated_end,
            end_by,
            screening.advertised_start,
        )
    ]


def facets(screenings: list[Screening]) -> dict[str, list[str]]:
    return {
        "movies": sorted({screening.movie for screening in screenings}, key=str.casefold),
        "theatres": sorted({screening.theatre for screening in screenings}, key=str.casefold),
        "formats": sorted({screening.format for screening in screenings}, key=str.casefold),
        "chains": sorted({screening.chain for screening in screenings}, key=str.casefold),
    }


def _dedupe_raw_showtimes(
    rows: list[dict[str, object]],
) -> dict[tuple[str, str, str, str, str], dict[str, object]]:
    deduped: dict[tuple[str, str, str, str, str], dict[str, object]] = {}
    for row in rows:
        key = (
            str(row.get("theatreName") or ""),
            str(row.get("id") or row.get("showtimeHashCode") or ""),
            str(row.get("showDateTimeLocal") or ""),
            str(row.get("movieName") or ""),
            str(row.get("premiumFormat") or ""),
        )
        deduped[key] = row
    return deduped


def _probe_zip_codes(
    rows: object,
    origin: GeoPoint,
    radius_miles: int,
    *,
    excluded: set[str],
) -> list[str]:
    discovery_distance = radius_miles + 10
    sectors: dict[int, tuple[float, str]] = {}

    for raw in rows:
        if not isinstance(raw, dict):
            continue
        theatre_zip = str(raw.get("theatreZip") or "").strip()
        point = _raw_point(raw)
        if not theatre_zip or theatre_zip in excluded or point is None:
            continue

        distance = distance_miles(origin, point)
        if distance > discovery_distance:
            continue

        sector = int(((bearing_degrees(origin, point) + 22.5) % 360) // 45)
        current = sectors.get(sector)
        if current is None or distance > current[0]:
            sectors[sector] = (distance, theatre_zip)

    ordered = sorted(sectors.values(), reverse=True)
    result: list[str] = []
    seen: set[str] = set()
    for _, theatre_zip in ordered:
        if theatre_zip in seen:
            continue
        seen.add(theatre_zip)
        result.append(theatre_zip)
    return result


def _raw_point(raw: dict[str, object]) -> GeoPoint | None:
    try:
        latitude = float(raw["theatreLatitude"])
        longitude = float(raw["theatreLongitude"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    return GeoPoint(latitude, longitude)


def _raw_distance_miles(origin: GeoPoint, raw: dict[str, object]) -> float | None:
    point = _raw_point(raw)
    return distance_miles(origin, point) if point is not None else None


def _selected(value: str, selected: frozenset[str]) -> bool:
    return not selected or value in selected


def _parse_time(value: str | None) -> time | None:
    if value is None:
        return None
    try:
        return time.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"Invalid time: {value}") from exc


def _datetime_at_or_after(
    value: datetime | None,
    boundary: time | None,
    reference: datetime,
) -> bool:
    if boundary is None:
        return True
    if value is None:
        return False
    return value >= datetime.combine(reference.date(), boundary)


def _datetime_at_or_before(
    value: datetime | None,
    boundary: time | None,
    reference: datetime,
) -> bool:
    if boundary is None:
        return True
    if value is None:
        return False
    return value <= datetime.combine(reference.date(), boundary)
