from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True, slots=True)
class Screening:
    showtime_id: int
    movie: str
    theatre: str
    format: str
    advertised_start: datetime
    actual_start: datetime
    estimated_end: datetime
    runtime_minutes: int
    purchase_url: str

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["advertised_start"] = self.advertised_start.isoformat(timespec="minutes")
        payload["actual_start"] = self.actual_start.isoformat(timespec="minutes")
        payload["estimated_end"] = self.estimated_end.isoformat(timespec="minutes")
        return payload


def normalize_showtime(
    raw: dict[str, object], *, theatre_name: str, preshow_minutes: int
) -> Screening | None:
    if raw.get("isCanceled") or raw.get("isSoldOut"):
        return None

    movie = str(raw.get("movieName") or raw.get("sortableMovieName") or "").strip()
    start_raw = str(raw.get("showDateTimeLocal") or "").strip()
    runtime_raw = raw.get("runTime")
    showtime_id_raw = raw.get("id")

    if not movie or not start_raw or runtime_raw is None or showtime_id_raw is None:
        return None

    try:
        advertised_start = datetime.fromisoformat(start_raw)
        runtime_minutes = int(runtime_raw)
        showtime_id = int(showtime_id_raw)
    except (TypeError, ValueError):
        return None

    if runtime_minutes <= 0:
        return None

    actual_start = advertised_start + timedelta(minutes=preshow_minutes)
    estimated_end = actual_start + timedelta(minutes=runtime_minutes)
    return Screening(
        showtime_id=showtime_id,
        movie=movie,
        theatre=theatre_name,
        format=_format_name(raw),
        advertised_start=advertised_start,
        actual_start=actual_start,
        estimated_end=estimated_end,
        runtime_minutes=runtime_minutes,
        purchase_url=str(raw.get("purchaseUrl") or ""),
    )


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

    haystack = " ".join(texts).upper()
    ordered_formats = (
        ("DOLBY", "Dolby Cinema"),
        ("IMAX", "IMAX"),
        ("SCREENX", "ScreenX"),
        ("PRIME", "PRIME"),
        ("REALD", "RealD 3D"),
        ("3D", "3D"),
        ("70MM", "70mm"),
        ("LASER", "Laser"),
    )
    for needle, label in ordered_formats:
        if needle in haystack:
            return label
    return "Standard"


def _canonical_format(value: str) -> str:
    upper = value.upper()
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
    return value.strip() or "Standard"
