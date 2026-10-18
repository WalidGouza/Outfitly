from types import SimpleNamespace
import httpx
import pytest
from fastapi.testclient import TestClient
from app import main, weather

rules = weather.load_rules("")


def day(feels=18, rain=0, wind=10, code=2, precipitation=0):
    return {"temp_max": feels + 2, "temp_min": feels - 4, "temp_now": feels, "feels_like": feels, "rain_chance": rain,
            "precipitation": precipitation, "wind": wind, "code": code, "summary": weather.describe(code), "timezone": "UTC"}


def piece(id, category, name, texture="cotton", color="#808080"):
    return SimpleNamespace(id=id, category=category, name=name, texture=texture, color=color, style="Everyday", image=None)


wardrobe = [
    piece("tee", "tops", "White cotton tee"), piece("knit", "tops", "Grey merino sweater", "knit"),
    piece("linen", "tops", "Linen shirt", "linen"), piece("jeans", "pants", "Blue jeans", "denim"),
    piece("shorts", "pants", "Khaki shorts"), piece("suede", "shoes", "Suede loafers", "leather"),
    piece("boots", "shoes", "Chelsea boots", "leather"), piece("sandals", "shoes", "Leather sandals", "leather"),
    piece("coat", "jackets", "Wool overcoat", "other"), piece("over", "jackets", "Olive overshirt"),
]


def test_cold_requires_a_heavy_coat():
    p = weather.plan(day(feels=4), rules)
    assert p["layer"] == "required" and p["warmth"] == "heavy"
    assert p["essentials"] == ["heavy_coat"]
    assert any("heavy coat is required" in n for n in p["notes"])
    assert weather.fit(wardrobe[8], p) > weather.fit(wardrobe[9], p)


def test_rain_wants_waterproof_and_avoids_suede():
    p = weather.plan(day(feels=14, rain=80), rules)
    assert p["layer"] == "required" and "rain_layer" in p["essentials"]
    assert weather.fit(wardrobe[5], p) < 0.3 < weather.fit(wardrobe[6], p)


def test_hot_day_drops_the_layer_and_warm_pieces():
    w = day(feels=29)
    p = weather.plan(w, rules)
    assert p["layer"] == "none" and not weather.wants_layer(p, w)
    assert weather.fit(wardrobe[1], p) < 0.3
    assert weather.fit(wardrobe[2], p) > weather.fit(wardrobe[0], p)


def test_tags_read_names_and_fabrics():
    assert {"heavy", "warm"} <= weather.tags(wardrobe[8])
    assert "waterproof" in weather.tags(piece("t", "jackets", "Beige trench"))
    assert "boots" in weather.tags(wardrobe[6]) and "suede" in weather.tags(wardrobe[5])


def test_missing_essentials_are_suggested():
    p = weather.plan(day(feels=3, rain=70), rules)
    keys = [m["key"] for m in weather.missing([x for x in wardrobe if x.id != "coat"], p, day(feels=3, rain=70))]
    assert keys == ["heavy_coat", "rain_layer"]
    assert weather.missing(wardrobe + [piece("rain", "jackets", "Rain jacket")], p, day(feels=3)) == []


def test_custom_rules_are_validated():
    with pytest.raises(ValueError):
        weather.load_rules('[{"when": {}, "then": {"essential": "umbrella"}}]')
    assert weather.load_rules('[{"when": {"feel_below": 5}, "then": {"layer": "required"}}]')


def test_forecast_is_parsed_and_coordinates_are_rounded():
    seen = {}

    def handler(request):
        seen.update(request.url.params)
        return httpx.Response(200, json={"timezone": "Europe/Paris", "current": {"temperature_2m": 7.4},
            "daily": {"temperature_2m_max": [9.1], "temperature_2m_min": [2.2], "apparent_temperature_max": [6.0],
                      "apparent_temperature_min": [0.0], "precipitation_sum": [3.2], "precipitation_probability_max": [85],
                      "wind_speed_10m_max": [22.0], "weather_code": [63]}})

    w = weather.fetch_forecast(48.856613, 2.352222, transport=httpx.MockTransport(handler))
    assert seen["latitude"] == "48.86" and seen["longitude"] == "2.35"
    assert w["feels_like"] == 4 and w["rain_chance"] == 85 and w["summary"] == "Rain"


@pytest.fixture(autouse=True)
def fresh_place_lookups(monkeypatch):
    # Each test starts with nothing cached and the one-per-second pacing out of the way.
    monkeypatch.setattr(weather, "_places", {})
    monkeypatch.setattr(weather, "_progress", {})
    monkeypatch.setattr(weather, "_lookup_slot", lambda: True)


def test_place_name_reads_town_and_country():
    seen = {}

    def handler(request):
        seen["agent"] = request.headers["user-agent"]
        seen.update(request.url.params)
        return httpx.Response(200, json={"address": {"city": "Lyon", "state": "Auvergne-Rhone-Alpes", "country": "France"}})

    assert weather.place_name(45.764043, 4.835659, transport=httpx.MockTransport(handler)) == "Lyon, France"
    assert seen["lat"] == "45.76" and seen["agent"].startswith("Outfitly")


def test_place_name_never_breaks_the_forecast():
    down = httpx.MockTransport(lambda r: httpx.Response(503))
    assert weather.place_name(12.34, 56.78, transport=down) is None
    assert weather.place_name(12.35, 56.79, "Atlantic/Cape_Verde", transport=down) == "Near Cape Verde"


def test_no_town_gives_the_closest_named_area(monkeypatch):
    zooms = []

    def handler(request):
        zooms.append(request.url.params["zoom"])
        if request.url.params["zoom"] == "10":
            return httpx.Response(200, json={"error": "Unable to geocode"})
        return httpx.Response(200, json={"address": {"county": "Highland", "country": "United Kingdom"}})

    assert weather.place_name(57.12, -4.71, transport=httpx.MockTransport(handler)) == "Near Highland, United Kingdom"
    assert zooms == ["10", "8"]


def test_open_sea_falls_back_to_the_time_zone(monkeypatch):
    sea = httpx.MockTransport(lambda r: httpx.Response(200, json={"error": "Unable to geocode"}))
    assert weather.place_name(38.5, -28.0, "Atlantic/Azores", transport=sea) == "Near Azores"
    assert weather.place_name(45.0, -40.0, "Etc/GMT+3", transport=sea) is None


def test_forecast_failure_is_a_clear_error():
    with pytest.raises(weather.WeatherUnavailable):
        weather.fetch_forecast(10.5, 10.5, transport=httpx.MockTransport(lambda r: httpx.Response(500)))


def test_sample_endpoint_builds_a_weather_outfit(monkeypatch):
    monkeypatch.setattr(weather, "fetch_forecast", lambda *a, **k: day(feels=5, rain=60))
    monkeypatch.setattr(weather, "place_name", lambda *a, **k: "Paris, France")
    body = {"latitude": 48.85, "longitude": 2.35, "style": "Everyday", "pieces": [
        {"id": x.id, "name": x.name, "category": x.category, "color": "#808080", "texture": x.texture} for x in wardrobe if x.id != "coat"]}
    r = TestClient(main.app).post("/today/sample", json=body)
    assert r.status_code == 200
    data = r.json()
    best = {i["id"] for i in data["looks"][0]["items"]}
    assert "over" in best and "boots" in best and "shorts" not in best and "sandals" not in best
    assert "weather" in data["looks"][0]["breakdown"]
    assert data["weather"]["place"] == "Paris, France"
    assert [m["key"] for m in data["missing"]] == ["heavy_coat", "rain_layer"]


def test_weather_outage_is_503(monkeypatch):
    def down(*a, **k):
        raise weather.WeatherUnavailable("Weather is unavailable right now.")

    monkeypatch.setattr(weather, "fetch_forecast", down)
    r = TestClient(main.app).post("/today/sample", json={"latitude": 1, "longitude": 1, "pieces": []})
    assert r.status_code == 503


def met_answer():
    from datetime import datetime, timedelta, timezone
    start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    series = []
    for h in range(30):
        series.append({
            "time": (start + timedelta(hours=h)).isoformat().replace("+00:00", "Z"),
            "data": {
                "instant": {"details": {"air_temperature": 8 + (h % 12) * 0.5, "apparent_air_temperature": 6 + (h % 12) * 0.5, "wind_speed": 5}},
                "next_1_hours": {"summary": {"symbol_code": "lightrain" if h in (3, 4, 5) else "cloudy"}, "details": {"precipitation_amount": 0.5 if h in (3, 4, 5) else 0}},
            },
        })
    return {"properties": {"timeseries": series}}


def test_met_norway_answers_when_open_meteo_is_rate_limited(monkeypatch):
    monkeypatch.setattr(weather, "_open_meteo_paused_until", 0.0)
    calls = []

    def handler(request):
        calls.append(request.url.host)
        assert "Outfitly" in request.headers["user-agent"]  # MET Norway requires an identifying agent
        if request.url.host == "api.open-meteo.com":
            return httpx.Response(429, json={"reason": "Daily API request limit exceeded"})
        return httpx.Response(200, json=met_answer())

    transport = httpx.MockTransport(handler)
    w = weather.fetch_forecast(51.51, -0.13, transport=transport)
    assert calls == ["api.open-meteo.com", "api.met.no"]
    assert (w["temp_min"], w["temp_max"]) == (8, 14) and w["wind"] == 18  # 5 m/s
    assert w["code"] == 61 and w["summary"] == "Rain" and w["precipitation"] == 1.5
    assert w["rain_chance"] == 60  # no published probability: 3 wet hours
    # Rate limited: the next places skip Open-Meteo for a while instead of waiting on a refusal.
    weather.fetch_forecast(48.85, 2.35, transport=transport)
    assert calls[2:] == ["api.met.no"]


def test_when_no_provider_answers_users_get_a_plain_message_and_developers_the_causes(monkeypatch):
    monkeypatch.setattr(weather, "_open_meteo_paused_until", 0.0)
    down = httpx.MockTransport(lambda request: httpx.Response(503))
    try:
        weather.fetch_forecast(40.42, -3.7, transport=down)
    except weather.WeatherUnavailable as exc:
        assert str(exc) == "Open-Meteo returned HTTP 503; MET Norway returned HTTP 503"
    else:
        raise AssertionError("expected WeatherUnavailable")

    def broken(*a, **k):
        raise weather.WeatherUnavailable("Open-Meteo returned HTTP 429; MET Norway unreachable (ConnectTimeout)")

    monkeypatch.setattr(main.weather, "fetch_forecast", broken)
    place = {"latitude": 1, "longitude": 2, "style": "Everyday", "pieces": []}
    client = TestClient(main.app)
    for mode, expected in (("dev", "Weather unavailable: Open-Meteo returned HTTP 429"), ("prod", "Weather is unavailable right now. Try again shortly.")):
        monkeypatch.setattr(main.s, "app_env", mode)
        detail = client.post("/today/sample", json=place).json()["detail"]
        assert detail.startswith(expected), detail


def test_place_lookups_never_wait_inside_a_request(monkeypatch):
    # One lookup per second for the whole server: when this second is taken, the forecast shows
    # the time zone at once, and the next request carries on where the lookup stopped.
    slots = iter([True, False, True])
    monkeypatch.setattr(weather, "_lookup_slot", lambda: next(slots))
    monkeypatch.setattr(weather.time, "sleep", lambda s: (_ for _ in ()).throw(AssertionError("slept in a request")))
    zooms = []

    def handler(request):
        zooms.append(request.url.params["zoom"])
        if request.url.params["zoom"] == "10":
            return httpx.Response(200, json={"error": "Unable to geocode"})
        return httpx.Response(200, json={"address": {"county": "Highland", "country": "United Kingdom"}})

    remote = httpx.MockTransport(handler)
    assert weather.place_name(57.12, -4.71, "Europe/London", transport=remote) == "Near London"  # stand-in
    assert weather.place_name(57.12, -4.71, "Europe/London", transport=remote) == "Near Highland, United Kingdom"
    assert zooms == ["10", "8"]  # zoom 10 wasn't asked twice
    assert weather.place_name(57.12, -4.71, "Europe/London", transport=remote) == "Near Highland, United Kingdom"
    assert zooms == ["10", "8"]  # kept for the day
