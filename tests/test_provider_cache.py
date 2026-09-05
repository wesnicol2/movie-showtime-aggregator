from movie_showtime_aggregator.provider_cache import ProviderCache


def test_cached_json_is_persistent_and_expires(tmp_path):
    now = [1_700_000_000.0]
    path = tmp_path / "provider-cache.sqlite3"
    first = ProviderCache(path, clock=lambda: now[0])
    first.set_json("omdb", "title:test", {"Title": "Test"}, ttl_seconds=60)

    second = ProviderCache(path, clock=lambda: now[0])
    assert second.get_json("omdb", "title:test") == {"Title": "Test"}
    assert second.status("omdb")["cache_hits_today"] == 1

    now[0] += 61
    assert second.get_json("omdb", "title:test") is None


def test_daily_request_budget_is_enforced_atomically(tmp_path):
    cache = ProviderCache(tmp_path / "provider-cache.sqlite3", clock=lambda: 1_700_000_000.0)

    assert cache.begin_request("omdb", daily_limit=2) is True
    assert cache.begin_request("omdb", daily_limit=2) is True
    assert cache.begin_request("omdb", daily_limit=2) is False

    status = cache.status("omdb", published_daily_limit=2)
    assert status["requests_today"] == 2
    assert status["estimated_remaining_today"] == 0
    assert status["published_percent_used"] == 100.0
    assert str(status["app_counter_reset_at"]).endswith("Z")


def test_provider_rate_limit_headers_are_reported_and_respected(tmp_path):
    now = 1_700_000_000.0
    cache = ProviderCache(tmp_path / "provider-cache.sqlite3", clock=lambda: now)
    cache.observe_headers(
        "amc",
        {
            "X-RateLimit-Limit": "100",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": str(int(now + 3600)),
        },
    )

    status = cache.status("amc")
    rate_limit = status["provider_rate_limit"]
    assert rate_limit["limit"] == 100
    assert rate_limit["remaining"] == 0
    assert rate_limit["percent_used"] == 100.0
    assert cache.begin_request("amc") is False
