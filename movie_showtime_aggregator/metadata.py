from __future__ import annotations

import json
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from .provider_cache import ProviderCache

OMDB_BASE_URL = "https://www.omdbapi.com/"
OMDB_DAILY_LIMIT = 1000
OMDB_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
OMDB_NEGATIVE_CACHE_TTL_SECONDS = 6 * 60 * 60
USER_AGENT = "movie-showtime-aggregator/1.0"
YEAR_SUFFIX_RE = re.compile(r"\s*\((\d{4})\)\s*$")


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
        self._cache: dict[str, MovieMetadata] = {}
        self._lock = threading.Lock()

    def lookup(self, title: str) -> MovieMetadata:
        normalized = " ".join(title.split()).strip()
        if not normalized:
            raise ValueError("movie title is required")
        if not self.api_key:
            raise MetadataError("OMDb API key is not configured")

        query_title, year = _split_title_year(normalized)
        cache_key = query_title.casefold()
        if year is not None:
            cache_key = f"year-v2:{cache_key}:{year}"

        if self.provider_cache is not None:
            cached_payload = self.provider_cache.get_json("omdb", f"title:{cache_key}")
            if cached_payload is not None:
                return _parse_payload(cached_payload, normalized)
        else:
            with self._lock:
                cached = self._cache.get(cache_key)
                if cached is not None:
                    return cached

        if self.provider_cache is not None and not self.provider_cache.begin_request(
            "omdb",
            daily_limit=OMDB_DAILY_LIMIT,
        ):
            raise MetadataError("OMDb daily request budget is exhausted")

        request_params = {
            "apikey": self.api_key,
            "t": query_title,
            "type": "movie",
            "plot": "short",
            "r": "json",
        }
        if year is not None:
            request_params["y"] = year
        params = urllib.parse.urlencode(request_params)
        request = urllib.request.Request(
            f"{OMDB_BASE_URL}?{params}",
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

        metadata = _parse_payload(payload, normalized)
        if self.provider_cache is not None:
            ttl = (
                OMDB_CACHE_TTL_SECONDS
                if str(payload.get("Response") or "").casefold() == "true"
                else OMDB_NEGATIVE_CACHE_TTL_SECONDS
            )
            self.provider_cache.set_json("omdb", f"title:{cache_key}", payload, ttl_seconds=ttl)
        else:
            with self._lock:
                self._cache[cache_key] = metadata
        return metadata


def _split_title_year(title: str) -> tuple[str, str | None]:
    match = YEAR_SUFFIX_RE.search(title)
    if match is None:
        return title, None
    query_title = title[: match.start()].strip()
    if not query_title:
        return title, None
    return query_title, match.group(1)


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
    )


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
