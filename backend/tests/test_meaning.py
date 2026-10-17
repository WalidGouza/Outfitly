import json
import math
from pathlib import Path
from types import SimpleNamespace
from app import meaning
from app.matching import score_combo

rules = json.loads(Path(".env.example").read_text().split("BUSINESS_RULES_JSON=", 1)[1].strip())
STYLE_VECTORS = [[1.0 if j == i else 0.0 for j in range(8)] for i in range(len(meaning.STYLE_NAMES))]


def photo(**similarity):
    """A photo embedding whose cosine similarity with each style description is as given.
    Real CLIP values: a clear match is ~0.28, unrelated ~0.20 - a narrow band, never near 1."""
    values = [similarity.get(name.replace(" ", "_").lower(), 0.20) for name in meaning.STYLE_NAMES]
    rest = math.sqrt(max(0.0, 1 - sum(v * v for v in values)))
    return values + [rest] + [0.0] * (8 - len(values) - 1)


def piece(id, category, style, embedding):
    return SimpleNamespace(id=id, category=category, style=style, embedding=embedding, color="#808080", texture="cotton")


def outfit_meaning(items, target, vectors=STYLE_VECTORS):
    return score_combo(items, meaning.piece_scores(items, target, vectors), rules)["breakdown"]["semantic"]


streetwear_photo = photo(streetwear=0.28, everyday=0.25)
evening_photo = photo(evening=0.29, smart_casual=0.25)
hoodie = piece("h", "tops", "Streetwear", streetwear_photo)
joggers = piece("j", "pants", "Streetwear", streetwear_photo)
sneakers = piece("s", "shoes", "Streetwear", streetwear_photo)


def test_raw_clip_similarity_alone_would_score_a_perfect_match_badly():
    # What the old formula reported for a clear streetwear photo: its raw cosine, about 28%.
    raw = sum(a * b for a, b in zip(streetwear_photo, STYLE_VECTORS[meaning.STYLE_NAMES.index("Streetwear")]))
    assert round(raw * 100) == 28


def test_streetwear_pieces_judged_as_streetwear_mean_a_lot():
    assert outfit_meaning([hoodie, joggers, sneakers], "Streetwear") >= 90


def test_a_near_style_counts_for_something_and_a_far_one_for_little():
    near = outfit_meaning([hoodie, joggers, sneakers], "Everyday")
    far = outfit_meaning([hoodie, joggers, sneakers], "Evening")
    assert 60 <= near < 90 and far < 40


def test_mixing_styles_lowers_meaning():
    gown_trousers = piece("e", "pants", "Evening", evening_photo)
    pumps = piece("p", "shoes", "Evening", evening_photo)
    assert outfit_meaning([hoodie, gown_trousers, pumps], "Streetwear") < outfit_meaning([hoodie, joggers, sneakers], "Streetwear") - 25


def test_the_tag_alone_still_works_without_photos():
    assert outfit_meaning([hoodie, joggers, sneakers], "Streetwear", vectors=None) == 100


def test_an_ambiguous_photo_is_carried_by_the_tag():
    unclear = photo()  # equally (un)like every style
    plain = piece("u", "tops", "Streetwear", unclear)
    assert outfit_meaning([plain, joggers, sneakers], "Streetwear") >= 85


def test_affinity_is_symmetric():
    for a in meaning.STYLE_NAMES:
        for b in meaning.STYLE_NAMES:
            assert meaning.affinity(a, b) == meaning.affinity(b, a)
