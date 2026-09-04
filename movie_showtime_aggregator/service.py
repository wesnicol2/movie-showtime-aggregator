from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, time as clock_time

from .amc import AMCClient
from .config import Settings
from .models import Screening, normalize_showtime


@dataclass(frozen=True, slots=True)
class ScreeningFilters:
    movies: frozenset[str] = frozenset()
    theatres: frozenset[str] = frozenset()
    formats: frozenset[str] = frozenset()
    start_after: str | None = None
    start_before: str | None = None
    end_by: str | None = None


class ScreeningService:
    def __init__(self, client: AMCClient, settings: Settings) -> None:
        self.client = client
        self.settings = settings
        self._cache: dict[date, tuple[float, list[Screening]]] = {}
        self._lock = threading.Lock()

    def get_screenings(self, show_date: date) -> list[Screening]:
        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(show_date)
            if cached is not None and now - cached[0] < self.settings.cache_ttl_seconds:
                return list(cached[1])

        screenings: list[Screening] = []
        for theatre in self.settings.theatres:
            raw_showtimes = self.client.fetch_showtimes(theatre.theatre_id, show_date)
            for raw in raw_showtimes:
                screening = normalize_showtime(
                    raw,
                    theatre_name=theatre.name,
                    preshow_minutes=self.settings.preshow_minutes,
                )
                if screening is not None:
                    screenings.append(screening)

        screenings.sort(key=lambda screening: screening.actual_start)
        with self._lock:
            self._cache[show_date] = (now, screenings)
        return list(screenings)


def filter_screenings(
    screenings: list[Screening], filters: ScreeningFilters
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
        and _time_at_or_after(screening.actual_start, start_after)
        and _time_at_or_before(screening.actual_start, start_before)
        and _time_at_or_before(screening.estimated_end, end_by)
    ]


def facets(screenings: list[Screening]) -> dict[str, list[str]]:
    return {
        "movies": sorted({screening.movie for screening in screenings}, key=str.casefold),
        "theatres": sorted({screening.theatre for screening in screenings}, key=str.casefold),
        "formats": sorted({screening.format for screening in screenings}, key=str.casefold),
    }


def _selected(value: str, selected: frozenset[str]) -> bool:
    return not selected or value in selected


def _parse_time(value: str | None) -> clock_time | None:
    if value is None:
        return None
    try:
        return clock_time.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"Invalid time: {value}") from exc


def _time_at_or_after(value: datetime, boundary: clock_time | None) -> bool:
    return boundary is None or value.time() >= boundary


def _time_at_or_before(value: datetime, boundary: clock_time | None) -> bool:
    return boundary is None or value.time() <= boundary
