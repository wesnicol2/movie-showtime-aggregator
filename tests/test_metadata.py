import json
from urllib.parse import parse_qs, urlparse

from movie_showtime_aggregator.metadata import OmdbClient, _parse_payload
from movie_showtime_aggregator.provider_cache import ProviderCache


def test_omdb_payload_parses_ratings_poster_and_exact_imdb_links():
    metadata = _parse_payload(
        {
            "Response": "True",
            "Title": "Test Movie",
            "Poster": "https://example.com/poster.jpg",
            "imdbID": "tt1234567",
            "imdbRating": "8.1",
            "Metascore": "74",
            "Ratings": [
                {"Source": "Internet Movie Database", "Value": "8.1/10"},
                {"Source": "Rotten Tomatoes", "Value": "91%"},
            ],
        },
        "Test Movie",
    )

    assert metadata.poster_url == "https://example.com/poster.jpg"
    assert metadata.imdb_rating == 8.1
    assert metadata.metacritic_score == 74
    assert metadata.rotten_tomatoes_score == 91
    assert metadata.imdb_url == "https://www.imdb.com/title/tt1234567/"
    assert metadata.letterboxd_url == "https://letterboxd.com/imdb/tt1234567/"
    assert "rottentomatoes.com/search" in metadata.rotten_tomatoes_url
    assert "metacritic.com/search" in metadata.metacritic_url


def test_missing_omdb_match_stays_unknown_instead_of_failing():
    metadata = _parse_payload({"Response": "False", "Error": "Movie not found!"}, "Nope")

    assert metadata.title == "Nope"
    assert metadata.poster_url == ""
    assert metadata.imdb_rating is None
    assert metadata.metacritic_score is None
    assert metadata.rotten_tomatoes_score is None


def test_omdb_persistent_cache_avoids_request_after_client_recreation(monkeypatch, tmp_path):
    calls = []

    class FakeResponse:
        headers = {}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b'{"Response":"True","Title":"Test Movie","imdbID":"tt1234567"}'

    def fake_urlopen(request, timeout):
        calls.append((request.full_url, timeout))
        return FakeResponse()

    monkeypatch.setattr("movie_showtime_aggregator.metadata.urllib.request.urlopen", fake_urlopen)
    cache = ProviderCache(tmp_path / "provider-cache.sqlite3")

    first = OmdbClient("key", provider_cache=cache)
    second = OmdbClient("key", provider_cache=cache)

    assert first.lookup("Test Movie").imdb_id == "tt1234567"
    assert second.lookup("Test Movie").imdb_id == "tt1234567"
    assert len(calls) == 1
    query = parse_qs(urlparse(calls[0][0]).query)
    assert query["t"] == ["Test Movie"]
    assert "y" not in query
    assert cache.status("omdb")["requests_today"] == 1
    assert cache.status("omdb")["cache_hits_today"] == 1


def test_year_suffix_is_split_into_title_and_year_and_bypasses_old_negative_cache(
    monkeypatch,
    tmp_path,
):
    calls = []

    class FakeResponse:
        headers = {}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return (
                b'{"Response":"True","Title":"Toy Story 5","Year":"2026",'
                b'"imdbID":"tt1234567","imdbRating":"7.4"}'
            )

    def fake_urlopen(request, timeout):
        calls.append((request.full_url, timeout))
        return FakeResponse()

    monkeypatch.setattr("movie_showtime_aggregator.metadata.urllib.request.urlopen", fake_urlopen)
    cache = ProviderCache(tmp_path / "provider-cache.sqlite3")
    cache.set_json(
        "omdb",
        "title:toy story 5 (2026)",
        {"Response": "False", "Error": "Movie not found!"},
        ttl_seconds=3600,
    )

    first = OmdbClient("key", provider_cache=cache)
    second = OmdbClient("key", provider_cache=cache)

    assert first.lookup("Toy Story 5 (2026)").imdb_rating == 7.4
    assert second.lookup("Toy Story 5 (2026)").imdb_rating == 7.4
    assert len(calls) == 1

    query = parse_qs(urlparse(calls[0][0]).query)
    assert query["t"] == ["Toy Story 5"]
    assert query["y"] == ["2026"]


def test_nearby_canonical_year_is_accepted_and_fandango_mapping_is_reused(monkeypatch, tmp_path):
    calls = []

    responses = {
        ("t", "The Marching Band", "2026"): {
            "Response": "False",
            "Error": "Movie not found!",
        },
        ("t", "The Marching Band", ""): {
            "Response": "True",
            "Title": "The Marching Band",
            "Year": "2024",
            "Runtime": "103 min",
            "imdbID": "tt30327451",
            "imdbRating": "7.4",
        },
    }

    class FakeResponse:
        headers = {}

        def __init__(self, payload):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return json.dumps(self.payload).encode()

    def fake_urlopen(request, timeout):
        query = parse_qs(urlparse(request.full_url).query)
        calls.append(query)
        key = ("t", query.get("t", [""])[0], query.get("y", [""])[0])
        return FakeResponse(responses[key])

    monkeypatch.setattr("movie_showtime_aggregator.metadata.urllib.request.urlopen", fake_urlopen)
    cache = ProviderCache(tmp_path / "provider-cache.sqlite3")

    first = OmdbClient("key", provider_cache=cache)
    second = OmdbClient("key", provider_cache=cache)

    resolved = first.lookup(
        "The Marching Band (2026)",
        source_id="240829",
        runtime_minutes=104,
    )
    assert resolved.imdb_id == "tt30327451"
    assert len(calls) == 2

    resolved_again = second.lookup(
        "The Marching Band (2026)",
        source_id="240829",
        runtime_minutes=104,
    )
    assert resolved_again.imdb_id == "tt30327451"
    assert len(calls) == 2


def test_wrong_old_same_title_is_rejected_then_search_selects_nearby_year(monkeypatch, tmp_path):
    calls = []

    class FakeResponse:
        headers = {}

        def __init__(self, payload):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return json.dumps(self.payload).encode()

    def fake_urlopen(request, timeout):
        query = parse_qs(urlparse(request.full_url).query)
        calls.append(query)
        if query.get("t") == ["cocoon"] and query.get("y") == ["2026"]:
            payload = {"Response": "False", "Error": "Movie not found!"}
        elif query.get("t") == ["cocoon"]:
            payload = {
                "Response": "True",
                "Title": "Cocoon",
                "Year": "1985",
                "Runtime": "117 min",
                "imdbID": "tt0088933",
            }
        elif query.get("s") == ["cocoon"]:
            payload = {
                "Response": "True",
                "Search": [
                    {"Title": "Cocoon", "Year": "1985", "imdbID": "tt0088933", "Type": "movie"},
                    {
                        "Title": "Cocoon: One Summer of Girlhood",
                        "Year": "2025",
                        "imdbID": "tt36361934",
                        "Type": "movie",
                    },
                ],
            }
        elif query.get("i") == ["tt36361934"]:
            payload = {
                "Response": "True",
                "Title": "Cocoon: One Summer of Girlhood",
                "Year": "2025",
                "Runtime": "95 min",
                "imdbID": "tt36361934",
            }
        else:
            raise AssertionError(query)
        return FakeResponse(payload)

    monkeypatch.setattr("movie_showtime_aggregator.metadata.urllib.request.urlopen", fake_urlopen)
    cache = ProviderCache(tmp_path / "provider-cache.sqlite3")
    client = OmdbClient("key", provider_cache=cache)

    resolved = client.lookup("cocoon (2026)", source_id="999999", runtime_minutes=95)

    assert resolved.imdb_id == "tt36361934"
    assert not any(query.get("i") == ["tt0088933"] for query in calls)


def test_release_qualifier_can_resolve_original_movie_across_large_year_gap(monkeypatch, tmp_path):
    calls = []

    class FakeResponse:
        headers = {}

        def __init__(self, payload):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return json.dumps(self.payload).encode()

    def fake_urlopen(request, timeout):
        query = parse_qs(urlparse(request.full_url).query)
        calls.append(query)
        if query.get("t") == ["Cars: 20th Anniversary"]:
            payload = {"Response": "False", "Error": "Movie not found!"}
        elif query.get("t") == ["Cars"]:
            payload = {
                "Response": "True",
                "Title": "Cars",
                "Year": "2006",
                "Runtime": "117 min",
                "imdbID": "tt0317219",
            }
        else:
            raise AssertionError(query)
        return FakeResponse(payload)

    monkeypatch.setattr("movie_showtime_aggregator.metadata.urllib.request.urlopen", fake_urlopen)
    client = OmdbClient("key", provider_cache=ProviderCache(tmp_path / "provider-cache.sqlite3"))

    resolved = client.lookup("Cars: 20th Anniversary", runtime_minutes=117)

    assert resolved.imdb_id == "tt0317219"
    assert len(calls) == 2


def test_multi_film_event_is_not_forced_to_single_movie(monkeypatch, tmp_path):
    calls = []

    class FakeResponse:
        headers = {}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b'{"Response":"False","Error":"Movie not found!"}'

    def fake_urlopen(request, timeout):
        calls.append(parse_qs(urlparse(request.full_url).query))
        return FakeResponse()

    monkeypatch.setattr("movie_showtime_aggregator.metadata.urllib.request.urlopen", fake_urlopen)
    client = OmdbClient("key", provider_cache=ProviderCache(tmp_path / "provider-cache.sqlite3"))

    resolved = client.lookup("Star Trek Double Feature (2026)")

    assert resolved.imdb_id == ""
    assert len(calls) == 1
