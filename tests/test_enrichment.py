from datetime import date, datetime

from movie_showtime_aggregator.amc import AMCShowtime, AMCTheatre
from movie_showtime_aggregator.enrichment import (
    enrich_amc_details,
    enrich_movie_metadata,
    enrich_travel_times,
)
from movie_showtime_aggregator.location import GeoPoint
from movie_showtime_aggregator.metadata import MovieMetadata
from movie_showtime_aggregator.models import Screening


def screening(**overrides):
    values = {
        "showtime_id": "1",
        "movie": "Test Movie",
        "theatre": "AMC Arizona Center 24",
        "chain": "AMC",
        "format": "Standard",
        "advertised_start": datetime(2026, 9, 5, 19, 0),
        "actual_start": datetime(2026, 9, 5, 19, 25),
        "estimated_end": datetime(2026, 9, 5, 21, 25),
        "runtime_minutes": 120,
        "distance_miles": 2.0,
        "purchase_url": "https://fandango.example/tickets",
        "movie_source_id": "246821",
        "theatre_latitude": 33.5,
        "theatre_longitude": -112.1,
    }
    values.update(overrides)
    return Screening(**values)


class FakeMetadataClient:
    def __init__(self):
        self.calls = []

    def lookup(self, title, *, source_id="", runtime_minutes=None):
        self.calls.append((title, source_id, runtime_minutes))
        return MovieMetadata(
            title=title,
            poster_url="https://example.com/poster.jpg",
            imdb_id="tt1234567",
            imdb_rating=8.0,
            metacritic_score=70,
            rotten_tomatoes_score=90,
        )


def test_movie_metadata_enrichment_adds_ratings_and_source_links():
    client = FakeMetadataClient()
    enriched = enrich_movie_metadata([screening()], client)[0]

    assert client.calls == [("Test Movie", "246821", 120)]
    assert enriched.poster_url == "https://example.com/poster.jpg"
    assert enriched.imdb_rating == 8.0
    assert enriched.rotten_tomatoes_score == 90
    assert enriched.metacritic_score == 70
    assert enriched.letterboxd_url == "https://letterboxd.com/imdb/tt1234567/"


def test_same_title_with_different_fandango_ids_resolves_separately():
    client = FakeMetadataClient()
    enrich_movie_metadata(
        [screening(movie_source_id="111"), screening(movie_source_id="222", showtime_id="2")],
        client,
    )

    assert sorted(client.calls) == [
        ("Test Movie", "111", 120),
        ("Test Movie", "222", 120),
    ]


class FakeRouter:
    def travel_minutes(self, home, destinations):
        return dict.fromkeys(destinations, (15, 20))


def test_travel_enrichment_derives_leave_and_home_arrival_times():
    enriched = enrich_travel_times(
        [screening()],
        GeoPoint(33.45, -112.07),
        FakeRouter(),
    )[0]

    assert enriched.drive_to_minutes == 15
    assert enriched.drive_home_minutes == 20
    assert enriched.leave_home == datetime(2026, 9, 5, 19, 10)
    assert enriched.home_arrival == datetime(2026, 9, 5, 21, 45)
    assert "openstreetmap.org/directions" in enriched.route_source_url


class FakeAMCClient:
    def showtimes_near(self, show_date, point):
        assert show_date == date(2026, 9, 5)
        return [
            AMCShowtime(
                performance_id=44,
                theatre=AMCTheatre(10, "AMC Arizona Center 24", GeoPoint(33.5, -112.1)),
                movie_name="Test Movie",
                start_local=datetime(2026, 9, 5, 19, 0),
                ticket_price=14.5,
                a_list_eligible=True,
                purchase_url="https://amc.example/showtime/44",
            )
        ]

    def seats_left_percent(self, theatre_id, performance_id):
        assert (theatre_id, performance_id) == (10, 44)
        return 62.5


def test_a_list_zeroes_only_matched_eligible_amc_performance():
    enriched = enrich_amc_details(
        [screening()],
        date(2026, 9, 5),
        GeoPoint(33.45, -112.07),
        FakeAMCClient(),
        a_list_enabled=True,
    )[0]

    assert enriched.ticket_price == 0.0
    assert enriched.seats_left_percent == 62.5
    assert enriched.amc_a_list_eligible is True
    assert enriched.amc_source_url == "https://amc.example/showtime/44"
