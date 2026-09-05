from __future__ import annotations

import argparse
import json
from collections.abc import Callable, Iterable
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs
from wsgiref.simple_server import make_server

from .config import Settings
from .fandango import FandangoClient, FandangoError
from .service import ScreeningFilters, ScreeningService, facets, filter_screenings

JSON_HEADERS = [("Content-Type", "application/json; charset=utf-8")]
STATIC_DIR = Path(__file__).with_name("static")
STATIC_ROUTES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
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
        all_screenings = _SERVICE.get_screenings(show_date)
        filters = ScreeningFilters(
            movies=frozenset(query.get("movie", [])),
            theatres=frozenset(query.get("theatre", [])),
            formats=frozenset(query.get("format", [])),
            start_after=query.get("start_after", [None])[0],
            start_before=query.get("start_before", [None])[0],
            end_by=query.get("end_by", [None])[0],
        )
        visible = filter_screenings(all_screenings, filters)
    except (ValueError, FandangoError) as exc:
        status = 503 if isinstance(exc, FandangoError) else 400
        return _json_response(start_response, status, {"error": str(exc)}, method)

    payload = {
        "date": show_date.isoformat(),
        "preshow_minutes": _SETTINGS.preshow_minutes,
        "count": len(visible),
        "total_count": len(all_screenings),
        "facets": facets(all_screenings),
        "screenings": [screening.to_dict() for screening in visible],
    }
    return _json_response(start_response, 200, payload, method)


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
