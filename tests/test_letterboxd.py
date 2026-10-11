from __future__ import annotations

from movie_showtime_aggregator.letterboxd import _extract_rating, letterboxd_rating
from movie_showtime_aggregator.provider_cache import ProviderCache


def test_extracts_movie_json_ld_aggregate_rating():
    html = (
        '<script type="application/ld+json">'
        '{"@context":"https://schema.org","@type":"Movie","aggregateRating":'
        '{"@type":"AggregateRating","ratingValue":4.13,"bestRating":5}}'
        "</script>"
    )
    assert _extract_rating(html) == 4.13
    assert _extract_rating('<script type="application/ld+json">{"@type":"Movie"}</script>') is None


def test_letterboxd_lookup_caches_and_handles_missing_ratings(monkeypatch, tmp_path):
    cache = ProviderCache(tmp_path / "cache.sqlite3")
    calls = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def geturl(self):
            return "https://letterboxd.com/film/example/"

        def read(self, _length):
            return (
                b'<script type="application/ld+json">'
                b'{"@type":"Movie","aggregateRating":{"ratingValue":3.9}}'
                b"</script>"
            )

    def fake_open(request, timeout):
        calls.append((request.full_url, timeout))
        return Response()

    monkeypatch.setattr("movie_showtime_aggregator.letterboxd.urllib.request.urlopen", fake_open)
    assert letterboxd_rating("tt1234567", cache) == 3.9
    assert letterboxd_rating("tt1234567", cache) == 3.9
    assert calls == [("https://letterboxd.com/imdb/tt1234567/", 5)]


def test_letterboxd_rejects_bad_ids_without_network(tmp_path):
    cache = ProviderCache(tmp_path / "cache.sqlite3")
    try:
        letterboxd_rating("https://example.com/", cache)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid IMDb ID was accepted")
