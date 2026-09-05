from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta


@dataclass(frozen=True, slots=True)
class Screening:
    showtime_id: str
    movie: str
    theatre: str
    chain: str
    format: str
    advertised_start: datetime
    actual_start: datetime | None
    estimated_end: datetime | None
    runtime_minutes: int | None
    distance_miles: float | None
    purchase_url: str
    theatre_latitude: float | None = None
    theatre_longitude: float | None = None
    drive_to_minutes: int | None = None
    drive_home_minutes: int | None = None
    leave_home: datetime | None = None
    home_arrival: datetime | None = None
    poster_url: str = ""
    imdb_id: str = ""
    imdb_rating: float | None = None
    metacritic_score: int | None = None
    rotten_tomatoes_score: int | None = None
    ticket_price: float | None = None
    seats_left_percent: float | None = None
    amc_a_list_eligible: bool | None = None
    amc_source_url: str = ""
    letterboxd_url: str = ""
    imdb_url: str = ""
    rotten_tomatoes_url: str = ""
    metacritic_url: str = ""
    route_source_url: str = ""

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        for field in (
            "advertised_start",
            "actual_start",
            "estimated_end",
            "leave_home",
            "home_arrival",
        ):
            value = getattr(self, field)
            payload[field] = value.isoformat(timespec="minutes") if value else None
        return payload


def normalize_showtime(raw: dict[str, object]) -> Screening | None:
    if raw.get("isCanceled") or raw.get("isSoldOut") or raw.get("isExpired"):
        return None

    movie = str(raw.get("movieName") or raw.get("sortableMovieName") or "").strip()
    theatre = str(raw.get("theatreName") or "").strip()
    chain = str(raw.get("chainName") or "Independent").strip() or "Independent"
    start_raw = str(raw.get("showDateTimeLocal") or "").strip()
    showtime_id_raw = raw.get("id") or raw.get("showtimeHashCode")

    if not movie or not theatre or not start_raw or showtime_id_raw is None:
        return None

    try:
        advertised_start = datetime.fromisoformat(start_raw)
    except ValueError:
        return None

    return Screening(
        showtime_id=str(showtime_id_raw),
        movie=movie,
        theatre=theatre,
        chain=chain,
        format=_format_name(raw),
        advertised_start=advertised_start,
        actual_start=None,
        estimated_end=None,
        runtime_minutes=_runtime_minutes(raw.get("runTime")),
        distance_miles=_distance_miles(raw.get("distanceMiles")),
        purchase_url=str(raw.get("purchaseUrl") or ""),
        theatre_latitude=_coordinate(raw.get("theatreLatitude"), minimum=-90, maximum=90),
        theatre_longitude=_coordinate(raw.get("theatreLongitude"), minimum=-180, maximum=180),
    )


def apply_preview_minutes(screening: Screening, preview_minutes: int | None) -> Screening:
    if preview_minutes is None:
        return replace(
            screening,
            actual_start=None,
            estimated_end=None,
            drive_to_minutes=None,
            drive_home_minutes=None,
            leave_home=None,
            home_arrival=None,
            route_source_url="",
        )

    actual_start = screening.advertised_start + timedelta(minutes=preview_minutes)
    estimated_end = (
        actual_start + timedelta(minutes=screening.runtime_minutes)
        if screening.runtime_minutes is not None
        else None
    )
    return replace(
        screening,
        actual_start=actual_start,
        estimated_end=estimated_end,
        drive_to_minutes=None,
        drive_home_minutes=None,
        leave_home=None,
        home_arrival=None,
        route_source_url="",
    )


def apply_travel_minutes(
    screening: Screening,
    drive_to_minutes: int | None,
    drive_home_minutes: int | None,
) -> Screening:
    leave_home = (
        screening.actual_start - timedelta(minutes=drive_to_minutes)
        if screening.actual_start is not None and drive_to_minutes is not None
        else None
    )
    home_arrival = (
        screening.estimated_end + timedelta(minutes=drive_home_minutes)
        if screening.estimated_end is not None and drive_home_minutes is not None
        else None
    )
    return replace(
        screening,
        drive_to_minutes=drive_to_minutes,
        drive_home_minutes=drive_home_minutes,
        leave_home=leave_home,
        home_arrival=home_arrival,
    )


def _runtime_minutes(value: object) -> int | None:
    try:
        minutes = int(value) if value is not None else 0
    except (TypeError, ValueError):
        return None
    return minutes if minutes > 0 else None


def _distance_miles(value: object) -> float | None:
    try:
        distance = float(value) if value is not None else -1
    except (TypeError, ValueError):
        return None
    return distance if distance >= 0 else None


def _coordinate(value: object, *, minimum: float, maximum: float) -> float | None:
    try:
        coordinate = float(value) if value is not None else float("nan")
    except (TypeError, ValueError):
        return None
    return coordinate if minimum <= coordinate <= maximum else None


def _format_name(raw: dict[str, object]) -> str:
    premium = str(raw.get("premiumFormat") or "").strip()
    if premium:
        return _canonical_format(premium)

    attributes = raw.get("attributes") or []
    texts: list[str] = []
    if isinstance(attributes, list):
        for attribute in attributes:
            if isinstance(attribute, dict):
                texts.extend(
                    str(attribute.get(key) or "") for key in ("code", "name", "description")
                )
            else:
                texts.append(str(attribute))

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
    if "PREMIUM FORMAT" in upper:
        return "Premium Format"
    return "Standard"
