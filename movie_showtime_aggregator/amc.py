from __future__ import annotations

import json
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime

from .location import GeoPoint, distance_miles

AMC_BASE_URL = "https://api.amctheatres.com"
USER_AGENT = "movie-showtime-aggregator/1.0"


class AMCError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class AMCTheatre:
    theatre_id: int
    name: str
    point: GeoPoint | None


@dataclass(frozen=True, slots=True)
class AMCShowtime:
    performance_id: int
    theatre: AMCTheatre
    movie_name: str
    start_local: datetime
    ticket_price: float | None
    a_list_eligible: bool
    purchase_url: str


class AMCClient:
    def __init__(self, vendor_key: str, *, timeout_seconds: int = 10) -> None:
        self.vendor_key = vendor_key.strip()
        self.timeout_seconds = timeout_seconds
        self._theatre_cache: dict[int, AMCTheatre] = {}
        self._seat_cache: dict[tuple[int, int], float | None] = {}
        self._lock = threading.Lock()

    def showtimes_near(self, show_date: date, point: GeoPoint) -> list[AMCShowtime]:
        if not self.vendor_key:
            raise AMCError("AMC developer key is not configured")

        raw_showtimes: list[dict[str, object]] = []
        page = 1
        while True:
            payload = self._get(
                (
                    f"/v2/showtimes/views/current-location/{show_date.isoformat()}/"
                    f"{point.latitude:.6f}/{point.longitude:.6f}"
                ),
                {"page-number": page, "page-size": 100},
            )
            embedded = payload.get("_embedded")
            rows = embedded.get("showtimes") if isinstance(embedded, dict) else None
            if not isinstance(rows, list):
                raise AMCError("AMC showtime response did not contain showtimes")
            raw_showtimes.extend(row for row in rows if isinstance(row, dict))

            count = _int(payload.get("count"))
            if len(rows) < 100 or (count is not None and len(raw_showtimes) >= count):
                break
            page += 1
            if page > 20:
                raise AMCError("AMC showtime pagination exceeded 20 pages")

        theatre_ids = sorted(
            {
                theatre_id
                for row in raw_showtimes
                if (theatre_id := _int(row.get("theatreId"))) is not None
            }
        )
        theatres = {theatre_id: self.theatre(theatre_id) for theatre_id in theatre_ids}

        result: list[AMCShowtime] = []
        for raw in raw_showtimes:
            parsed = _parse_showtime(raw, theatres)
            if parsed is not None:
                result.append(parsed)
        return result

    def theatre(self, theatre_id: int) -> AMCTheatre:
        with self._lock:
            cached = self._theatre_cache.get(theatre_id)
            if cached is not None:
                return cached

        payload = self._get(f"/v2/theatres/{theatre_id}")
        theatre = _parse_theatre(payload, theatre_id)
        with self._lock:
            self._theatre_cache[theatre_id] = theatre
        return theatre

    def seats_left_percent(self, theatre_id: int, performance_id: int) -> float | None:
        cache_key = (theatre_id, performance_id)
        with self._lock:
            if cache_key in self._seat_cache:
                return self._seat_cache[cache_key]

        try:
            payload = self._get(f"/v2/seating-layouts/{theatre_id}/{performance_id}")
            percentage = _seat_percentage(payload)
        except AMCError:
            percentage = None

        with self._lock:
            self._seat_cache[cache_key] = percentage
        return percentage

    def _get(
        self,
        path: str,
        params: dict[str, object] | None = None,
    ) -> dict[str, object]:
        query = f"?{urllib.parse.urlencode(params)}" if params else ""
        request = urllib.request.Request(
            f"{AMC_BASE_URL}{path}{query}",
            headers={
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
                "X-AMC-Vendor-Key": self.vendor_key,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            raise AMCError(f"AMC returned HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise AMCError(f"AMC request failed: {exc}") from exc

        if not isinstance(payload, dict):
            raise AMCError("AMC returned an unexpected response")
        return payload


def match_showtime(
    movie_name: str,
    theatre_name: str,
    advertised_start: datetime,
    theatre_point: GeoPoint | None,
    candidates: list[AMCShowtime],
) -> AMCShowtime | None:
    movie_key = _normalize(movie_name)
    theatre_key = _normalize(theatre_name)
    best: tuple[float, AMCShowtime] | None = None

    for candidate in candidates:
        if _normalize(candidate.movie_name) != movie_key:
            continue
        difference = abs((candidate.start_local - advertised_start).total_seconds()) / 60
        if difference > 5:
            continue

        candidate_theatre_key = _normalize(candidate.theatre.name)
        if candidate_theatre_key == theatre_key:
            score = difference
        elif theatre_point is not None and candidate.theatre.point is not None:
            score = 10 + distance_miles(theatre_point, candidate.theatre.point) + difference
        else:
            continue

        if best is None or score < best[0]:
            best = (score, candidate)

    return best[1] if best is not None else None


def _parse_showtime(
    raw: dict[str, object],
    theatres: dict[int, AMCTheatre],
) -> AMCShowtime | None:
    performance_id = _int(raw.get("id"))
    theatre_id = _int(raw.get("theatreId"))
    movie_name = str(raw.get("movieName") or raw.get("sortableMovieName") or "").strip()
    raw_start = str(raw.get("showDateTimeLocal") or "").strip()
    if performance_id is None or theatre_id is None or not movie_name or not raw_start:
        return None
    theatre = theatres.get(theatre_id)
    if theatre is None:
        return None

    try:
        start = datetime.fromisoformat(raw_start.replace("Z", "+00:00"))
    except ValueError:
        return None
    if start.tzinfo is not None:
        start = start.replace(tzinfo=None)

    return AMCShowtime(
        performance_id=performance_id,
        theatre=theatre,
        movie_name=movie_name,
        start_local=start,
        ticket_price=_ticket_price(raw.get("ticketPrices")),
        a_list_eligible=not _has_no_a_list(raw.get("attributes")),
        purchase_url=str(raw.get("purchaseUrl") or "").strip(),
    )


def _parse_theatre(payload: dict[str, object], theatre_id: int) -> AMCTheatre:
    name = str(payload.get("name") or payload.get("longName") or f"AMC {theatre_id}").strip()
    location = payload.get("location")
    point = None
    if isinstance(location, dict):
        latitude = _float(location.get("latitude"))
        longitude = _float(location.get("longitude"))
        if latitude is not None and longitude is not None:
            if -90 <= latitude <= 90 and -180 <= longitude <= 180:
                point = GeoPoint(latitude, longitude)
    return AMCTheatre(theatre_id=theatre_id, name=name, point=point)


def _ticket_price(value: object) -> float | None:
    if not isinstance(value, list):
        return None

    parsed: list[tuple[bool, float]] = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        price = _float(raw.get("price"))
        if price is None or price < 0:
            continue
        tax = _float(raw.get("tax")) or 0.0
        price_type = str(raw.get("priceType") or "").casefold()
        parsed.append(("adult" in price_type, round(price + tax, 2)))

    if not parsed:
        return None
    adult = [price for is_adult, price in parsed if is_adult]
    return min(adult) if adult else min(price for _, price in parsed)


def _has_no_a_list(value: object) -> bool:
    if not isinstance(value, list):
        return False
    texts: list[str] = []
    for attribute in value:
        if isinstance(attribute, dict):
            texts.extend(
                str(attribute.get(key) or "")
                for key in ("code", "name", "shortDescription", "longDescription")
            )
        else:
            texts.append(str(attribute))
    joined = " ".join(texts).upper().replace("-", "")
    return "NOALIST" in joined or "EXCLUDED FROM ALIST" in joined


def _seat_percentage(payload: dict[str, object]) -> float | None:
    rows = payload.get("rows")
    if not isinstance(rows, list):
        return None

    total = 0
    available = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        seats = row.get("seats")
        if not isinstance(seats, list):
            continue
        for seat in seats:
            if not isinstance(seat, dict) or not isinstance(seat.get("isAvailable"), bool):
                continue
            seat_type = str(seat.get("seatType") or "Standard").casefold()
            if seat_type in {"wheelchair", "companion"}:
                continue
            total += 1
            available += int(seat["isAvailable"])

    if total == 0:
        return None
    return round(100 * available / total, 1)


def _normalize(value: str) -> str:
    words = re.findall(r"[a-z0-9]+", value.casefold())
    ignored = {"amc", "theatre", "theatres", "theater", "theaters"}
    return " ".join(word for word in words if word not in ignored)


def _int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
