import json
from types import SimpleNamespace
from pathlib import Path
from app.matching import color_score, texture_score, rank

raw = Path(".env.example").read_text().split("BUSINESS_RULES_JSON=", 1)[1].strip()
rules = json.loads(raw)


def piece(id, category, color="#eeeeee", texture="cotton"):
    return SimpleNamespace(id=id, category=category, color=color, texture=texture)


def test_complementary_and_neutral_colors():
    assert color_score("#ff0000", "#00ffff", rules) > color_score(
        "#ff0000", "#00ff00", rules
    )
    assert color_score("#ffffff", "#ff0000", rules) == rules["neutral_score"]


def test_color_wraparound():
    assert color_score("#ff0000", "#ff0010", rules) > 0.9
    assert color_score("#ff0000", "#ff0010", rules) == color_score(
        "#ff0010", "#ff0000", rules
    )


def test_texture_pair_is_symmetric():
    assert texture_score("denim", "cotton", rules) == texture_score(
        "cotton", "denim", rules
    )


def test_missing_required_category():
    assert (
        rank({"tops": [piece("t", "tops")], "pants": [], "shoes": []}, {}, rules) == []
    )


def test_anchor_and_diversity():
    pools = {
        "tops": [piece("t", "tops"), piece("t2", "tops")],
        "pants": [piece("p", "pants")],
        "shoes": [piece("s", "shoes")],
        "jackets": [piece("j", "jackets"), piece("j2", "jackets")],
    }
    scores = {c.id: 0.8 for pool in pools.values() for c in pool}
    results = rank(pools, scores, rules, anchor="t")
    assert len(results) == 1
    assert any(x.id == "t" for x in results[0]["items"])
    assert 0 <= results[0]["score"] <= 100
    assert set(results[0]["breakdown"]) == {"semantic", "color", "texture"}


def test_candidate_limit_and_score_order():
    pools = {
        "tops": [piece("t", "tops"), piece("t2", "tops")],
        "pants": [piece("p", "pants")],
        "shoes": [piece("s", "shoes")],
    }
    scores = {"t": 0, "t2": 1, "p": 0.5, "s": 0.5}
    assert rank(pools, scores, rules)[0]["items"][0].id == "t2"
    assert len(rank(pools, scores, {**rules, "max_combinations": 1})) == 1
