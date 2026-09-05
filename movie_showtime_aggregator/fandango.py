from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

from .config import Theatre

FANDANGO_BASE_URL = "https://www.fandango.com"
FANDANGO_USER_AGENT = " ".join(
    (
        "Mozilla/5.0 (X11; Linux x86_64)",
        "AppleWebKit/537.36",
        "Chrome/150",
        "Safari/537.36",
    )
)


class FandangoError(RuntimeError):
    pass


class FandangoClient:
    def __init__(self, *, timeout_seconds: int = 15) -> None:
        self.timeout_seconds = timeout_seconds

    def fetch_showtimes(self, theatre: Theatre, show_date: date) -> list[dict[str, object]]:
        params = urllib.parse.urlencode(
            {
                "chainCode": "AMC",
                "startDate": show_date.isoformat(),
                "isdesktop": "true",
                "partnerRestrictedTicketing": "",
            }
        )
        url = f"{FANDANGO_BASE_URL}/napi/theaterMovieShowtimes/{theatre.fandango_id}?{params}"
        referer = (
            f"{FANDANGO_BASE_URL}/{_theatre_slug(theatre)}/theater-page"
            f"?date={show_date.isoformat()}"
        )
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": FANDANGO_USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": referer,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            raise FandangoError(f"Fandango returned HTTP {exc.code}") from exc
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            json.JSONDecodeError,
        ) as exc:
            raise FandangoError(f"Fandango request failed: {exc}") from exc

        if not isinstance(payload, dict):
            raise FandangoError("Fandango returned an unexpected response")
        return flatten_showtimes(payload)


def flatten_showtimes(payload: dict[str, object]) -> list[dict[str, object]]:
    view_model = payload.get("viewModel")
    if not isinstance(view_model, dict):
        raise FandangoError("Fandango response did not contain a view model")
    movies = view_model.get("movies")
    if not isinstance(movies, list):
        raise FandangoError("Fandango response did not contain a movie list")

    flattened: list[dict[str, object]] = []
    for movie in movies:
        if not isinstance(movie, dict):
            continue
        title = _clean_title(str(movie.get("title") or ""))
        runtime = movie.get("runtime")
        variants = movie.get("variants")
        if not title or not isinstance(variants, list):
            continue

        for variant in variants:
            if not isinstance(variant, dict):
                continue
            header = str(variant.get("filmFormatHeader") or "")
            groups = variant.get("amenityGroups")
            if not isinstance(groups, list):
                continue

            for group in groups:
                if not isinstance(group, dict):
                    continue
                format_name = _format_name(header, group)
                showtimes = group.get("showtimes")
                if not isinstance(showtimes, list):
                    continue

                for showtime in showtimes:
                    if not isinstance(showtime, dict):
                        continue
                    ticketing_date = str(showtime.get("ticketingDate") or "").strip()
                    if not ticketing_date:
                        continue
                    flattened.append(
                        {
                            "id": showtime.get("id") or showtime.get("showtimeHashCode"),
                            "showtimeHashCode": showtime.get("showtimeHashCode"),
                            "movieName": title,
                            "showDateTimeLocal": ticketing_date.replace("+", "T", 1),
                            "runTime": runtime,
                            "premiumFormat": _showtime_format(showtime, format_name),
                            "purchaseUrl": showtime.get("ticketingJumpPageURL") or "",
                            "isCanceled": False,
                            "isSoldOut": bool(showtime.get("isSoldOut")),
                            "isExpired": bool(showtime.get("expired")),
                        }
                    )
    return flattened


def _theatre_slug(theatre: Theatre) -> str:
    name = re.sub(r"[^a-z0-9]+", "-", theatre.name.lower()).strip("-")
    return f"{name}-{theatre.fandango_id.lower()}"


def _clean_title(title: str) -> str:
    return re.sub(r"\s+\(\d{4}\)$", "", title).strip()


def _showtime_format(showtime: dict[str, object], fallback: str) -> str:
    film_format = showtime.get("filmFormat")
    texts: list[str] = []
    if isinstance(film_format, list):
        for entry in film_format:
            if isinstance(entry, dict):
                texts.extend(str(entry.get(key) or "") for key in ("filterName", "name", "code"))
            else:
                texts.append(str(entry))
    specific = _canonical_format(" ".join(texts))
    return specific if specific != "Standard" else fallback


def _format_name(header: str, group: dict[str, object]) -> str:
    texts = [header]
    if group.get("isDolby"):
        texts.append("Dolby")
    amenities = group.get("amenities")
    if isinstance(amenities, list):
        for amenity in amenities:
            if isinstance(amenity, dict):
                texts.append(str(amenity.get("name") or ""))
            else:
                texts.append(str(amenity))
    return _canonical_format(" ".join(texts))


def _canonical_format(value: str) -> str:
    upper = value.upper()
    if "IMAX" in upper and "70MM" in upper:
        return "IMAX 70mm"
    if "DOLBY" in upper:
        return "Dolby Cinema"
    if "IMAX" in upper:
        return "IMAX"
    if "SCREENX" in upper:
        return "ScreenX"
    if "PRIME" in upper:
        return "PRIME"
    if "REALD" in upper:
        return "RealD 3D"
    if "3D" in upper:
        return "3D"
    if "70MM" in upper:
        return "70mm"
    if "LASER" in upper:
        return "Laser"
    if "PREMIUM" in upper:
        return "Premium Format"
    return "Standard"
