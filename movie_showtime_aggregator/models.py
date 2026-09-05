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

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["advertised_start"] = self.advertised_start.isoformat(timespec="minutes")
        payload["actual_start"] = (
            self.actual_start.isoformat(timespec="minutes") if self.actual_start else None
        )
        payload["estimated_end"] = (
            self.estimated_end.isoformat(timespec="minutes") if self.estimated_end else None
        )
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
    )


def apply_preview_minutes(screening: Screening, preview_minutes: int | None) -> Screening:
    if preview_minutes is None:
        return replace(screening, actual_start=None, estimated_end=None)

    actual_start = screening.advertised_start + timedelta(minutes=preview_minutes)
    estimated_end = (
        actual_start + timedelta(minutes=screening.runtime_minutes)
        if screening.runtime_minutes is not None
        else None
    )
    return replace(screening, actual_start=actual_start, estimated_end=estimated_end)


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
