import json
import urllib.parse
import urllib.request
from datetime import date


def test_probe_fandango_theater_market_shape():
    show_date = date.today().isoformat()
    params = urllib.parse.urlencode(
        {
            "zipCode": "85004",
            "city": "",
            "state": "",
            "date": show_date,
            "page": 1,
            "favTheaterOnly": "false",
            "limit": 50,
            "isdesktop": "true",
        }
    )
    url = f"https://www.fandango.com/napi/theaterswithshowtimes?{params}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/150 Safari/537.36",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"https://www.fandango.com/85004_movietimes?mode=general&q=85004&date={show_date}",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read())

    theaters = payload.get("theaters") or payload.get("viewModel", {}).get("theaters", [])
    assert theaters, payload
    sample = {
        "top_keys": list(payload)[:30],
        "theater_count": len(theaters),
        "theaters": [],
    }
    for theater in theaters[:5]:
        movies = theater.get("movies") or []
        sample["theaters"].append(
            {
                "keys": list(theater)[:40],
                "id": theater.get("id"),
                "name": theater.get("name"),
                "chainName": theater.get("chainName"),
                "theaterPageUrl": theater.get("theaterPageUrl"),
                "movie": movies[0] if movies else None,
            }
        )
    raise AssertionError(json.dumps(sample, indent=2)[:30000])
