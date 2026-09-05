from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

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

    def fetch_showtimes(
        self, zip_code: str, show_date: date, *, page_limit: int = 50
    ) -> list[dict[str, object]]:
        flattened: list[dict[str, object]] = []
        page = 1
        while True:
            payload = self._fetch_market_page(zip_code, show_date, page=page, limit=page_limit)
            theaters = payload.get("theaters")
            if not isinstance(theaters, list):
                raise FandangoError("Fandango response did not contain a theater list")

            flattened.extend(flatten_market_showtimes(payload))
            if len(theaters) < page_limit:
                break
            page += 1
            if page > 20:
                raise FandangoError("Fandango theater pagination exceeded 20 pages")
        return flattened

    def _fetch_market_page(
        self, zip_code: str, show_date: date, *, page: int, limit: int
    ) -> dict[str, object]:
        params = urllib.parse.urlencode(
            {
                "zipCode": zip_code,
                "city": "",
                "state": "",
                "date": show_date.isoformat(),
                "page": page,
                "favTheaterOnly": "false",
                "limit": limit,
                "isdesktop": "true",
            }
        )
        url = f"{FANDANGO_BASE_URL}/napi/theaterswithshowtimes?{params}"
        referer = (
            f"{FANDANGO_BASE_URL}/{zip_code}_movietimes"
            f"?mode=general&q={zip_code}&date={show_date.isoformat()}"
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
        return payload


def flatten_market_showtimes(payload: dict[str, object]) -> list[dict[str, object]]:
    theaters = payload.get("theaters")
    if not isinstance(theaters, list):
        raise FandangoError("Fandango response did not contain a theater list")

    flattened: list[dict[str, object]] = []
    for theater in theaters:
        if not isinstance(theater, dict):
            continue
        theatre_name = str(theater.get("name") or "").strip()
        chain_name = str(theater.get("chainName") or "Independent").strip() or "Independent"
        theatre_zip = str(theater.get("zip") or "").strip()
        latitude, longitude = _theater_coordinates(theater)
        movies = theater.get("movies")
        if not theatre_name or not isinstance(movies, list):
            continue

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
                        showtime_type = str(showtime.get("type") or "").casefold()
                        flattened.append(
                            {
                                "id": showtime.get("id") or showtime.get("showtimeHashCode"),
                                "showtimeHashCode": showtime.get("showtimeHashCode"),
                                "movieName": title,
                                "theatreName": theatre_name,
                                "chainName": chain_name,
                                "theatreZip": theatre_zip,
                                "theatreLatitude": latitude,
                                "theatreLongitude": longitude,
                                "showDateTimeLocal": ticketing_date.replace("+", "T", 1),
                                "runTime": runtime,
                                "premiumFormat": _showtime_format(showtime, format_name),
                                "purchaseUrl": showtime.get("ticketingJumpPageURL") or "",
                                "isCanceled": False,
                                "isSoldOut": bool(showtime.get("isSoldOut"))
                                or showtime_type == "soldout",
                                "isExpired": bool(showtime.get("expired"))
                                or showtime_type == "pastshowtime",
                            }
                        )
    return flattened


def _theater_coordinates(theater: dict[str, object]) -> tuple[object, object]:
    geo = theater.get("geo")
    if not isinstance(geo, dict):
        return None, None
    return geo.get("latitude"), geo.get("longitude")


def _clean_title(title: str) -> str:
    return title.strip()


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
    if "XD" in upper:
        return "XD"
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
