from movie_showtime_aggregator.metadata import _parse_payload


def test_omdb_release_date_is_normalized_for_frontend_sorting():
    metadata = _parse_payload(
        {
            "Response": "True",
            "Title": "Test Movie",
            "Released": "16 May 2025",
            "imdbID": "tt1234567",
        },
        "Test Movie",
    )

    assert metadata.initial_release_date == "2025-05-16"


def test_missing_omdb_release_date_stays_unknown():
    metadata = _parse_payload(
        {
            "Response": "True",
            "Title": "Test Movie",
            "Released": "N/A",
            "imdbID": "tt1234567",
        },
        "Test Movie",
    )

    assert metadata.initial_release_date is None
