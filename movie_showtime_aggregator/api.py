from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import threading
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, replace
from datetime import date, datetime, timedelta
from http.cookies import SimpleCookie
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, unquote, urlencode
from wsgiref.simple_server import WSGIServer, make_server

from .amc import AMCClient
from .build_info import build_info
from .config import Settings
from .daily_cache import DailyCache, cache_day
from .enrichment import enrich_amc_details, enrich_movie_metadata, enrich_travel_times
from .experience import (
    configure_experience,
    experience_rule_ids,
    experience_settings_payload,
)
from .fandango import FandangoClient, FandangoError
from .letterboxd import letterboxd_rating
from .location import GeoPoint, LocationError, ZipLocator
from .metadata import OMDB_DAILY_LIMIT, OmdbClient
from .models import Screening
from .planner import plan_movie_day, theatre_points
from .provider_cache import ProviderCache
from .routing import AddressGeocoder, GeocodingError, OsrmRouter, RoutingError
from .service import ScreeningFilters, ScreeningService, facets, filter_screenings
from .storage import PersistentSettings, SettingsStore

JSON_HEADERS = [("Content-Type", "application/json; charset=utf-8")]
STATIC_DIR = Path(__file__).with_name("static")
SOURCE_STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
STATIC_ROOTS = (STATIC_DIR, SOURCE_STATIC_DIR)
SPA_ROUTES = {"/", "/movies", "/plan", "/planner", "/showtimes", "/settings", "/watchlist"}
PREVIEW_COOKIE = "movie_preview_minutes"
LOCATION_COOKIE = "movie_location"

_SETTINGS = Settings.from_env()
_DAILY_CACHE = DailyCache()
_SERVICE = ScreeningService(FandangoClient(), _SETTINGS, daily_cache=_DAILY_CACHE)
_STORE = SettingsStore()
_PROVIDER_CACHE = ProviderCache()
_GEOCODER = AddressGeocoder()
_ROUTER = OsrmRouter()
_ZIP_LOCATOR = ZipLocator()
_CLIENT_LOCK = threading.Lock()
_OMDB_CLIENTS: dict[str, OmdbClient] = {}
_AMC_CLIENTS: dict[str, AMCClient] = {}
_REFRESH_LOCK = threading.Lock()
_REFRESH_STATUS: dict[str, object] = {
    "running": False, "completed": 0, "total": 15,
    "started_at": None, "finished_at": None, "errors": [],
}


def health() -> dict[str, object]:
    return {"status": "ok", "build": build_info()}


def application(environ: dict, start_response: Callable) -> Iterable[bytes]:
    path = environ.get("PATH_INFO", "/").rstrip("/") or "/"
    method = environ.get("REQUEST_METHOD", "GET")

    if path == "/api/settings":
        if method not in {"GET", "HEAD", "POST"}:
            return _json_response(start_response, 405, {"error": "method not allowed"}, method)
        return _settings_response(environ, start_response, method)

    if path == "/api/cache/refresh":
        if method != "POST":
            return _json_response(start_response, 405, {"error": "method not allowed"}, method)
        try:
            query = parse_qs(environ.get("QUERY_STRING", ""))
            zip_code, radius = _location_from_request(environ, query)
            previews = _preview_minutes_from_request(environ, query)
        except ValueError as exc:
            return _json_response(start_response, 400, {"error": str(exc)}, method)
        return _json_response(start_response, 200, _start_refresh(zip_code, radius, previews), method)

    if path == "/api/cache/status":
        if method not in {"GET", "HEAD"}:
            return _json_response(start_response, 405, {"error": "method not allowed"}, method)
        return _json_response(start_response, 200, _cache_status(), method)

    if path == "/api/movie-day":
        if method != "POST":
            return _json_response(start_response, 405, {"error": "method not allowed"}, method)
        return _movie_day_response(environ, start_response, method)

    if method not in {"GET", "HEAD"}:
        return _json_response(start_response, 405, {"error": "method not allowed"}, method)

    if path == "/health":
        return _json_response(start_response, 200, health(), method)
    if path == "/api/screenings":
        return _screenings_response(environ, start_response, method)
    if path == "/api/movie-availability":
        return _movie_availability_response(environ, start_response, method)
    if path == "/api/letterboxd-rating":
        query = parse_qs(environ.get("QUERY_STRING", ""))
        imdb_ids = query.get("imdb_id", [])
        if len(imdb_ids) != 1:
            return _json_response(start_response, 400, {"error": "one imdb_id is required"}, method)
        try:
            score = letterboxd_rating(imdb_ids[0], _PROVIDER_CACHE)
        except ValueError as exc:
            return _json_response(start_response, 400, {"error": str(exc)}, method)
        return _json_response(start_response, 200, {"rating": score}, method)
    if path in SPA_ROUTES:
        return _static_response(start_response, "index.html", method, requested_path=path)
    if path.startswith("/assets/"):
        return _static_response(start_response, path.lstrip("/"), method, requested_path=path)
    return _json_response(start_response, 404, {"error": "not found", "path": path}, method)


def _screenings_response(environ: dict, start_response: Callable, method: str) -> Iterable[bytes]:
    query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=False)
    raw_date = query.get("date", [None])[0]
    try:
        show_date = date.fromisoformat(raw_date) if raw_date else date.today()
        preview_minutes_by_chain = _preview_minutes_from_request(environ, query)
        zip_code, radius_miles = _location_from_request(environ, query)
        enrichment_enabled = _parse_enrichment_enabled(query.get("enrich", ["true"])[0])
        stored = _STORE.load()
        signature = json.dumps(
            [show_date.isoformat(), zip_code, radius_miles, preview_minutes_by_chain,
             enrichment_enabled,
             {field: query.get(field, []) for field in
              ("movie", "theatre", "format", "start_after", "start_before", "end_by")},
             asdict(stored)],
            sort_keys=True,
        )
        response_key = (
            f"{zip_code}|{radius_miles}|{show_date.isoformat()}|"
            f"{hashlib.sha256(signature.encode()).hexdigest()}"
        )
        cached_payload = _DAILY_CACHE.get("responses", response_key)
        if isinstance(cached_payload, dict):
            return _json_response(start_response, 200, cached_payload, method)

        all_screenings = _SERVICE.get_screenings(
            show_date,
            preview_minutes_by_chain,
            zip_code=zip_code,
            radius_miles=radius_miles,
        )
        all_screenings = [
            _configure_screening_experience(screening, stored) for screening in all_screenings
        ]
        if enrichment_enabled:
            all_screenings = enrich_movie_metadata(
                all_screenings, _omdb_client(stored.omdb_api_key)
            )

            origin = _safe_zip_point(zip_code)
            if origin is not None:
                all_screenings = enrich_amc_details(
                    all_screenings,
                    show_date,
                    origin,
                    _amc_client(stored.amc_vendor_key),
                    a_list_enabled=stored.amc_a_list,
                )
            all_screenings = enrich_travel_times(all_screenings, _home_point(stored), _ROUTER)

        filters = ScreeningFilters(
            movies=frozenset(query.get("movie", [])),
            theatres=frozenset(query.get("theatre", [])),
            formats=frozenset(query.get("format", [])),
            start_after=query.get("start_after", [None])[0],
            start_before=query.get("start_before", [None])[0],
            end_by=query.get("end_by", [None])[0],
        )
        visible = filter_screenings(all_screenings, filters)
    except (ValueError, FandangoError, LocationError) as exc:
        status = 503 if isinstance(exc, (FandangoError, LocationError)) else 400
        return _json_response(start_response, status, {"error": str(exc)}, method)

    payload = {
        "date": show_date.isoformat(),
        "market_zip": zip_code,
        "radius_miles": radius_miles,
        "location": {
            "zip_code": zip_code,
            "radius_miles": radius_miles,
        },
        "preferences": stored.public_dict(),
        "preview_minutes_by_chain": preview_minutes_by_chain,
        "enrichment_enabled": enrichment_enabled,
        "count": len(visible),
        "total_count": len(all_screenings),
        "facets": facets(all_screenings),
        "screenings": [screening.to_dict() for screening in visible],
    }
    _DAILY_CACHE.set("responses", response_key, payload)
    return _json_response(start_response, 200, payload, method)


def _movie_availability_response(
    environ: dict, start_response: Callable, method: str
) -> Iterable[bytes]:
    """Summarize only *published* listings after the supplied planning date.

    Each date uses the normal location/radius screening cache, without AMC, OMDb,
    travel, or other optional enrichment. Missing provider dates are never treated
    as evidence that a movie has finished its theatrical run.
    """
    query = parse_qs(environ.get("QUERY_STRING", ""))
    try:
        raw_after = query.get("after", [])
        if len(raw_after) != 1:
            raise ValueError("one after date (YYYY-MM-DD) is required")
        after_date = date.fromisoformat(raw_after[0])
        zip_code, radius_miles = _location_from_request(environ, query)
    except ValueError as exc:
        return _json_response(start_response, 400, {"error": str(exc)}, method)

    days = 14
    dates = [after_date + timedelta(days=offset) for offset in range(1, days + 1)]
    window_end = dates[-1]
    successful_dates: list[str] = []
    unavailable_dates: list[str] = []
    movies: dict[str, dict[str, object]] = {}
    seen_showings: set[tuple[str, str]] = set()

    def load(show_date: date) -> list[Screening]:
        return _SERVICE.get_screenings(show_date, {}, zip_code=zip_code, radius_miles=radius_miles)

    # Bound remote fanout. ScreeningService caches base results by date/location.
    with ThreadPoolExecutor(max_workers=3) as pool:
        pending = {pool.submit(load, show_date): show_date for show_date in dates}
        for future in as_completed(pending):
            show_date = pending[future]
            try:
                screenings = future.result()
            except (FandangoError, LocationError, ValueError):
                unavailable_dates.append(show_date.isoformat())
                continue
            successful_dates.append(show_date.isoformat())
            for screening in screenings:
                listing_date = screening.advertised_start.date()
                if not after_date < listing_date <= window_end:
                    continue
                identity = (screening.showtime_id, screening.advertised_start.isoformat())
                if identity in seen_showings:
                    continue
                seen_showings.add(identity)
                entry = movies.setdefault(
                    screening.movie,
                    {"showtime_count": 0, "scheduled_dates": set()},
                )
                entry["showtime_count"] += 1
                entry["scheduled_dates"].add(listing_date.isoformat())

    if not successful_dates:
        return _json_response(
            start_response, 503, {"error": "Unable to retrieve later showtimes"}, method
        )
    summaries = {
        movie: {
            "showtime_count": entry["showtime_count"],
            "scheduled_days": len(entry["scheduled_dates"]),
            "last_scheduled_date": (
                max(entry["scheduled_dates"]) if entry["scheduled_dates"] else None
            ),
        }
        for movie, entry in movies.items()
    }
    return _json_response(
        start_response,
        200,
        {
            "after_date": after_date.isoformat(),
            "window_end": window_end.isoformat(),
            "checked_dates": sorted(successful_dates),
            "unavailable_dates": sorted(unavailable_dates),
            "movies": summaries,
        },
        method,
    )


def _movie_day_response(environ: dict, start_response: Callable, method: str) -> Iterable[bytes]:
    try:
        payload = _read_json_body(environ)
        if not isinstance(payload, dict):
            raise ValueError("movie-day payload must be an object")
        raw_date = payload.get("date")
        show_date = date.fromisoformat(str(raw_date)) if raw_date else date.today()
        movies = _required_string_list(payload, "movies")
        required_movies = _optional_string_list(payload, "required_movies")
        runtime_overrides = _runtime_overrides(payload, movies)
        showtime_ids = set(_required_string_list(payload, "showtime_ids", allow_empty=True))
        target_movie_count = _bounded_integer(
            payload.get("target_movie_count", len(movies)),
            "target_movie_count",
            minimum=1,
            maximum=len(movies),
        )
        sort_by = str(payload.get("sort_by", "elapsed") or "").strip()
        raw_secondary_sort_by = payload.get("secondary_sort_by")
        secondary_sort_by = (
            None if raw_secondary_sort_by is None else str(raw_secondary_sort_by or "").strip()
        )
        earliest_start = _optional_datetime(payload.get("earliest_start"), "earliest_start")
        latest_end = _optional_datetime(payload.get("latest_end"), "latest_end")
        if earliest_start is not None and latest_end is not None and latest_end < earliest_start:
            raise ValueError("latest_end must not be before earliest_start")
        minimum_buffer_minutes = _bounded_integer(
            payload.get("minimum_buffer_minutes", 0),
            "minimum_buffer_minutes",
            minimum=0,
            maximum=180,
        )
        offset = _bounded_integer(payload.get("offset", 0), "offset", minimum=0)
        limit = _bounded_integer(payload.get("limit", 50), "limit", minimum=1, maximum=100)

        query: dict[str, list[str]] = {}
        preview_minutes_by_chain = _preview_minutes_from_request(environ, query)
        zip_code, radius_miles = _location_from_request(environ, query)
        canonical = _SERVICE.get_screenings(
            show_date,
            preview_minutes_by_chain,
            zip_code=zip_code,
            radius_miles=radius_miles,
        )
        stored = _STORE.load()
        home = _home_point(stored)
        candidates = enrich_travel_times(
            [
                _apply_runtime_override(
                    _configure_screening_experience(screening, stored),
                    runtime_overrides.get(screening.movie),
                )
                for screening in canonical
                if screening.showtime_id in showtime_ids and screening.movie in movies
            ],
            home,
            _ROUTER,
        )
        try:
            travel = _ROUTER.travel_matrix(theatre_points(candidates))
            routing_available = True
        except RoutingError:
            travel = {}
            routing_available = False
        plan = plan_movie_day(
            candidates,
            movies,
            travel,
            target_movie_count=target_movie_count,
            required_movies=required_movies,
            earliest_start=earliest_start,
            latest_end=latest_end,
            home_configured=home is not None,
            sort_by=sort_by,
            secondary_sort_by=secondary_sort_by,
            minimum_buffer_minutes=minimum_buffer_minutes,
            offset=offset,
            limit=limit,
        )
    except (ValueError, FandangoError, LocationError) as exc:
        status = 503 if isinstance(exc, (FandangoError, LocationError)) else 400
        return _json_response(start_response, status, {"error": str(exc)}, method)

    response = plan.to_dict()
    response.update(
        {
            "date": show_date.isoformat(),
            "runtime_overrides": runtime_overrides,
            "earliest_start": (
                earliest_start.isoformat(timespec="minutes") if earliest_start is not None else None
            ),
            "latest_end": latest_end.isoformat(timespec="minutes")
            if latest_end is not None
            else None,
            "minimum_buffer_minutes": minimum_buffer_minutes,
            "routing_available": routing_available,
        }
    )
    return _json_response(start_response, 200, response, method)


def _settings_response(environ: dict, start_response: Callable, method: str) -> Iterable[bytes]:
    if method in {"GET", "HEAD"}:
        return _json_response(start_response, 200, _settings_payload(_STORE.load()), method)

    try:
        payload = _read_json_body(environ)
        if not isinstance(payload, dict):
            raise ValueError("settings payload must be an object")
        current = _STORE.load()
        changes: dict[str, object] = {}

        if "home_address" in payload:
            address = str(payload.get("home_address") or "").strip()
            if address:
                matched = _GEOCODER.geocode(address)
                changes.update(
                    home_address=address,
                    home_display_name=matched.display_name,
                    home_latitude=matched.point.latitude,
                    home_longitude=matched.point.longitude,
                )
            else:
                changes.update(
                    home_address="",
                    home_display_name="",
                    home_latitude=None,
                    home_longitude=None,
                )

        if "amc_a_list" in payload:
            if not isinstance(payload["amc_a_list"], bool):
                raise ValueError("amc_a_list must be true or false")
            changes["amc_a_list"] = payload["amc_a_list"]

        _apply_secret_change(
            payload,
            changes,
            field="amc_vendor_key",
            clear_field="clear_amc_vendor_key",
            current_value=current.amc_vendor_key,
        )
        _apply_secret_change(
            payload,
            changes,
            field="omdb_api_key",
            clear_field="clear_omdb_api_key",
            current_value=current.omdb_api_key,
        )
        if "experience_deviations" in payload:
            impacts, disabled = _parse_experience_deviation_settings(
                payload["experience_deviations"],
                current,
            )
            changes["experience_deviation_impacts"] = impacts
            changes["disabled_experience_deviations"] = disabled
        updated = _STORE.update(**changes) if changes else current
    except ValueError as exc:
        return _json_response(start_response, 400, {"error": str(exc)}, method)
    except GeocodingError as exc:
        return _json_response(start_response, 503, {"error": str(exc)}, method)

    return _json_response(start_response, 200, _settings_payload(updated), method)


def _settings_payload(settings: PersistentSettings) -> dict[str, object]:
    payload = settings.public_dict()
    payload["provider_usage"] = {
        "omdb": _PROVIDER_CACHE.status("omdb", published_daily_limit=OMDB_DAILY_LIMIT),
        "amc": _PROVIDER_CACHE.status("amc"),
    }
    payload["experience_deviations"] = experience_settings_payload(
        settings.experience_deviation_impacts,
        settings.disabled_experience_deviations,
    )
    return payload


def _parse_experience_deviation_settings(
    value: object,
    current: PersistentSettings,
) -> tuple[dict[str, int], tuple[str, ...]]:
    if not isinstance(value, list):
        raise ValueError("experience_deviations must be a list")

    known_ids = experience_rule_ids()
    impacts = dict(current.experience_deviation_impacts)
    disabled = set(current.disabled_experience_deviations)
    seen: set[str] = set()

    for item in value:
        if not isinstance(item, dict):
            raise ValueError("each experience deviation must be an object")
        rule_id = str(item.get("id") or "").strip()
        if rule_id not in known_ids:
            raise ValueError(f"unknown experience deviation: {rule_id or 'missing id'}")
        if rule_id in seen:
            raise ValueError(f"duplicate experience deviation: {rule_id}")
        seen.add(rule_id)

        enabled = item.get("enabled")
        if not isinstance(enabled, bool):
            raise ValueError(f"{rule_id} enabled must be true or false")
        raw_score = item.get("score_delta")
        if isinstance(raw_score, bool) or not isinstance(raw_score, int):
            raise ValueError(f"{rule_id} impact must be a whole number")
        if raw_score == 0 or not -10 <= raw_score <= 10:
            raise ValueError(f"{rule_id} impact must be a non-zero whole number from -10 to 10")

        impacts[rule_id] = raw_score
        if enabled:
            disabled.discard(rule_id)
        else:
            disabled.add(rule_id)

    return impacts, tuple(sorted(disabled))


def _configure_screening_experience(
    screening: Screening,
    settings: PersistentSettings,
) -> Screening:
    return replace(
        screening,
        experience_deviations=configure_experience(
            screening.experience_deviations,
            score_overrides=settings.experience_deviation_impacts,
            disabled=settings.disabled_experience_deviations,
        ),
    )


def _apply_secret_change(
    payload: dict[str, object],
    changes: dict[str, object],
    *,
    field: str,
    clear_field: str,
    current_value: str,
) -> None:
    if payload.get(clear_field) is True:
        changes[field] = ""
        return
    if field not in payload:
        return
    raw = payload.get(field)
    if raw is None:
        return
    if not isinstance(raw, str):
        raise ValueError(f"{field} must be a string")
    value = raw.strip()
    changes[field] = value if value else current_value


def _read_json_body(environ: dict) -> object:
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid request body length") from exc
    if length <= 0:
        return {}
    stream = environ.get("wsgi.input")
    if stream is None:
        raise ValueError("request body is missing")
    try:
        return json.loads(stream.read(length))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("request body must be valid JSON") from exc


def _required_string_list(
    payload: dict[str, object],
    field: str,
    *,
    allow_empty: bool = False,
) -> list[str]:
    raw = payload.get(field)
    if not isinstance(raw, list) or any(not isinstance(value, str) for value in raw):
        raise ValueError(f"{field} must be a list of strings")
    values = list(dict.fromkeys(value.strip() for value in raw if value.strip()))
    if not values and not allow_empty:
        raise ValueError(f"{field} must contain at least one value")
    return values


def _optional_string_list(payload: dict[str, object], field: str) -> list[str]:
    if field not in payload:
        return []
    return _required_string_list(payload, field, allow_empty=True)


def _runtime_overrides(payload: dict[str, object], movies: list[str]) -> dict[str, int]:
    raw = payload.get("runtime_overrides", {})
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("runtime_overrides must be an object keyed by movie title")

    selected = set(movies)
    overrides: dict[str, int] = {}
    for movie, value in raw.items():
        if not isinstance(movie, str) or movie.strip() not in selected:
            raise ValueError("runtime_overrides keys must be selected movies")
        normalized_movie = movie.strip()
        overrides[normalized_movie] = _bounded_integer(
            value,
            f"runtime_overrides[{normalized_movie}]",
            minimum=1,
            maximum=600,
        )
    return overrides


def _apply_runtime_override(screening: Screening, runtime_minutes: int | None) -> Screening:
    if runtime_minutes is None:
        return screening
    estimated_end = (
        screening.actual_start + timedelta(minutes=runtime_minutes)
        if screening.actual_start is not None
        else None
    )
    return replace(
        screening,
        runtime_minutes=runtime_minutes,
        estimated_end=estimated_end,
    )


def _optional_datetime(value: object, field: str) -> datetime | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO local datetime")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO local datetime") from exc
    if parsed.tzinfo is not None:
        raise ValueError(f"{field} must not include a timezone offset")
    return parsed


def _bounded_integer(
    value: object,
    field: str,
    *,
    minimum: int,
    maximum: int | None = None,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    if value < minimum or (maximum is not None and value > maximum):
        if maximum is None:
            raise ValueError(f"{field} must be {minimum} or greater")
        raise ValueError(f"{field} must be between {minimum} and {maximum}")
    return value


def _omdb_client(api_key: str) -> OmdbClient | None:
    key = api_key.strip()
    if not key:
        return None
    with _CLIENT_LOCK:
        return _OMDB_CLIENTS.setdefault(key, OmdbClient(key, provider_cache=_PROVIDER_CACHE))


def _amc_client(vendor_key: str) -> AMCClient | None:
    key = vendor_key.strip()
    if not key:
        return None
    with _CLIENT_LOCK:
        return _AMC_CLIENTS.setdefault(key, AMCClient(key, provider_cache=_PROVIDER_CACHE))


def _home_point(settings: PersistentSettings) -> GeoPoint | None:
    if settings.home_latitude is None or settings.home_longitude is None:
        return None
    return GeoPoint(settings.home_latitude, settings.home_longitude)


def _safe_zip_point(zip_code: str) -> GeoPoint | None:
    try:
        return _ZIP_LOCATOR.lookup_zip(zip_code)
    except (LocationError, ValueError):
        return None


def _parse_enrichment_enabled(value: object) -> bool:
    normalized = str(value or "").strip().casefold()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError("enrich must be true or false")


def _preview_minutes_from_request(environ: dict, query: dict[str, list[str]]) -> dict[str, int]:
    cookie_settings = _parse_preview_cookie(environ.get("HTTP_COOKIE", ""))
    if cookie_settings is not None:
        return cookie_settings
    return _parse_preview_minutes(query.get("preview", []))


def _location_from_request(
    environ: dict,
    query: dict[str, list[str]],
) -> tuple[str, int]:
    cookie_location = _parse_location_cookie(environ.get("HTTP_COOKIE", ""))
    if cookie_location is not None:
        return cookie_location

    zip_code = query.get("zip", [_SETTINGS.zip_code])[0]
    raw_radius = query.get("radius", [str(_SETTINGS.radius_miles)])[0]
    return _parse_location_values(zip_code, raw_radius)


def _parse_preview_cookie(header: str) -> dict[str, int] | None:
    if not header:
        return None

    cookie = SimpleCookie()
    try:
        cookie.load(header)
    except Exception:
        return None

    morsel = cookie.get(PREVIEW_COOKIE)
    if morsel is None:
        return None

    try:
        payload = json.loads(unquote(morsel.value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}

    if not isinstance(payload, dict):
        return {}

    previews: dict[str, int] = {}
    for chain, minutes in payload.items():
        if not isinstance(chain, str) or not chain.strip():
            continue
        if isinstance(minutes, bool) or not isinstance(minutes, int):
            continue
        if 0 <= minutes <= 180:
            previews[chain.strip()] = minutes
    return previews


def _parse_location_cookie(header: str) -> tuple[str, int] | None:
    if not header:
        return None

    cookie = SimpleCookie()
    try:
        cookie.load(header)
    except Exception:
        return None

    morsel = cookie.get(LOCATION_COOKIE)
    if morsel is None:
        return None

    try:
        payload = json.loads(unquote(morsel.value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None
    try:
        return _parse_location_values(payload.get("zipCode"), payload.get("radiusMiles"))
    except ValueError:
        return None


def _parse_location_values(zip_code: object, radius_miles: object) -> tuple[str, int]:
    normalized_zip = str(zip_code or "").strip()
    if len(normalized_zip) != 5 or not normalized_zip.isdigit():
        raise ValueError("zip must be a five-digit US ZIP code")

    try:
        radius = int(radius_miles)
    except (TypeError, ValueError) as exc:
        raise ValueError("radius must be an integer") from exc
    if not 1 <= radius <= 100:
        raise ValueError("radius must be between 1 and 100 miles")
    return normalized_zip, radius


def _parse_preview_minutes(values: list[str]) -> dict[str, int]:
    previews: dict[str, int] = {}
    for value in values:
        chain, separator, raw_minutes = value.rpartition(":")
        chain = chain.strip()
        if not separator or not chain:
            raise ValueError("preview must use 'Chain Name:minutes'")
        try:
            minutes = int(raw_minutes)
        except ValueError as exc:
            raise ValueError(f"Preview minutes for {chain} must be an integer") from exc
        if not 0 <= minutes <= 180:
            raise ValueError(f"Preview minutes for {chain} must be between 0 and 180")
        previews[chain] = minutes
    return previews


def _cache_status() -> dict[str, object]:
    with _REFRESH_LOCK:
        running = dict(_REFRESH_STATUS)
        running["errors"] = list(_REFRESH_STATUS["errors"])
    return {**_DAILY_CACHE.status(), **running}


def _start_refresh(zip_code: str, radius: int, previews: dict[str, int]) -> dict[str, object]:
    with _REFRESH_LOCK:
        if _REFRESH_STATUS["running"]:
            return _cache_status_unlocked()
        _REFRESH_STATUS.update(
            running=True, completed=0, total=15,
            started_at=datetime.now().isoformat(), finished_at=None, errors=[],
        )
        worker = threading.Thread(
            target=_refresh_worker,
            args=(zip_code, radius, dict(previews)),
            name="daily-showtime-cache-refresh",
            daemon=True,
        )
        worker.start()
        return _cache_status_unlocked()


def _cache_status_unlocked() -> dict[str, object]:
    return {**_DAILY_CACHE.status(), **_REFRESH_STATUS.copy()}


def _refresh_worker(zip_code: str, radius: int, previews: dict[str, int]) -> None:
    try:
        for offset in range(15):
            show_date = date.fromisoformat(cache_day()) + timedelta(days=offset)
            try:
                _SERVICE.refresh_date(show_date, zip_code=zip_code, radius_miles=radius)
                # Keep the previous good response until base data has been refreshed.
                _DAILY_CACHE.delete_prefix(
                    "responses", f"{zip_code}|{radius}|{show_date.isoformat()}|"
                )
                params = [
                    ("date", show_date.isoformat()), ("zip", zip_code), ("radius", str(radius)),
                ]
                params.extend(("preview", f"{chain}:{minutes}") for chain, minutes in previews.items())
                environ = {"REQUEST_METHOD": "GET", "QUERY_STRING": urlencode(params)}
                # Warm the complete enriched API representation as well as the base date.
                # Optional enrichment failure is isolated to this date.
                list(_screenings_response(environ, lambda *_: None, "GET"))
            except Exception as exc:
                with _REFRESH_LOCK:
                    errors = _REFRESH_STATUS["errors"]
                    if isinstance(errors, list):
                        errors.append(f"{show_date.isoformat()}: {type(exc).__name__}")
            finally:
                with _REFRESH_LOCK:
                    _REFRESH_STATUS["completed"] = offset + 1
    finally:
        with _REFRESH_LOCK:
            _REFRESH_STATUS["running"] = False
            _REFRESH_STATUS["finished_at"] = datetime.now().isoformat()


def _daily_scheduler() -> None:
    last_day = ""
    while True:
        today = cache_day()
        if today != last_day:
            last_day = today
            if int(_DAILY_CACHE.status()["base_dates"]) < 15:
                _start_refresh(_SETTINGS.zip_code, _SETTINGS.radius_miles, {})
        time.sleep(60)


class ThreadedWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


def _static_response(
    start_response: Callable,
    relative_path: str,
    method: str,
    *,
    requested_path: str,
) -> Iterable[bytes]:
    path = Path(relative_path)
    if path.is_absolute() or ".." in path.parts:
        return _json_response(
            start_response, 404, {"error": "not found", "path": requested_path}, method
        )

    asset = next((root / path for root in STATIC_ROOTS if (root / path).is_file()), None)
    if asset is None:
        return _json_response(
            start_response, 404, {"error": "not found", "path": requested_path}, method
        )

    body = asset.read_bytes()
    content_type = mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
    if content_type.startswith("text/") or content_type in {
        "application/javascript",
        "application/json",
    }:
        content_type = f"{content_type}; charset=utf-8"
    cache_control = (
        "public, max-age=31536000, immutable" if relative_path.startswith("assets/") else "no-cache"
    )
    start_response(
        "200 OK",
        [
            ("Content-Type", content_type),
            ("Content-Length", str(len(body))),
            ("Cache-Control", cache_control),
        ],
    )
    return [] if method == "HEAD" else [body]


def _json_response(
    start_response: Callable, status: int, payload: object, method: str
) -> Iterable[bytes]:
    body = json.dumps(payload).encode("utf-8")
    reason = {
        200: "OK",
        400: "Bad Request",
        404: "Not Found",
        405: "Method Not Allowed",
        503: "Service Unavailable",
    }[status]
    headers = [*JSON_HEADERS, ("Content-Length", str(len(body)))]
    start_response(f"{status} {reason}", headers)
    return [] if method == "HEAD" else [body]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the movie showtime aggregator.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)

    threading.Thread(target=_daily_scheduler, name="daily-cache-scheduler", daemon=True).start()
    with make_server(args.host, args.port, application, server_class=ThreadedWSGIServer) as httpd:
        print(f"serving on http://{args.host}:{args.port}")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
