from __future__ import annotations

import argparse
import json
from collections.abc import Callable, Iterable
from datetime import date
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, unquote
from wsgiref.simple_server import make_server

from .config import Settings
from .fandango import FandangoClient, FandangoError
from .location import LocationError
from .service import ScreeningFilters, ScreeningService, facets, filter_screenings

JSON_HEADERS = [("Content-Type", "application/json; charset=utf-8")]
STATIC_DIR = Path(__file__).with_name("static")
PREVIEW_COOKIE = "movie_preview_minutes"
LOCATION_COOKIE = "movie_location"
STATIC_ROUTES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/settings": ("settings.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/settings.js": ("settings.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}

_SETTINGS = Settings.from_env()
_SERVICE = ScreeningService(FandangoClient(), _SETTINGS)


def health() -> dict[str, str]:
    return {"status": "ok"}


def application(environ: dict, start_response: Callable) -> Iterable[bytes]:
    path = environ.get("PATH_INFO", "/").rstrip("/") or "/"
    method = environ.get("REQUEST_METHOD", "GET")

    if method not in {"GET", "HEAD"}:
        return _json_response(start_response, 405, {"error": "method not allowed"}, method)

    if path == "/health":
        return _json_response(start_response, 200, health(), method)
    if path == "/api/screenings":
        return _screenings_response(environ, start_response, method)
    if path in STATIC_ROUTES:
        return _static_response(start_response, path, method)
    return _json_response(start_response, 404, {"error": "not found", "path": path}, method)


def _screenings_response(environ: dict, start_response: Callable, method: str) -> Iterable[bytes]:
    query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=False)
    raw_date = query.get("date", [None])[0]
    try:
        show_date = date.fromisoformat(raw_date) if raw_date else date.today()
        preview_minutes_by_chain = _preview_minutes_from_request(environ, query)
        zip_code, radius_miles = _location_from_request(environ, query)
        all_screenings = _SERVICE.get_screenings(
            show_date,
            preview_minutes_by_chain,
            zip_code=zip_code,
            radius_miles=radius_miles,
        )
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
        "preview_minutes_by_chain": preview_minutes_by_chain,
        "count": len(visible),
        "total_count": len(all_screenings),
        "facets": facets(all_screenings),
        "screenings": [screening.to_dict() for screening in visible],
    }
    return _json_response(start_response, 200, payload, method)


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


def _static_response(start_response: Callable, path: str, method: str) -> Iterable[bytes]:
    filename, content_type = STATIC_ROUTES[path]
    body = (STATIC_DIR / filename).read_bytes()
    start_response(
        "200 OK",
        [("Content-Type", content_type), ("Content-Length", str(len(body)))],
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
