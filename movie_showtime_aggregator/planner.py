from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from functools import cache

from .location import GeoPoint
from .models import Screening
from .routing import route_source_url


@dataclass(frozen=True, slots=True)
class MovieDayLeg:
    from_showtime_id: str
    to_showtime_id: str
    from_theatre: str
    to_theatre: str
    drive_minutes: int
    gap_minutes: int
    route_source_url: str

    def to_dict(self) -> dict[str, object]:
        return {
            "from_showtime_id": self.from_showtime_id,
            "to_showtime_id": self.to_showtime_id,
            "from_theatre": self.from_theatre,
            "to_theatre": self.to_theatre,
            "drive_minutes": self.drive_minutes,
            "gap_minutes": self.gap_minutes,
            "route_source_url": self.route_source_url,
        }


@dataclass(frozen=True, slots=True)
class MovieDayItinerary:
    showtime_ids: tuple[str, ...]
    starts_at: datetime
    ends_at: datetime
    elapsed_minutes: int
    movie_minutes: int
    travel_minutes: int
    waiting_minutes: int
    legs: tuple[MovieDayLeg, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "showtime_ids": list(self.showtime_ids),
            "starts_at": self.starts_at.isoformat(timespec="minutes"),
            "ends_at": self.ends_at.isoformat(timespec="minutes"),
            "elapsed_minutes": self.elapsed_minutes,
            "movie_minutes": self.movie_minutes,
            "travel_minutes": self.travel_minutes,
            "waiting_minutes": self.waiting_minutes,
            "legs": [leg.to_dict() for leg in self.legs],
        }


@dataclass(frozen=True, slots=True)
class MovieDayPlan:
    selected_movies: tuple[str, ...]
    eligible_showings: int
    unplannable_showings: int
    missing_movies: tuple[str, ...]
    total_itineraries: int
    offset: int
    limit: int
    itineraries: tuple[MovieDayItinerary, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "selected_movies": list(self.selected_movies),
            "eligible_showings": self.eligible_showings,
            "unplannable_showings": self.unplannable_showings,
            "missing_movies": list(self.missing_movies),
            "total_itineraries": self.total_itineraries,
            "offset": self.offset,
            "limit": self.limit,
            "has_more": self.offset + len(self.itineraries) < self.total_itineraries,
            "itineraries": [itinerary.to_dict() for itinerary in self.itineraries],
        }


def theatre_points(screenings: list[Screening]) -> list[GeoPoint]:
    return list(
        dict.fromkeys(
            GeoPoint(screening.theatre_latitude, screening.theatre_longitude)
            for screening in screenings
            if screening.actual_start is not None
            and screening.estimated_end is not None
            and screening.theatre_latitude is not None
            and screening.theatre_longitude is not None
        )
    )


def plan_movie_day(
    screenings: list[Screening],
    selected_movies: list[str],
    travel_minutes: dict[tuple[GeoPoint, GeoPoint], int | None],
    *,
    minimum_buffer_minutes: int = 0,
    offset: int = 0,
    limit: int = 50,
) -> MovieDayPlan:
    movies = tuple(dict.fromkeys(movie.strip() for movie in selected_movies if movie.strip()))
    if not movies:
        raise ValueError("select at least one movie")
    if len(movies) > 10:
        raise ValueError("movie-day planning supports at most 10 selected movies")
    if not 0 <= minimum_buffer_minutes <= 180:
        raise ValueError("minimum_buffer_minutes must be between 0 and 180")
    if offset < 0:
        raise ValueError("offset must be zero or greater")
    if not 1 <= limit <= 100:
        raise ValueError("limit must be between 1 and 100")

    selected = set(movies)
    relevant = [screening for screening in screenings if screening.movie in selected]
    candidates = [
        screening
        for screening in relevant
        if screening.actual_start is not None and screening.estimated_end is not None
    ]
    candidates.sort(
        key=lambda screening: (
            screening.actual_start,
            screening.estimated_end,
            screening.movie.casefold(),
            screening.theatre.casefold(),
            screening.showtime_id,
        )
    )
    present = {screening.movie for screening in candidates}
    missing_movies = tuple(movie for movie in movies if movie not in present)
    if missing_movies:
        return MovieDayPlan(
            selected_movies=movies,
            eligible_showings=len(candidates),
            unplannable_showings=len(relevant) - len(candidates),
            missing_movies=missing_movies,
            total_itineraries=0,
            offset=offset,
            limit=limit,
            itineraries=(),
        )

    movie_bits = {movie: 1 << index for index, movie in enumerate(movies)}
    full_mask = (1 << len(movies)) - 1
    edges: list[list[tuple[int, int]]] = [[] for _ in candidates]
    for source_index, source in enumerate(candidates):
        source_end = source.estimated_end
        if source_end is None:
            continue
        for target_index in range(source_index + 1, len(candidates)):
            target = candidates[target_index]
            if source.movie == target.movie or target.actual_start is None:
                continue
            drive_minutes = _transition_minutes(source, target, travel_minutes)
            if drive_minutes is None:
                continue
            available_minutes = int((target.actual_start - source_end).total_seconds() // 60)
            if available_minutes >= drive_minutes + minimum_buffer_minutes:
                edges[source_index].append((target_index, drive_minutes))

    @cache
    def completion_count(index: int, visited_mask: int) -> int:
        if visited_mask == full_mask:
            return 1
        total = 0
        for target_index, _ in edges[index]:
            bit = movie_bits[candidates[target_index].movie]
            if visited_mask & bit:
                continue
            total += completion_count(target_index, visited_mask | bit)
        return total

    starts = [
        (index, movie_bits[screening.movie], completion_count(index, movie_bits[screening.movie]))
        for index, screening in enumerate(candidates)
    ]
    total_itineraries = sum(count for _, _, count in starts)
    itineraries: list[MovieDayItinerary] = []
    remaining_offset = offset

    def collect(index: int, visited_mask: int, path: list[tuple[int, int]]) -> None:
        nonlocal remaining_offset
        if len(itineraries) >= limit:
            return
        if visited_mask == full_mask:
            if remaining_offset:
                remaining_offset -= 1
            else:
                itineraries.append(_make_itinerary(candidates, path))
            return
        for target_index, drive_minutes in edges[index]:
            bit = movie_bits[candidates[target_index].movie]
            if visited_mask & bit:
                continue
            branch_count = completion_count(target_index, visited_mask | bit)
            if remaining_offset >= branch_count:
                remaining_offset -= branch_count
                continue
            collect(
                target_index,
                visited_mask | bit,
                [*path, (target_index, drive_minutes)],
            )
            if len(itineraries) >= limit:
                return

    for index, visited_mask, count in starts:
        if len(itineraries) >= limit:
            break
        if remaining_offset >= count:
            remaining_offset -= count
            continue
        collect(index, visited_mask, [(index, 0)])

    return MovieDayPlan(
        selected_movies=movies,
        eligible_showings=len(candidates),
        unplannable_showings=len(relevant) - len(candidates),
        missing_movies=missing_movies,
        total_itineraries=total_itineraries,
        offset=offset,
        limit=limit,
        itineraries=tuple(itineraries),
    )


def _transition_minutes(
    source: Screening,
    target: Screening,
    travel_minutes: dict[tuple[GeoPoint, GeoPoint], int | None],
) -> int | None:
    if source.theatre == target.theatre:
        return 0
    if (
        source.theatre_latitude is None
        or source.theatre_longitude is None
        or target.theatre_latitude is None
        or target.theatre_longitude is None
    ):
        return None
    source_point = GeoPoint(source.theatre_latitude, source.theatre_longitude)
    target_point = GeoPoint(target.theatre_latitude, target.theatre_longitude)
    if source_point == target_point:
        return 0
    return travel_minutes.get((source_point, target_point))


def _make_itinerary(
    candidates: list[Screening],
    path: list[tuple[int, int]],
) -> MovieDayItinerary:
    selected = [candidates[index] for index, _ in path]
    starts_at = selected[0].actual_start
    ends_at = selected[-1].estimated_end
    if starts_at is None or ends_at is None:
        raise ValueError("itinerary contains unknown timing")

    legs: list[MovieDayLeg] = []
    for position in range(1, len(path)):
        source = selected[position - 1]
        target = selected[position]
        source_end = source.estimated_end
        target_start = target.actual_start
        if source_end is None or target_start is None:
            raise ValueError("itinerary contains unknown timing")
        drive_minutes = path[position][1]
        gap_minutes = int((target_start - source_end).total_seconds() // 60)
        legs.append(
            MovieDayLeg(
                from_showtime_id=source.showtime_id,
                to_showtime_id=target.showtime_id,
                from_theatre=source.theatre,
                to_theatre=target.theatre,
                drive_minutes=drive_minutes,
                gap_minutes=gap_minutes,
                route_source_url=_transition_source_url(source, target),
            )
        )

    elapsed_minutes = int((ends_at - starts_at).total_seconds() // 60)
    movie_minutes = sum(screening.runtime_minutes or 0 for screening in selected)
    total_travel = sum(leg.drive_minutes for leg in legs)
    return MovieDayItinerary(
        showtime_ids=tuple(screening.showtime_id for screening in selected),
        starts_at=starts_at,
        ends_at=ends_at,
        elapsed_minutes=elapsed_minutes,
        movie_minutes=movie_minutes,
        travel_minutes=total_travel,
        waiting_minutes=elapsed_minutes - movie_minutes - total_travel,
        legs=tuple(legs),
    )


def _transition_source_url(source: Screening, target: Screening) -> str:
    if (
        source.theatre == target.theatre
        or source.theatre_latitude is None
        or source.theatre_longitude is None
        or target.theatre_latitude is None
        or target.theatre_longitude is None
    ):
        return ""
    return route_source_url(
        GeoPoint(source.theatre_latitude, source.theatre_longitude),
        GeoPoint(target.theatre_latitude, target.theatre_longitude),
    )
