from movie_showtime_aggregator.fandango import flatten_showtimes


def test_flatten_showtimes_extracts_runtime_format_and_ticket_url():
    payload = {
        "viewModel": {
            "movies": [
                {
                    "title": "Example Movie (2026)",
                    "runtime": 101,
                    "variants": [
                        {
                            "filmFormatHeader": "Premium Format",
                            "amenityGroups": [
                                {
                                    "amenities": [{"name": "IMAX 70MM Film"}],
                                    "isDolby": False,
                                    "showtimes": [
                                        {
                                            "id": 55,
                                            "ticketingDate": "2026-09-04+18:30",
                                            "expired": False,
                                            "isSoldOut": False,
                                            "ticketingJumpPageURL": "https://example.com/tickets",
                                            "filmFormat": [],
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ]
        }
    }

    showtimes = flatten_showtimes(payload)

    assert showtimes == [
        {
            "id": 55,
            "showtimeHashCode": None,
            "movieName": "Example Movie",
            "showDateTimeLocal": "2026-09-04T18:30",
            "runTime": 101,
            "premiumFormat": "IMAX 70mm",
            "purchaseUrl": "https://example.com/tickets",
            "isCanceled": False,
            "isSoldOut": False,
            "isExpired": False,
        }
    ]


def test_specific_showtime_format_overrides_generic_variant_header():
    payload = {
        "viewModel": {
            "movies": [
                {
                    "title": "Example",
                    "runtime": 95,
                    "variants": [
                        {
                            "filmFormatHeader": "Premium Format",
                            "amenityGroups": [
                                {
                                    "amenities": [],
                                    "showtimes": [
                                        {
                                            "id": 1,
                                            "ticketingDate": "2026-09-04+20:00",
                                            "filmFormat": [{"filterName": "Dolby Cinema"}],
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ]
        }
    }

    assert flatten_showtimes(payload)[0]["premiumFormat"] == "Dolby Cinema"


def test_zero_runtime_is_preserved_for_unknown_end_handling():
    payload = {
        "viewModel": {
            "movies": [
                {
                    "title": "New Release (2026)",
                    "runtime": 0,
                    "variants": [
                        {
                            "filmFormatHeader": "Standard",
                            "amenityGroups": [
                                {
                                    "amenities": [],
                                    "showtimes": [
                                        {
                                            "id": 9,
                                            "ticketingDate": "2026-09-04+21:00",
                                            "filmFormat": [],
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ]
        }
    }

    assert flatten_showtimes(payload)[0]["runTime"] == 0
