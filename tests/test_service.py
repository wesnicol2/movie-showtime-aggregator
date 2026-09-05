from datetime import date, datetime

from movie_showtime_aggregator.config import Settings
from movie_showtime_aggregator.models import Screening
from movie_showtime_aggregator.service import (
    ScreeningFilters,
    ScreeningService,
    facets,
    filter_screenings,
)


def screening(
    movie="Movie A",
    theatre="AMC One",
    chain="AMC",
    format_name="Standard",
    advertised="2026-09-04T17:30:00",
    actual="2026-09-04T17:55:00",
    end="2026-09-04T20:00:00",
):
    return Screening(
        showtime_id="1",
        movie=movie,
        theatre=theatre,
        chain=chain,
        format=format_name,
        advertised_start=datetime.fromisoformat(advertised),
        actual_start=datetime.fromisoformat(actual) if actual else None,
        estimated_end=datetime.fromisoformat(end) if end else None,
        runtime_minutes=125,
        purchase_url="",
    )


def test_filter_by_movie_theatre_and_format():
    screenings = [
        screening(),
        screening(
            movie="Movie B",
            theatre="Harkins One",
            chain="Harkins Theatres",
            format_name="IMAX",
        ),
    ]
    filters = ScreeningFilters(
        movies=frozenset({"Movie B"}),
        theatres=frozenset({"Harkins One"}),
        formats=frozenset({"IMAX"}),
    )

    assert filter_screenings(screenings, filters) == [screenings[1]]


def test_actual_start_filter_excludes_unknown_actual_start():
    screenings = [
        screening(actual=None, end=None),
        screening(actual="2026-09-04T18:30:00", end="2026-09-04T20:30:00"),
        screening(actual="2026-09-04T20:15:00", end="2026-09-04T22:15:00"),
    ]

    visible = filter_screenings(
        screenings,
        ScreeningFilters(start_after="18:00", start_before="20:00"),
    )

    assert visible == [screenings[1]]


def test_end_filter_excludes_unknown_end():
    screenings = [
        screening(end="2026-09-04T20:00:00"),
        screening(end="2026-09-04T22:15:00"),
        screening(end=None),
    ]

    visible = filter_screenings(screenings, ScreeningFilters(end_by="21:00"))

    assert visible == [screenings[0]]


def test_end_by_filter_excludes_next_day_end_after_midnight():
    before_boundary = screening(
        advertised="2026-09-04T16:00:00",
        actual="2026-09-04T16:25:00",
        end="2026-09-04T18:30:00",
    )
    after_midnight = screening(
        advertised="2026-09-04T21:30:00",
        actual="2026-09-04T21:55:00",
        end="2026-09-05T00:30:00",
    )

    visible = filter_screenings(
        [before_boundary, after_midnight],
        ScreeningFilters(end_by="19:00"),
    )

    assert visible == [before_boundary]


def test_start_filters_respect_next_day_actual_start():
    after_midnight = screening(
        advertised="2026-09-04T23:55:00",
        actual="2026-09-05T00:20:00",
        end="2026-09-05T02:00:00",
    )

    assert filter_screenings(
        [after_midnight],
        ScreeningFilters(start_after="19:00"),
    ) == [after_midnight]
    assert filter_screenings(
        [after_midnight],
        ScreeningFilters(start_before="23:00"),
    ) == []


def test_unknown_times_are_visible_without_time_filters():
    unknown = screening(actual=None, end=None)
    assert filter_screenings([unknown], ScreeningFilters()) == [unknown]


def test_facets_include_chains():
    screenings = [
        screening(
            movie="Zulu",
            theatre="Harkins Two",
            chain="Harkins Theatres",
            format_name="IMAX",
        ),
        screening(movie="Alpha", theatre="AMC One", chain="AMC", format_name="Standard"),
    ]

    assert facets(screenings) == {
        "movies": ["Alpha", "Zulu"],
        "theatres": ["AMC One", "Harkins Two"],
        "formats": ["IMAX", "Standard"],
        "chains": ["AMC", "Harkins Theatres"],
    }


class FakeShowtimeClient:
    def __init__(self):
        self.calls = 0

    def fetch_showtimes(self, zip_code, show_date, *, page_limit=50):
        self.calls += 1
        assert zip_code == "85004"
        assert page_limit == 50
        return [
            {
                "id": "amc-1",
                "movieName": "Movie A",
                "theatreName": "AMC One",
                "chainName": "AMC",
                "showDateTimeLocal": f"{show_date.isoformat()}T18:00:00",
                "runTime": 100,
                "premiumFormat": "",
                "isCanceled": False,
                "isSoldOut": False,
            },
            {
                "id": "harkins-1",
                "movieName": "Movie B",
                "theatreName": "Harkins One",
                "chainName": "Harkins Theatres",
                "showDateTimeLocal": f"{show_date.isoformat()}T19:00:00",
                "runTime": 120,
                "premiumFormat": "",
                "isCanceled": False,
                "isSoldOut": False,
            },
        ]


def test_service_caches_market_data_and_applies_previews_per_chain():
    client = FakeShowtimeClient()
    service = ScreeningService(client, Settings())
    show_date = date(2026, 9, 4)

    unknown = service.get_screenings(show_date)
    configured = service.get_screenings(show_date, {"AMC": 25})

    assert client.calls == 1
    assert all(item.actual_start is None for item in unknown)
    amc = next(item for item in configured if item.chain == "AMC")
    harkins = next(item for item in configured if item.chain == "Harkins Theatres")
    assert amc.actual_start == datetime(2026, 9, 4, 18, 25)
    assert amc.estimated_end == datetime(2026, 9, 4, 20, 5)
    assert harkins.actual_start is None
    assert harkins.estimated_end is None
