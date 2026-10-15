"""Weather-aware outfit of the day.

1. `fetch_forecast` gets today's forecast for a location from Open-Meteo (no API key).
2. `plan` runs the forecast through a list of rules ("feels below 10 °C => heavy coat
   required"). Rules are data: the defaults below, or WEATHER_RULES_JSON in the env.
3. `tags` reads what a piece is good for (warm, waterproof, breathable...) from its name,
   category and fabric, and `fit` scores it against the plan.
4. `missing` lists the essentials today calls for that the wardrobe doesn't have.
"""
import json
import re
import time
from datetime import date
from functools import lru_cache
import httpx

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
NOMINATIM = "https://nominatim.openstreetmap.org/reverse"
# Nominatim's usage policy asks for an identifying User-Agent and cached, low-volume use.
USER_AGENT = "Outfitly/1.0 (outfit of the day weather)"


class WeatherUnavailable(Exception):
    pass


# Each rule: `when` (all conditions must hold) and `then` (effects). `note` is shown to the user.
# Conditions: feel_below, feel_at_least, rain_chance_at_least, precipitation_at_least,
# wind_at_least, snow (true/false). Effects: layer (none|optional|required), warmth (light|heavy),
# prefer / avoid (piece tags), essential (a key of ESSENTIALS).
DEFAULT_RULES = [
    {"when": {"feel_below": 10}, "then": {"layer": "required", "warmth": "heavy", "prefer": ["warm"], "avoid": ["summer"], "essential": "heavy_coat"},
     "note": "Below 10 °C: a heavy coat is required."},
    {"when": {"feel_at_least": 10, "feel_below": 16}, "then": {"layer": "required", "warmth": "light", "avoid": ["summer"], "essential": "light_layer"},
     "note": "Cool day: bring a light jacket or overshirt."},
    {"when": {"feel_at_least": 16, "feel_below": 22}, "then": {"layer": "optional"},
     "note": "Mild: a layer is up to you."},
    {"when": {"feel_at_least": 22}, "then": {"layer": "none", "prefer": ["breathable"], "avoid": ["warm", "heavy"]},
     "note": "Warm: skip the layer and keep fabrics light."},
    {"when": {"feel_at_least": 27}, "then": {"prefer": ["summer"], "avoid": ["denim_top"]},
     "note": "Hot: linen, short sleeves and open shoes work best."},
    {"when": {"rain_chance_at_least": 50}, "then": {"layer": "required", "prefer": ["waterproof", "boots"], "avoid": ["suede", "canvas", "summer_shoes"], "essential": "rain_layer"},
     "note": "Rain likely: wear a waterproof layer and leave suede at home."},
    {"when": {"snow": True}, "then": {"layer": "required", "warmth": "heavy", "prefer": ["boots", "warm"], "avoid": ["suede", "canvas", "summer_shoes"], "essential": "winter_boots"},
     "note": "Snow: warm, waterproof boots."},
    {"when": {"wind_at_least": 40}, "then": {"layer": "required", "prefer": ["windproof"]},
     "note": "Windy: a layer that blocks the wind."},
]

ESSENTIALS = {
    "heavy_coat": {"category": "jackets", "tag": "heavy", "item": "A warm coat", "example": "a wool coat, parka or puffer"},
    "light_layer": {"category": "jackets", "tag": None, "item": "A light jacket", "example": "an overshirt, denim jacket or light bomber"},
    "rain_layer": {"category": "jackets", "tag": "waterproof", "item": "A waterproof jacket", "example": "a rain jacket or trench coat"},
    "winter_boots": {"category": "shoes", "tag": "boots", "item": "Waterproof boots", "example": "leather or rubber-soled boots"},
}

# Snow weather codes (WMO): snow fall, snow grains, snow showers.
SNOW_CODES = {71, 73, 75, 77, 85, 86}
DESCRIPTIONS = [
    ({0}, "Clear sky"), ({1}, "Mainly clear"), ({2}, "Partly cloudy"), ({3}, "Overcast"),
    ({45, 48}, "Fog"), ({51, 53, 55, 56, 57}, "Drizzle"), ({61, 63, 65, 66, 67}, "Rain"),
    (SNOW_CODES, "Snow"), ({80, 81, 82}, "Rain showers"), ({95, 96, 99}, "Thunderstorm"),
]
LAYER_ORDER = {"none": 0, "optional": 1, "required": 2}


def describe(code):
    return next((text for codes, text in DESCRIPTIONS if code in codes), "Mixed weather")


def load_rules(raw: str = ""):
    rules = json.loads(raw) if raw.strip() else DEFAULT_RULES
    if not isinstance(rules, list) or not all(isinstance(r, dict) and "when" in r and "then" in r for r in rules):
        raise ValueError("WEATHER_RULES_JSON must be a list of {when, then, note} rules")
    for r in rules:
        essential = r["then"].get("essential")
        if essential and essential not in ESSENTIALS:
            raise ValueError(f"Unknown essential in weather rules: {essential}")
        if r["then"].get("layer", "optional") not in LAYER_ORDER:
            raise ValueError("Rule layer must be none, optional or required")
    return rules


def fetch_forecast(latitude: float, longitude: float, transport=None, url: str = OPEN_METEO):
    # ~1 km precision is plenty for weather and keeps the exact position off the wire.
    return _fetch(round(latitude, 2), round(longitude, 2), date.today().isoformat(), transport, url)


@lru_cache(maxsize=256)
def _fetch(latitude, longitude, day, transport, url):
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": "temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,"
        "precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code",
        "current": "temperature_2m,apparent_temperature,weather_code",
        "timezone": "auto",
        "forecast_days": 1,
    }
    try:
        with httpx.Client(transport=transport, timeout=8) as client:
            response = client.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        d = {k: v[0] for k, v in data["daily"].items() if isinstance(v, list)}
        current = data.get("current", {})
        feels_max, feels_min = float(d["apparent_temperature_max"]), float(d["apparent_temperature_min"])
        return {
            "temp_max": round(float(d["temperature_2m_max"])),
            "temp_min": round(float(d["temperature_2m_min"])),
            "temp_now": round(float(current.get("temperature_2m", d["temperature_2m_max"]))),
            # Daytime "feels like": weighted toward the afternoon, when you're out.
            "feels_like": round((2 * feels_max + feels_min) / 3),
            "rain_chance": int(d.get("precipitation_probability_max") or 0),
            "precipitation": round(float(d.get("precipitation_sum") or 0), 1),
            "wind": round(float(d.get("wind_speed_10m_max") or 0)),
            "code": int(d.get("weather_code") or 0),
            "summary": describe(int(d.get("weather_code") or 0)),
            "timezone": data.get("timezone", ""),
        }
    except (httpx.HTTPError, KeyError, TypeError, ValueError, IndexError):
        raise WeatherUnavailable("Weather is unavailable right now. Try again shortly.") from None


def place_name(latitude: float, longitude: float, timezone: str = "", transport=None, url: str = NOMINATIM):
    """A name for the forecast's position, so users can check it's theirs. Only the label is
    approximated: the forecast always stays at the exact coordinates.

    "Lyon, France" when there is a town; otherwise the closest larger named area ("Near Highland,
    United Kingdom"); at sea or when the lookup is down, the forecast's time zone ("Near Azores").
    """
    name = _place(round(latitude, 2), round(longitude, 2), date.today().isoformat(), transport, url)
    if name:
        return name
    # Generic zones far out at sea ("Etc/GMT+3") name no place, so they're not used.
    region = timezone.rsplit("/", 1)[-1].replace("_", " ") if "/" in timezone and not timezone.startswith("Etc/") else ""
    return f"Near {region}" if region else None


TOWN_KEYS = ("city", "town", "village", "hamlet", "municipality", "suburb")
AREA_KEYS = ("county", "state_district", "state", "region", "province", "archipelago", "island")


@lru_cache(maxsize=256)
def _place(latitude, longitude, day, transport, url):
    # Town level first, then wider areas until something has a name. Nominatim allows one request
    # per second, so the fallbacks are spaced out (they only happen far from any town, then cached).
    for attempt, zoom in enumerate((10, 8, 5, 3)):
        if attempt:
            time.sleep(1)
        params = {"lat": latitude, "lon": longitude, "format": "jsonv2", "zoom": zoom, "accept-language": "en"}
        try:
            with httpx.Client(transport=transport, timeout=5, headers={"User-Agent": USER_AGENT}) as client:
                response = client.get(url, params=params)
            response.raise_for_status()
            address = response.json().get("address") or {}
        except (httpx.HTTPError, ValueError, AttributeError):
            return None
        town = next((address[k] for k in TOWN_KEYS if address.get(k)), None)
        area = next((address[k] for k in AREA_KEYS if address.get(k)), None)
        country = address.get("country")
        if town:
            return ", ".join(dict.fromkeys(x for x in (town, country) if x))
        if area or country:
            return "Near " + ", ".join(dict.fromkeys(x for x in (area, country) if x))
    return None


def _holds(when, w):
    checks = {
        "feel_below": lambda v: w["feels_like"] < v,
        "feel_at_least": lambda v: w["feels_like"] >= v,
        "rain_chance_at_least": lambda v: w["rain_chance"] >= v or (v <= 50 and w["precipitation"] >= 1),
        "precipitation_at_least": lambda v: w["precipitation"] >= v,
        "wind_at_least": lambda v: w["wind"] >= v,
        "snow": lambda v: (w["code"] in SNOW_CODES) == bool(v),
    }
    return all(checks[k](v) for k, v in when.items() if k in checks)


def plan(w, rules):
    """Combines every rule that matches today's weather into one plan."""
    out = {"layer": None, "warmth": None, "prefer": [], "avoid": [], "essentials": [], "notes": []}
    for rule in rules:
        if not _holds(rule["when"], w):
            continue
        then = rule["then"]
        if "layer" in then and (out["layer"] is None or LAYER_ORDER[then["layer"]] > LAYER_ORDER[out["layer"]]):
            out["layer"] = then["layer"]
        if then.get("warmth") == "heavy" or (then.get("warmth") and not out["warmth"]):
            out["warmth"] = then["warmth"]
        out["prefer"] += [t for t in then.get("prefer", []) if t not in out["prefer"]]
        out["avoid"] += [t for t in then.get("avoid", []) if t not in out["avoid"]]
        if then.get("essential") and then["essential"] not in out["essentials"]:
            out["essentials"].append(then["essential"])
        if rule.get("note"):
            out["notes"].append(rule["note"])
    out["layer"] = out["layer"] or "optional"
    # A tag that is both wanted and unwanted (rain boots on a hot day) stays wanted.
    out["avoid"] = [t for t in out["avoid"] if t not in out["prefer"]]
    if out["warmth"] == "heavy":
        # A heavy coat covers a light-layer need.
        out["essentials"] = [e for e in out["essentials"] if e != "light_layer"]
    return out


def _has(text, words):
    return re.search(r"\b(" + "|".join(words) + r")", text) is not None


def tags(piece):
    """What a piece is good for, read from its name, category and fabric."""
    name = (piece.name or "").lower()
    texture, category = piece.texture, piece.category
    t = set()
    if category == "jackets":
        if _has(name, ["coat", "parka", "puffer", "down", "peacoat", "overcoat", "shearling", "duffle", "quilted", "padded", "wool"]):
            t |= {"heavy", "warm", "windproof"}
        if _has(name, ["rain", "waterproof", "shell", "trench", "parka", "anorak", "mac", "windbreaker", "cagoule", "gore"]) or texture == "leather":
            t |= {"waterproof", "windproof"}
        if texture == "denim" or _has(name, ["bomber", "blazer", "overshirt", "shacket"]):
            t.add("windproof")
    if texture == "knit" or _has(name, ["wool", "merino", "cashmere", "fleece", "sweater", "jumper", "hoodie", "turtleneck", "flannel", "corduroy", "thermal", "knit", "cardigan"]):
        t.add("warm")
    if texture in {"linen", "silk"} or _has(name, ["linen", "tee", "t-shirt", "tank", "short sleeve", "short-sleeve", "polo", "shorts", "sandal"]):
        t.add("breathable")
    if _has(name, ["shorts", "sandal", "slide", "espadrille", "tank", "flip"]):
        t.add("summer")
    if category == "shoes":
        if _has(name, ["boot"]):
            t |= {"boots", "warm"}
        if _has(name, ["sandal", "slide", "espadrille", "flip"]):
            t.add("summer_shoes")
        if _has(name, ["suede"]):
            t.add("suede")
        if _has(name, ["canvas", "espadrille"]):
            t.add("canvas")
    if category == "tops" and texture == "denim":
        t.add("denim_top")
    return t


def fit(piece, p):
    """0-1: how well a piece suits today's plan. Avoided pieces sink but stay usable as a last resort."""
    t = tags(piece)
    score = 0.7
    score += 0.12 * len(t & set(p["prefer"]))
    # The fabric itself counts too: linen and silk breathe best, knits keep heat best.
    if "breathable" in p["prefer"] and piece.texture in {"linen", "silk"}:
        score += 0.08
    if "warm" in p["prefer"] and piece.texture == "knit":
        score += 0.08
    if piece.category == "jackets":
        if p["warmth"] == "heavy":
            score += 0.2 if "heavy" in t else -0.25
        if "rain_layer" in p["essentials"]:
            score += 0.15 if "waterproof" in t else -0.15
        if p["layer"] == "none":
            score -= 0.3
    if t & set(p["avoid"]):
        score = min(score, 0.15)
    return max(0.0, min(1.0, score))


def missing(pieces, p, w):
    """Essentials today's weather calls for that the wardrobe doesn't have."""
    out = []
    for key in p["essentials"]:
        e = ESSENTIALS[key]
        have = [x for x in pieces if x.category == e["category"] and (e["tag"] is None or e["tag"] in tags(x))]
        if not have:
            out.append({
                "key": key,
                "category": e["category"],
                "item": e["item"],
                "reason": f"{w['summary']}, feels like {w['feels_like']} °C"
                + (f", {w['rain_chance']}% chance of rain" if w["rain_chance"] >= 30 else "")
                + f". Consider {e['example']}.",
            })
    return out


def wants_layer(p, w):
    return p["layer"] == "required" or (p["layer"] == "optional" and (w["feels_like"] < 19 or w["wind"] >= 30))


def query(style, w, p):
    """Text the ML service embeds to steer meaning toward the weather."""
    words = ["cold" if w["feels_like"] < 10 else "cool" if w["feels_like"] < 16 else "mild" if w["feels_like"] < 22 else "warm"]
    if "rain_layer" in p["essentials"]:
        words.append("rainy")
    return f"A {style} outfit for a {' '.join(words)} day"
