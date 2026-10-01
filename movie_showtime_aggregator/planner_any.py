from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .location import GeoPoint
from .models import Screening
from .planner import MovieDayItinerary, plan_movie_day


@dataclass(frozen=True, slots=True)
class AnyMovieDayPlan:
    selected_movies: tuple[str, ...]
    required_movies: tuple[str, ...]
    plannable_movie_count: int
    sort_by: str
    secondary_sort_by: str
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
            "target_movie_count": "any",
            "plannable_movie_count": self.plannable_movie_count,
            "sort_by": self.sort_by,
            "secondary_sort_by": self.secondary_sort_by,
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


def plan_movie_day_any(
    screenings: list[Screening],
    selected_movies: list[str],
    travel_minutes: dict[tuple[GeoPoint, GeoPoint], int | None],
    *,
    required_movies: list[str] | None = None,
    earliest_start: datetime | None = None,
    latest_end: datetime | None = None,
    home_configured: bool = True,
    sort_by: str = "elapsed",
    secondary_sort_by: str | None = None,
    minimum_buffer_minutes: int = 0,
    offset: int = 0,
    limit: int = 50,
) -> AnyMovieDayPlan:
    normalized_movies = list(dict.fromkeys(movie.strip() for movie in selected_movies if movie.strip()))
    normalized_required = list(
        dict.fromkeys(movie.strip() for movie in (required_movies or []) if movie.strip())
    )

    validation = plan_movie_day(
        screenings,
        normalized_movies,
        travel_minutes,
        target_movie_count=len(normalized_movies),
        required_movies=normalized_required,
        earliest_start=earliest_start,
        latest_end=latest_end,
        home_configured=home_configured,
        sort_by=sort_by,
        secondary_sort_by=secondary_sort_by,
        minimum_buffer_minutes=minimum_buffer_minutes,
        offset=0,
        limit=1,
    )

    minimum_count = max(1, len(normalized_required))
    page_end = offset + limit
    collected: list[MovieDayItinerary] = []
    total_itineraries = 0

    for target_count in range(minimum_count, len(normalized_movies) + 1):
        target_plan = plan_movie_day(
            screenings,
            normalized_movies,
            travel_minutes,
            target_movie_count=target_count,
            required_movies=normalized_required,
            earliest_start=earliest_start,
            latest_end=latest_end,
            home_configured=home_configured,
            sort_by=sort_by,
            secondary_sort_by=secondary_sort_by,
            minimum_buffer_minutes=minimum_buffer_minutes,
            offset=0,
            limit=min(100, max(1, page_end)),
        )
        total_itineraries += target_plan.total_itineraries
        collected.extend(target_plan.itineraries)

        next_offset = len(target_plan.itineraries)
        while next_offset < target_plan.total_itineraries and next_offset < page_end:
            next_page = plan_movie_day(
                screenings,
                normalized_movies,
                travel_minutes,
                target_movie_count=target_count,
                required_movies=normalized_required,
                earliest_start=earliest_start,
                latest_end=latest_end,
                home_configured=home_configured,
                sort_by=sort_by,
                secondary_sort_by=secondary_sort_by,
                minimum_buffer_minutes=minimum_buffer_minutes,
                offset=next_offset,
                limit=min(100, page_end - next_offset),
            )
            if not next_page.itineraries:
                break
            collected.extend(next_page.itineraries)
            next_offset += len(next_page.itineraries)

    secondary = validation.secondary_sort_by
    collected.sort(key=lambda itinerary: _itinerary_sort_key(itinerary, sort_by, secondary))
    page = tuple(collected[offset:page_end])

    return AnyMovieDayPlan(
        selected_movies=validation.selected_movies,
        required_movies=validation.required_movies,
        plannable_movie_count=validation.plannable_movie_count,
        sort_by=validation.sort_by,
        secondary_sort_by=validation.secondary_sort_by,
        eligible_showings=validation.eligible_showings,
        unplannable_showings=validation.unplannable_showings,
        missing_movies=validation.missing_movies,
        missing_required_movies=validation.missing_required_movies,
        total_itineraries=total_itineraries,
        offset=offset,
        limit=limit,
        itineraries=page,
    )


def _itinerary_sort_key(
    itinerary: MovieDayItinerary,
    sort_by: str,
    secondary_sort_by: str,
) -> tuple[object, ...]:
    priorities = {
        "elapsed": itinerary.elapsed_minutes,
        "driving": itinerary.travel_minutes,
        "want": -itinerary.want_score,
    }
    key: list[object] = [priorities[sort_by], priorities[secondary_sort_by]]
    if sort_by == "want" and secondary_sort_by == "elapsed":
        key.append(priorities["driving"])
    return (*key, itinerary.starts_at, itinerary.showtime_ids)
