from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import replace
from datetime import date

from .amc import AMCClient, AMCError, AMCShowtime, match_showtime
from .location import GeoPoint
from .metadata import MetadataError, MovieMetadata, OmdbClient
from .models import Screening, apply_travel_minutes
from .routing import OsrmRouter, RoutingError


def enrich_movie_metadata(
    screenings: list[Screening],
    client: OmdbClient | None,
) -> list[Screening]:
    if client is None or not screenings:
        return screenings

    identities = sorted(
        {
            (screening.movie_source_id, screening.movie, screening.runtime_minutes)
            for screening in screenings
        },
        key=lambda identity: (identity[1].casefold(), identity[0], identity[2] or 0),
    )
    metadata: dict[tuple[str, str, int | None], MovieMetadata] = {}
    with ThreadPoolExecutor(max_workers=min(5, len(identities))) as executor:
        futures = {
            executor.submit(
                client.lookup,
                title,
                source_id=source_id,
                runtime_minutes=runtime_minutes,
            ): (source_id, title, runtime_minutes)
            for source_id, title, runtime_minutes in identities
        }
        for future in as_completed(futures):
            identity = futures[future]
            try:
                metadata[identity] = future.result()
            except (MetadataError, ValueError):
                continue

    enriched: list[Screening] = []
    for screening in screenings:
        identity = (screening.movie_source_id, screening.movie, screening.runtime_minutes)
        details = metadata.get(identity)
        if details is None:
            enriched.append(screening)
            continue
        enriched.append(
            replace(
                screening,
                poster_url=screening.poster_url or details.poster_url,
                imdb_id=details.imdb_id,
                imdb_rating=details.imdb_rating,
                metacritic_score=details.metacritic_score,
                rotten_tomatoes_score=details.rotten_tomatoes_score,
                initial_release_date=details.initial_release_date,
                letterboxd_url=details.letterboxd_url,
                imdb_url=details.imdb_url,
                rotten_tomatoes_url=details.rotten_tomatoes_url,
                metacritic_url=details.metacritic_url,
            )
        )
    return enriched


def enrich_travel_times(
    screenings: list[Screening],
    home: GeoPoint | None,
    router: OsrmRouter,
) -> list[Screening]:
    if home is None:
        return screenings

    destinations = {
        _theatre_point(screening)
        for screening in screenings
        if screening.actual_start is not None and _theatre_point(screening) is not None
    }
    if not destinations:
        return screenings

    try:
        travel = router.travel_minutes(home, list(destinations))
    except RoutingError:
        return screenings

    enriched: list[Screening] = []
    for screening in screenings:
        point = _theatre_point(screening)
        durations = travel.get(point) if point is not None else None
        if durations is None:
            enriched.append(screening)
            continue
        drive_to, drive_home = durations
        route_url = _route_url(home, point)
        enriched.append(
            replace(
                apply_travel_minutes(screening, drive_to, drive_home),
                route_source_url=route_url,
            )
        )
    return enriched


def enrich_amc_details(
    screenings: list[Screening],
    show_date: date,
    origin: GeoPoint,
    client: AMCClient | None,
    *,
    a_list_enabled: bool,
) -> list[Screening]:
    if client is None or not any(_is_amc(screening) for screening in screenings):
        return screenings

    try:
        candidates = client.showtimes_near(show_date, origin)
    except AMCError:
        return screenings

    matched: dict[int, AMCShowtime] = {}
    for index, screening in enumerate(screenings):
        if not _is_amc(screening):
            continue
        match = match_showtime(
            screening.movie,
            screening.theatre,
            screening.advertised_start,
            _theatre_point(screening),
            candidates,
        )
        if match is not None:
            matched[index] = match

    seat_matches = {
        (match.theatre.theatre_id, match.performance_id): match for match in matched.values()
    }
    seats: dict[tuple[int, int], float | None] = {}
    if seat_matches:
        with ThreadPoolExecutor(max_workers=min(6, len(seat_matches))) as executor:
            futures = {
                executor.submit(client.seats_left_percent, *key): key for key in seat_matches
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    seats[key] = future.result()
                except Exception:
                    seats[key] = None

    result: list[Screening] = []
    for index, screening in enumerate(screenings):
        match = matched.get(index)
        if match is None:
            result.append(screening)
            continue

        ticket_price = match.ticket_price
        if a_list_enabled and match.a_list_eligible is True:
            ticket_price = 0.0
        result.append(
            replace(
                screening,
                ticket_price=ticket_price,
                seats_left_percent=seats.get((match.theatre.theatre_id, match.performance_id)),
                amc_a_list_eligible=match.a_list_eligible,
                amc_source_url=match.purchase_url or screening.purchase_url,
            )
        )
    return result


def _is_amc(screening: Screening) -> bool:
    return "amc" in screening.chain.casefold() or screening.theatre.casefold().startswith("amc ")


def _theatre_point(screening: Screening) -> GeoPoint | None:
    if screening.theatre_latitude is None or screening.theatre_longitude is None:
        return None
    return GeoPoint(screening.theatre_latitude, screening.theatre_longitude)


def _route_url(home: GeoPoint, destination: GeoPoint) -> str:
    return (
        "https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route="
        f"{home.latitude:.6f}%2C{home.longitude:.6f}%3B"
        f"{destination.latitude:.6f}%2C{destination.longitude:.6f}"
    )
