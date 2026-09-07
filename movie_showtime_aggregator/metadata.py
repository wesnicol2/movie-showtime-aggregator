from __future__ import annotations

import json
import re
import threading
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher

from .provider_cache import ProviderCache

OMDB_BASE_URL = "https://www.omdbapi.com/"
OMDB_DAILY_LIMIT = 1000
OMDB_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
OMDB_NEGATIVE_CACHE_TTL_SECONDS = 6 * 60 * 60
IDENTITY_MAPPING_TTL_SECONDS = 10 * 365 * 24 * 60 * 60
USER_AGENT = "movie-showtime-aggregator/1.0"
YEAR_SUFFIX_RE = re.compile(r"\s*\((\d{4})\)\s*$")
RELEASE_QUALIFIER_RE = re.compile(
    r"(?:\s*[-:]?\s*(?:"
    r"4k\s+re-?release|"
    r"re-?release|"
    r"\d{1,3}(?:st|nd|rd|th)\s+anniversary(?:\s+re-?release)?"
    r")|\s*\(\s*re-?release\s*\))\s*$",
    re.IGNORECASE,
)
MULTI_FILM_EVENT_RE = re.compile(
    r"\b(?:double|triple)\s+feature\b|\bdouble\s+bill\b|\bmarathon\b",
    re.IGNORECASE,
)


class MetadataError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class MovieMetadata:
    title: str
    poster_url: str = ""
    imdb_id: str = ""
    imdb_rating: float | None = None
    metacritic_score: int | None = None
    rotten_tomatoes_score: int | None = None
    initial_release_date: str | None = None

    @property
    def imdb_url(self) -> str:
        return f"https://www.imdb.com/title/{self.imdb_id}/" if self.imdb_id else ""

    @property
    def letterboxd_url(self) -> str:
        if self.imdb_id:
            return f"https://letterboxd.com/imdb/{self.imdb_id}/"
        return f"https://letterboxd.com/search/{urllib.parse.quote(self.title)}/"

    @property
    def rotten_tomatoes_url(self) -> str:
        return f"https://www.rottentomatoes.com/search?search={urllib.parse.quote(self.title)}"

    @property
    def metacritic_url(self) -> str:
        return f"https://www.metacritic.com/search/{urllib.parse.quote(self.title)}/"


class OmdbClient:
    def __init__(
        self,
        api_key: str,
        *,
        timeout_seconds: int = 10,
        provider_cache: ProviderCache | None = None,
    ) -> None:
        self.api_key = api_key.strip()
        self.timeout_seconds = timeout_seconds
        self.provider_cache = provider_cache
        self._cache: dict[str, object] = {}
        self._lock = threading.Lock()

    def lookup(
        self,
        title: str,
        *,
        source_id: str = "",
        runtime_minutes: int | None = None,
    ) -> MovieMetadata:
        normalized = " ".join(title.split()).strip()
        source_id = source_id.strip()
        if not normalized:
            raise ValueError("movie title is required")
        if not self.api_key:
            raise MetadataError("OMDb API key is not configured")

        mapped_id = self._mapped_imdb_id(source_id)
        if mapped_id:
            mapped_payload = self._request_imdb(mapped_id)
            if _payload_is_match(mapped_payload):
                return _parse_payload(mapped_payload, normalized)

        query_title, year = _split_title_year(normalized)
        exact_payload = self._request_title(query_title, year)
        if _payload_is_match(exact_payload):
            return self._resolved(normalized, source_id, exact_payload)

        if MULTI_FILM_EVENT_RE.search(query_title):
            return MovieMetadata(title=normalized)

        cleaned_title = _strip_release_qualifier(query_title)
        is_release_qualifier = cleaned_title != query_title
        if is_release_qualifier:
            cleaned_payload = self._request_title(cleaned_title, None)
            if _acceptable_payload(
                cleaned_payload,
                cleaned_title,
                year=None,
                runtime_minutes=runtime_minutes,
                allow_any_year=True,
            ):
                return self._resolved(normalized, source_id, cleaned_payload)

        if year is not None and not is_release_qualifier:
            relaxed_payload = self._request_title(query_title, None)
            if _acceptable_payload(
                relaxed_payload,
                query_title,
                year=year,
                runtime_minutes=runtime_minutes,
                allow_any_year=False,
            ):
                return self._resolved(normalized, source_id, relaxed_payload)

        search_title = cleaned_title if is_release_qualifier else query_title
        search_payload = self._request_search(search_title)
        candidate_id = _select_search_result(
            search_payload,
            search_title,
            year=year,
            allow_any_year=is_release_qualifier,
        )
        if not candidate_id:
            return MovieMetadata(title=normalized)

        candidate_payload = self._request_imdb(candidate_id)
        if not _acceptable_payload(
            candidate_payload,
            search_title,
            year=year,
            runtime_minutes=runtime_minutes,
            allow_any_year=is_release_qualifier,
        ):
            return MovieMetadata(title=normalized)
        return self._resolved(normalized, source_id, candidate_payload)

    def _resolved(self, title: str, source_id: str, payload: object) -> MovieMetadata:
        metadata = _parse_payload(payload, title)
        if not metadata.imdb_id:
            return metadata
        if self.provider_cache is not None:
            self.provider_cache.set_json(
                "omdb",
                f"imdb:v1:{metadata.imdb_id}",
                payload,
                ttl_seconds=OMDB_CACHE_TTL_SECONDS,
            )
            if source_id:
                self.provider_cache.set_json(
                    "movie-identity",
                    f"fandango:{source_id}",
                    {"imdb_id": metadata.imdb_id},
                    ttl_seconds=IDENTITY_MAPPING_TTL_SECONDS,
                )
        return metadata

    def _mapped_imdb_id(self, source_id: str) -> str:
        if not source_id or self.provider_cache is None:
            return ""
        payload = self.provider_cache.get_json("movie-identity", f"fandango:{source_id}")
        if not isinstance(payload, dict):
            return ""
        return _imdb_id(payload.get("imdb_id"))

    def _request_title(self, title: str, year: str | None) -> object:
        cache_key = title.casefold()
        if year is not None:
            cache_key = f"year-v2:{cache_key}:{year}"
        params = {
            "apikey": self.api_key,
            "t": title,
            "type": "movie",
            "plot": "short",
            "r": "json",
        }
        if year is not None:
            params["y"] = year
        return self._request_json(f"title:{cache_key}", params)

    def _request_search(self, title: str) -> object:
        params = {
            "apikey": self.api_key,
            "s": title,
            "type": "movie",
            "r": "json",
        }
        return self._request_json(f"search:v1:{title.casefold()}", params)

    def _request_imdb(self, imdb_id: str) -> object:
        params = {
            "apikey": self.api_key,
            "i": imdb_id,
            "type": "movie",
            "plot": "short",
            "r": "json",
        }
        return self._request_json(f"imdb:v1:{imdb_id}", params)

    def _request_json(self, cache_key: str, params: dict[str, str]) -> object:
        if self.provider_cache is not None:
            cached_payload = self.provider_cache.get_json("omdb", cache_key)
            if cached_payload is not None:
                return cached_payload
        else:
            with self._lock:
                if cache_key in self._cache:
                    return self._cache[cache_key]

        if self.provider_cache is not None and not self.provider_cache.begin_request(
            "omdb",
            daily_limit=OMDB_DAILY_LIMIT,
        ):
            raise MetadataError("OMDb daily request budget is exhausted")

        query = urllib.parse.urlencode(params)
        request = urllib.request.Request(
            f"{OMDB_BASE_URL}?{query}",
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                if self.provider_cache is not None:
                    self.provider_cache.observe_headers("omdb", response.headers)
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if self.provider_cache is not None:
                self.provider_cache.observe_headers("omdb", exc.headers)
            raise MetadataError(f"OMDb returned HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise MetadataError(f"OMDb request failed: {exc}") from exc

        ttl = (
            OMDB_CACHE_TTL_SECONDS
            if _payload_is_match(payload)
            else OMDB_NEGATIVE_CACHE_TTL_SECONDS
        )
        if self.provider_cache is not None:
            self.provider_cache.set_json("omdb", cache_key, payload, ttl_seconds=ttl)
        else:
            with self._lock:
                self._cache[cache_key] = payload
        return payload


def _split_title_year(title: str) -> tuple[str, str | None]:
    match = YEAR_SUFFIX_RE.search(title)
    if match is None:
        return title, None
    query_title = title[: match.start()].strip()
    if not query_title:
        return title, None
    return query_title, match.group(1)


def _strip_release_qualifier(title: str) -> str:
    stripped = RELEASE_QUALIFIER_RE.sub("", title).strip(" :-")
    return stripped or title


def _payload_is_match(payload: object) -> bool:
    return isinstance(payload, dict) and str(payload.get("Response") or "").casefold() == "true"


def _acceptable_payload(
    payload: object,
    expected_title: str,
    *,
    year: str | None,
    runtime_minutes: int | None,
    allow_any_year: bool,
) -> bool:
    if not _payload_is_match(payload) or not isinstance(payload, dict):
        return False
    if not _titles_compatible(expected_title, str(payload.get("Title") or "")):
        return False
    if year is not None and not allow_any_year and not _year_near(year, payload.get("Year")):
        return False
    resolved_runtime = _runtime_minutes(payload.get("Runtime"))
    if (
        runtime_minutes is not None
        and resolved_runtime is not None
        and abs(runtime_minutes - resolved_runtime) > 20
    ):
        return False
    return bool(_imdb_id(payload.get("imdbID")))


def _select_search_result(
    payload: object,
    expected_title: str,
    *,
    year: str | None,
    allow_any_year: bool,
) -> str:
    if not isinstance(payload, dict) or not _payload_is_match(payload):
        return ""
    results = payload.get("Search")
    if not isinstance(results, list):
        return ""

    ranked: list[tuple[float, str]] = []
    for result in results:
        if not isinstance(result, dict):
            continue
        if str(result.get("Type") or "movie").casefold() != "movie":
            continue
        imdb_id = _imdb_id(result.get("imdbID"))
        if not imdb_id:
            continue
        score = _title_similarity(expected_title, str(result.get("Title") or ""))
        if score < 0.82:
            continue
        if year is not None and not allow_any_year:
            difference = _year_difference(year, result.get("Year"))
            if difference is None or difference > 2:
                continue
            score += (2 - difference) * 0.03
        ranked.append((score, imdb_id))

    if not ranked:
        return ""
    ranked.sort(reverse=True)
    if len(ranked) > 1 and ranked[0][0] - ranked[1][0] < 0.03:
        return ""
    return ranked[0][1]


def _titles_compatible(left: str, right: str) -> bool:
    return _title_similarity(left, right) >= 0.82


def _title_similarity(left: str, right: str) -> float:
    left_normalized = _identity_text(left)
    right_normalized = _identity_text(right)
    if not left_normalized or not right_normalized:
        return 0.0
    if left_normalized == right_normalized:
        return 1.0
    shorter, longer = sorted((left_normalized, right_normalized), key=len)
    if len(shorter) >= 5 and longer.startswith(f"{shorter} "):
        return 0.9
    return SequenceMatcher(None, left_normalized, right_normalized).ratio()


def _identity_text(value: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return " ".join(re.findall(r"[a-z0-9]+", ascii_text.casefold()))


def _year_near(expected: str, actual: object) -> bool:
    difference = _year_difference(expected, actual)
    return difference is not None and difference <= 2


def _year_difference(expected: str, actual: object) -> int | None:
    match = re.search(r"\d{4}", str(actual or ""))
    if match is None:
        return None
    try:
        return abs(int(expected) - int(match.group(0)))
    except ValueError:
        return None


def _runtime_minutes(value: object) -> int | None:
    match = re.search(r"\d+", str(value or ""))
    if match is None:
        return None
    minutes = int(match.group(0))
    return minutes if minutes > 0 else None


def _parse_payload(payload: object, title: str) -> MovieMetadata:
    if not isinstance(payload, dict):
        raise MetadataError("OMDb returned an unexpected response")
    if str(payload.get("Response") or "").casefold() != "true":
        return MovieMetadata(title=title)

    resolved_title = str(payload.get("Title") or title).strip() or title
    poster = str(payload.get("Poster") or "").strip()
    if poster.casefold() == "n/a":
        poster = ""

    rotten_tomatoes = None
    ratings = payload.get("Ratings")
    if isinstance(ratings, list):
        for rating in ratings:
            if not isinstance(rating, dict):
                continue
            if str(rating.get("Source") or "").casefold() == "rotten tomatoes":
                rotten_tomatoes = _percent(rating.get("Value"))
                break

    return MovieMetadata(
        title=resolved_title,
        poster_url=poster,
        imdb_id=_imdb_id(payload.get("imdbID")),
        imdb_rating=_float_or_none(payload.get("imdbRating"), minimum=0, maximum=10),
        metacritic_score=_int_or_none(payload.get("Metascore"), minimum=0, maximum=100),
        rotten_tomatoes_score=rotten_tomatoes,
        initial_release_date=_release_date(payload.get("Released")),
    )


def _release_date(value: object) -> str | None:
    text = str(value or "").strip()
    if not text or text.casefold() == "n/a":
        return None
    for date_format in ("%d %b %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, date_format).date().isoformat()
        except ValueError:
            continue
    return None


def _imdb_id(value: object) -> str:
    text = str(value or "").strip()
    return text if text.startswith("tt") and text[2:].isdigit() else ""


def _percent(value: object) -> int | None:
    text = str(value or "").strip().removesuffix("%")
    return _int_or_none(text, minimum=0, maximum=100)


def _int_or_none(value: object, *, minimum: int, maximum: int) -> int | None:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if minimum <= number <= maximum else None


def _float_or_none(value: object, *, minimum: float, maximum: float) -> float | None:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if minimum <= number <= maximum else None
