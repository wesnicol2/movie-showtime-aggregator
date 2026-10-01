from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExperienceDeviation:
    id: str
    label: str
    category: str
    polarity: str
    score_delta: int


_POSITIVE_EVENT_MARKERS = (
    "fan event",
    "early access",
    "special event",
    "sneak preview",
    "premiere event",
    "opening night event",
    "event screening",
)


def classify_experience(
    raw: dict[str, object],
    *,
    chain: str,
    format_name: str,
) -> tuple[ExperienceDeviation, ...]:
    """Return only meaningful deviations from the default recliner/standard experience."""

    deviations: list[ExperienceDeviation] = []
    attribute_texts = _attribute_texts(raw.get("attributes"))
    searchable = " ".join(attribute_texts).casefold()

    if format_name != "Standard":
        deviations.append(
            ExperienceDeviation(
                id=f"format:{_slug(format_name)}",
                label=format_name,
                category="presentation",
                polarity="positive",
                score_delta=1,
            )
        )

    if any(marker in searchable for marker in _POSITIVE_EVENT_MARKERS):
        deviations.append(
            ExperienceDeviation(
                id="event:special",
                label="Special Event",
                category="event",
                polarity="positive",
                score_delta=1,
            )
        )

    if _is_amc(chain) and "attributes" in raw and "recliner" not in searchable:
        deviations.append(
            ExperienceDeviation(
                id="seating:no-signature-recliners",
                label="No Signature Recliners",
                category="seating",
                polarity="negative",
                score_delta=-1,
            )
        )

    return tuple(deviations)


def _attribute_texts(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    texts: list[str] = []
    for attribute in value:
        if isinstance(attribute, dict):
            for key in ("code", "name", "description"):
                text = str(attribute.get(key) or "").strip()
                if text:
                    texts.append(text)
        else:
            text = str(attribute).strip()
            if text:
                texts.append(text)
    return texts


def _is_amc(chain: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", "", chain.casefold())
    return normalized.startswith("amc")


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
