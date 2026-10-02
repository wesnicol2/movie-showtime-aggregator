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


@dataclass(frozen=True, slots=True)
class ExperienceRule:
    id: str
    label: str
    category: str
    default_score_delta: int


_FORMAT_RULES = {
    "IMAX": ExperienceRule("format:imax", "IMAX", "presentation", 1),
    "IMAX 70mm": ExperienceRule("format:imax-70mm", "IMAX 70mm", "presentation", 1),
    "Dolby Cinema": ExperienceRule("format:dolby-cinema", "Dolby Cinema", "presentation", 1),
    "ScreenX": ExperienceRule("format:screenx", "ScreenX", "presentation", 1),
    "PRIME": ExperienceRule("format:prime", "PRIME", "presentation", 1),
    "XD": ExperienceRule("format:xd", "XD", "presentation", 1),
    "RealD 3D": ExperienceRule("format:reald-3d", "RealD 3D", "presentation", 1),
    "3D": ExperienceRule("format:3d", "3D", "presentation", 1),
    "70mm": ExperienceRule("format:70mm", "70mm", "presentation", 1),
    "Laser": ExperienceRule("format:laser", "Laser", "presentation", 1),
    "Premium Format": ExperienceRule("format:premium-format", "Premium Format", "presentation", 1),
}

_EVENT_RULES = {
    "Fan Event": ExperienceRule("event:fan-event", "Fan Event", "event", 1),
    "Early Access": ExperienceRule("event:early-access", "Early Access", "event", 1),
    "Sneak Preview": ExperienceRule("event:sneak-preview", "Sneak Preview", "event", 1),
    "Premiere Event": ExperienceRule("event:premiere-event", "Premiere Event", "event", 1),
    "Opening Night Event": ExperienceRule(
        "event:opening-night-event", "Opening Night Event", "event", 1
    ),
    "Special Event": ExperienceRule("event:special-event", "Special Event", "event", 1),
}

_SEATING_RULE = ExperienceRule(
    "seating:no-signature-recliners",
    "No Signature Recliners",
    "seating",
    -1,
)

_EVENT_MARKERS = (
    ("fan event", "Fan Event"),
    ("early access", "Early Access"),
    ("sneak preview", "Sneak Preview"),
    ("premiere event", "Premiere Event"),
    ("opening night event", "Opening Night Event"),
    ("special event", "Special Event"),
    ("event screening", "Special Event"),
)


def experience_rules() -> tuple[ExperienceRule, ...]:
    return (*_FORMAT_RULES.values(), *_EVENT_RULES.values(), _SEATING_RULE)


def experience_rule_ids() -> frozenset[str]:
    return frozenset(rule.id for rule in experience_rules())


def experience_settings_payload(
    score_overrides: dict[str, int],
    disabled: tuple[str, ...],
) -> list[dict[str, object]]:
    disabled_ids = set(disabled)
    return [
        {
            "id": rule.id,
            "label": rule.label,
            "category": rule.category,
            "enabled": rule.id not in disabled_ids,
            "score_delta": score_overrides.get(rule.id, rule.default_score_delta),
            "default_score_delta": rule.default_score_delta,
        }
        for rule in experience_rules()
    ]


def configure_experience(
    deviations: tuple[ExperienceDeviation, ...],
    *,
    score_overrides: dict[str, int],
    disabled: tuple[str, ...],
) -> tuple[ExperienceDeviation, ...]:
    disabled_ids = set(disabled)
    configured: list[ExperienceDeviation] = []
    for deviation in deviations:
        if deviation.id in disabled_ids:
            continue
        score_delta = score_overrides.get(deviation.id, deviation.score_delta)
        configured.append(
            ExperienceDeviation(
                id=deviation.id,
                label=deviation.label,
                category=deviation.category,
                polarity="positive" if score_delta > 0 else "negative",
                score_delta=score_delta,
            )
        )
    return tuple(configured)


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
        rule = _FORMAT_RULES.get(
            format_name,
            ExperienceRule(
                id=f"format:{_slug(format_name)}",
                label=format_name,
                category="presentation",
                default_score_delta=1,
            ),
        )
        deviations.append(_deviation(rule))

    event_label = next((label for marker, label in _EVENT_MARKERS if marker in searchable), None)
    if event_label is not None:
        deviations.append(_deviation(_EVENT_RULES[event_label]))

    if _is_amc(chain) and "attributes" in raw and "recliner" not in searchable:
        deviations.append(_deviation(_SEATING_RULE))

    return tuple(deviations)


def _deviation(rule: ExperienceRule) -> ExperienceDeviation:
    return ExperienceDeviation(
        id=rule.id,
        label=rule.label,
        category=rule.category,
        polarity="positive" if rule.default_score_delta > 0 else "negative",
        score_delta=rule.default_score_delta,
    )


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
