import json
from types import SimpleNamespace
from pathlib import Path
from app import attributes, weather
from app.matching import is_outfit, rank

rules = json.loads(Path(".env.example").read_text().split("BUSINESS_RULES_JSON=", 1)[1].strip())


def piece(id, category, color="#808080", texture="cotton"):
    return SimpleNamespace(id=id, category=category, color=color, texture=texture)


def test_an_outfit_is_separates_or_a_dress():
    assert is_outfit(["tops", "pants", "shoes"]) and is_outfit(["tops", "pants", "shoes", "jackets"])
    assert is_outfit(["dresses", "shoes"]) and is_outfit(["dresses", "shoes", "jackets"])
    assert not is_outfit(["dresses", "tops", "shoes"])
    assert not is_outfit(["tops", "pants"]) and not is_outfit(["tops", "tops", "pants", "shoes"])


def test_ranking_mixes_dresses_and_separates():
    pools = {
        "tops": [piece("t", "tops", "#eeeeee")], "pants": [piece("p", "pants", "#1f2a4a")],
        "dresses": [piece("d", "dresses", "#2e3a52")], "shoes": [piece("s", "shoes", "#7a5235", "leather")],
    }
    semantic = {x.id: 0.8 for pool in pools.values() for x in pool}
    looks = rank(pools, semantic, rules)
    shapes = {tuple(sorted(i.category for i in look["items"])) for look in looks}
    assert shapes == {("pants", "shoes", "tops"), ("dresses", "shoes")}
    # A dress can be the starting piece.
    assert all("d" in [i.id for i in look["items"]] for look in rank(pools, semantic, rules, anchor="d"))


def test_a_wardrobe_with_only_a_dress_and_shoes_still_makes_outfits():
    pools = {"dresses": [piece("d", "dresses")], "shoes": [piece("s", "shoes")]}
    assert len(rank(pools, {"d": 0.8, "s": 0.8}, rules)) == 1


def test_detection_follows_what_the_person_wears():
    every = {g for _, g, _ in attributes.garments_for(None)}
    mens = {(c, g) for c, g, _ in attributes.garments_for("men")}
    assert {"mini dress", "crop top", "heels", "skirt"} <= every
    assert not any(c == "dresses" for c, _ in mens)
    assert ("tops", "shirt") in mens and ("tops", "blouse") not in mens
    assert {g for _, g, _ in attributes.garments_for("women")} == every


def test_classification_never_offers_womenswear_to_men():
    garments, prompts = attributes._labels("men")
    vectors = [[1.0 if j == i else 0.0 for j in range(8)] for i in range(len(prompts))]
    result = attributes.classify([1.0] + [0.0] * 7, vectors, "men")
    assert result["garment"] not in attributes.WOMEN_ONLY


def test_new_types_have_weather_traits():
    dress = SimpleNamespace(category="dresses", name="Floral dress", garment="mini dress", texture="cotton")
    boots = SimpleNamespace(category="shoes", name="Old faithfuls", garment="ankle boots", texture="leather")
    trench = SimpleNamespace(category="jackets", name="Beige", garment="trench coat", texture="cotton")
    assert "summer" in weather.tags(dress)
    assert "boots" in weather.tags(boots)
    assert "waterproof" in weather.tags(trench)
