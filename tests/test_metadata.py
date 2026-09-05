from movie_showtime_aggregator.metadata import _parse_payload


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
