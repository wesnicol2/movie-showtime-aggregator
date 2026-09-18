from __future__ import annotations

import argparse
import json
import mimetypes
import threading
from collections.abc import Callable, Iterable
from datetime import date, datetime
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, unquote
from wsgiref.simple_server import make_server

from .amc import AMCClient
from .config import Settings
from .enrichment import enrich_amc_details, enrich_movie_metadata, enrich_travel_times
from .fandango import FandangoClient, FandangoError
from .location import GeoPoint, LocationError, ZipLocator
from .metadata import OMDB_DAILY_LIMIT, OmdbClient
from .planner import plan_movie_day, theatre_points
from .provider_cache import ProviderCache
from .routing import AddressGeocoder, GeocodingError, OsrmRouter, RoutingError
from .service import ScreeningFilters, ScreeningService, facets, filter_screenings
from .storage import PersistentSettings, SettingsStore

JSON_HEADERS = [("Content-Type", "application/json; charset=utf-8")]
STATIC_DIR = Path(__file__).with_name("static")
SOURCE_STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
STATIC_ROOTS = (STATIC_DIR, SOURCE_STATIC_DIR)
SPA_ROUTES = {"/", "/movies", "/plan", "/settings"}
PREVIEW_COOKIE = "movie_preview_minutes"
LOCATION_COOKIE = "movie_location"

_SETTINGS = Settings.from_env()
_SERVICE = ScreeningService(FandangoClient(), _SETTINGS)
_STORE = SettingsStore()
_PROVIDER_CACHE = ProviderCache()
_GEOCODER = AddressGeocoder()
_ROUTER = OsrmRouter()
_ZIP_LOCATOR = ZipLocator()
_CLIENT_LOCK = threading.Lock()
_OMDB_CLIENTS: dict[str, OmdbClient] = {}
_AMC_CLIENTS: dict[str, AMCClient] = {}


def health() -> dict[str, str]:
    return {"status": "ok"}


def application(environ: dict, start_response: Callable) -> Iterable[bytes]:
    path = environ.get("PATH_INFO", "/").rstrip("/") or "/"
    method = environ.get("REQUEST_METHOD", "GET")

    if path == "/api/settings":
        if method not in {"GET", "HEAD", "POST"}:
            return _json_response(start_response, 405, {"error": "method not allowed"}, method)
        return _settings_response(environ, start_response, method)

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
        all_screenings = _SERVICE.get_screenings(
            show_date,
            preview_minutes_by_chain,
            zip_code=zip_code,
            radius_miles=radius_miles,
        )
        stored = _STORE.load()
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
    return _json_response(start_response, 200, payload, method)


def _movie_day_response(environ: dict, start_response: Callable, method: str) -> Iterable[bytes]:
    try:
        payload = _read_json_body(environ)
        if not isinstance(payload, dict):
            raise ValueError("movie-day payload must be an object")
        raw_date = payload.get("date")
        show_date = date.fromisoformat(str(raw_date)) if raw_date else date.today()
        movies = _required_string_list(payload, "movies")
        required_movies = _optional_string_list(payload, "required_movies")
        showtime_ids = set(_required_string_list(payload, "showtime_ids", allow_empty=True))
        target_movie_count = _bounded_integer(
            payload.get("target_movie_count", len(movies)),
            "target_movie_count",
            minimum=1,
            maximum=len(movies),
        )
        sort_by = str(payload.get("sort_by", "elapsed") or "").strip()
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
        candidates = [
            screening
            for screening in canonical
            if screening.showtime_id in showtime_ids and screening.movie in movies
        ]
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
            sort_by=sort_by,
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
    return payload


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

    with make_server(args.host, args.port, application) as httpd:
        print(f"serving on http://{args.host}:{args.port}")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
