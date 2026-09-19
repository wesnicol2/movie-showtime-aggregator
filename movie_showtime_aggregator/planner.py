from __future__ import annotations

import heapq
from dataclasses import dataclass
from datetime import datetime
from functools import cache

from .location import GeoPoint
from .models import Screening
from .routing import route_source_url

SORT_ELAPSED = "elapsed"
SORT_DRIVING = "driving"
SORT_WANT = "want"
SORT_MODES = {SORT_ELAPSED, SORT_DRIVING, SORT_WANT}


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
    movies: tuple[str, ...]
    dropped_movies: tuple[str, ...]
    want_score: int
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
            "movies": list(self.movies),
            "dropped_movies": list(self.dropped_movies),
            "want_score": self.want_score,
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
    required_movies: tuple[str, ...]
    target_movie_count: int
    plannable_movie_count: int
    sort_by: str
    eligible_showings: int
    unplannable_showings: int
    missing_movies: tuple[str, ...]
    missing_required_movies: tuple[str, ...]
    total_itineraries: int
    offset: int
    limit: int
    itineraries: tuple[MovieDayItinerary, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "selected_movies": list(self.selected_movies),
            "required_movies": list(self.required_movies),
            "target_movie_count": self.target_movie_count,
            "plannable_movie_count": self.plannable_movie_count,
            "sort_by": self.sort_by,
            "eligible_showings": self.eligible_showings,
            "unplannable_showings": self.unplannable_showings,
            "missing_movies": list(self.missing_movies),
            "missing_required_movies": list(self.missing_required_movies),
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
    target_movie_count: int | None = None,
    required_movies: list[str] | None = None,
    earliest_start: datetime | None = None,
    latest_end: datetime | None = None,
    sort_by: str = SORT_ELAPSED,
    minimum_buffer_minutes: int = 0,
    offset: int = 0,
    limit: int = 50,
) -> MovieDayPlan:
    movies = tuple(dict.fromkeys(movie.strip() for movie in selected_movies if movie.strip()))
    if not movies:
        raise ValueError("select at least one movie")
    if len(movies) > 10:
        raise ValueError("movie-day planning supports at most 10 selected movies")
    target = len(movies) if target_movie_count is None else target_movie_count
    if isinstance(target, bool) or not isinstance(target, int) or not 1 <= target <= len(movies):
        raise ValueError("target_movie_count must be between 1 and the number of selected movies")
    required = tuple(
        dict.fromkeys(movie.strip() for movie in (required_movies or []) if movie.strip())
    )
    if any(movie not in movies for movie in required):
        raise ValueError("required_movies must be selected movies")
    if len(required) > target:
        raise ValueError("required_movies cannot exceed target_movie_count")
    if sort_by not in SORT_MODES:
        raise ValueError("sort_by must be 'elapsed', 'driving', or 'want'")
    if earliest_start is not None and latest_end is not None and latest_end < earliest_start:
        raise ValueError("latest_end must not be before earliest_start")
    if not 0 <= minimum_buffer_minutes <= 180:
        raise ValueError("minimum_buffer_minutes must be between 0 and 180")
    if offset < 0:
        raise ValueError("offset must be zero or greater")
    if not 1 <= limit <= 100:
        raise ValueError("limit must be between 1 and 100")

    selected = set(movies)
    relevant = [screening for screening in screenings if screening.movie in selected]
    timed = [
        screening
        for screening in relevant
        if screening.actual_start is not None and screening.estimated_end is not None
    ]
    candidates = [
        screening
        for screening in timed
        if (earliest_start is None or screening.actual_start >= earliest_start)
        and (latest_end is None or screening.estimated_end <= latest_end)
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
    missing_required_movies = tuple(movie for movie in required if movie not in present)
    movie_bits = {movie: 1 << index for index, movie in enumerate(movies)}
    required_mask = sum(movie_bits[movie] for movie in required)
    movie_scores = {movie: len(movies) - index for index, movie in enumerate(movies)}

    if len(present) < target or missing_required_movies:
        return MovieDayPlan(
            selected_movies=movies,
            required_movies=required,
            target_movie_count=target,
            plannable_movie_count=len(present),
            sort_by=sort_by,
            eligible_showings=len(candidates),
            unplannable_showings=len(relevant) - len(timed),
            missing_movies=missing_movies,
            missing_required_movies=missing_required_movies,
            total_itineraries=0,
            offset=offset,
            limit=limit,
            itineraries=(),
        )

    edges: list[list[tuple[int, int]]] = [[] for _ in candidates]
    for source_index, source in enumerate(candidates):
        source_end = source.estimated_end
        if source_end is None:
            continue
        for target_index in range(source_index + 1, len(candidates)):
            target_screening = candidates[target_index]
            if source.movie == target_screening.movie or target_screening.actual_start is None:
                continue
            drive_minutes = _transition_minutes(source, target_screening, travel_minutes)
            if drive_minutes is None:
                continue
            available_minutes = int(
                (target_screening.actual_start - source_end).total_seconds() // 60
            )
            if available_minutes >= drive_minutes + minimum_buffer_minutes:
                edges[source_index].append((target_index, drive_minutes))

    @cache
    def completion_count(index: int, visited_mask: int) -> int:
        visited_count = visited_mask.bit_count()
        if visited_count == target:
            return 1 if visited_mask & required_mask == required_mask else 0
        required_remaining = (required_mask & ~visited_mask).bit_count()
        if required_remaining > target - visited_count:
            return 0
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
    itineraries = _ranked_itineraries(
        candidates,
        movies,
        movie_bits,
        movie_scores,
        edges,
        completion_count,
        starts,
        target=target,
        sort_by=sort_by,
        offset=offset,
        limit=limit,
    )

    return MovieDayPlan(
        selected_movies=movies,
        required_movies=required,
        target_movie_count=target,
        plannable_movie_count=len(present),
        sort_by=sort_by,
        eligible_showings=len(candidates),
        unplannable_showings=len(relevant) - len(timed),
        missing_movies=missing_movies,
        missing_required_movies=missing_required_movies,
        total_itineraries=total_itineraries,
        offset=offset,
        limit=limit,
        itineraries=tuple(itineraries),
    )


def _ranked_itineraries(
    candidates: list[Screening],
    movies: tuple[str, ...],
    movie_bits: dict[str, int],
    movie_scores: dict[str, int],
    edges: list[list[tuple[int, int]]],
    completion_count,
    starts: list[tuple[int, int, int]],
    *,
    target: int,
    sort_by: str,
    offset: int,
    limit: int,
) -> list[MovieDayItinerary]:
    heap: list[
        tuple[
            tuple[object, ...],
            int,
            int,
            int,
            tuple[tuple[int, int], ...],
        ]
    ] = []

    for index, visited_mask, count in starts:
        if count == 0:
            continue
        path = ((index, 0),)
        heapq.heappush(
            heap,
            (
                _path_priority(
                    candidates,
                    path,
                    0,
                    sort_by,
                    movie_bits=movie_bits,
                    movie_scores=movie_scores,
                    visited_mask=visited_mask,
                    target=target,
                ),
                index,
                visited_mask,
                0,
                path,
            ),
        )

    itineraries: list[MovieDayItinerary] = []
    skipped = 0
    while heap and len(itineraries) < limit:
        _, index, visited_mask, drive_total, path = heapq.heappop(heap)
        if visited_mask.bit_count() == target:
            if skipped < offset:
                skipped += 1
            else:
                itineraries.append(_make_itinerary(candidates, movies, movie_scores, list(path)))
            continue

        for target_index, drive_minutes in edges[index]:
            bit = movie_bits[candidates[target_index].movie]
            if visited_mask & bit:
                continue
            next_mask = visited_mask | bit
            if completion_count(target_index, next_mask) == 0:
                continue
            next_path = (*path, (target_index, drive_minutes))
            next_drive = drive_total + drive_minutes
            heapq.heappush(
                heap,
                (
                    _path_priority(
                        candidates,
                        next_path,
                        next_drive,
                        sort_by,
                        movie_bits=movie_bits,
                        movie_scores=movie_scores,
                        visited_mask=next_mask,
                        target=target,
                    ),
                    target_index,
                    next_mask,
                    next_drive,
                    next_path,
                ),
            )

    return itineraries


def _path_priority(
    candidates: list[Screening],
    path: tuple[tuple[int, int], ...],
    drive_minutes: int,
    sort_by: str,
    *,
    movie_bits: dict[str, int],
    movie_scores: dict[str, int],
    visited_mask: int,
    target: int,
) -> tuple[object, ...]:
    first = candidates[path[0][0]]
    current = candidates[path[-1][0]]
    starts_at = first.actual_start
    ends_at = current.estimated_end
    if starts_at is None or ends_at is None:
        raise ValueError("ranked path contains unknown timing")
    elapsed_minutes = int((ends_at - starts_at).total_seconds() // 60)
    is_complete = visited_mask.bit_count() == target
    return_home_minutes = (current.drive_home_minutes or 0) if is_complete else 0
    total_elapsed_minutes = elapsed_minutes + return_home_minutes
    total_drive_minutes = drive_minutes + return_home_minutes
    showtime_ids = tuple(candidates[index].showtime_id for index, _ in path)
    if sort_by == SORT_DRIVING:
        return (total_drive_minutes, total_elapsed_minutes, starts_at, showtime_ids)
    if sort_by == SORT_WANT:
        current_score = sum(movie_scores[candidates[index].movie] for index, _ in path)
        remaining_slots = target - visited_mask.bit_count()
        remaining_scores = sorted(
            (
                score
                for movie, score in movie_scores.items()
                if not visited_mask & movie_bits[movie]
            ),
            reverse=True,
        )
        score_upper_bound = current_score + sum(remaining_scores[:remaining_slots])
        return (
            -score_upper_bound,
            total_elapsed_minutes,
            total_drive_minutes,
            starts_at,
            showtime_ids,
        )
    return (total_elapsed_minutes, total_drive_minutes, starts_at, showtime_ids)


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
    selected_movies: tuple[str, ...],
    movie_scores: dict[str, int],
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

    return_home_minutes = selected[-1].drive_home_minutes or 0
    elapsed_minutes = int((ends_at - starts_at).total_seconds() // 60) + return_home_minutes
    movie_minutes = sum(screening.runtime_minutes or 0 for screening in selected)
    total_travel = sum(leg.drive_minutes for leg in legs) + return_home_minutes
    included_movies = tuple(screening.movie for screening in selected)
    included = set(included_movies)
    return MovieDayItinerary(
        showtime_ids=tuple(screening.showtime_id for screening in selected),
        movies=included_movies,
        dropped_movies=tuple(movie for movie in selected_movies if movie not in included),
        want_score=sum(movie_scores[movie] for movie in included_movies),
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
