"""Meaning: how well an outfit fits the style it's being judged as (0-1).

Each piece gets a fit for the target style from two signals:

* Photo: CLIP compares the photo with a short description of each of the five styles
  (the same prompts photo detection uses) and turns those similarities into shares that
  add up to 1, e.g. 70% Streetwear, 20% Everyday... Raw CLIP similarities sit in a narrow
  band around 0.15-0.35 whatever the photo, so they can't be used as a 0-1 score directly;
  comparing the styles against each other is what makes the signal meaningful.
* Tag: the style the user confirmed for the piece.

Both are read through AFFINITY, so a near style counts for something: a Streetwear piece in
an Everyday outfit is a reasonable fit, in an Evening outfit it isn't. Finally the outfit gets
a cohesion bonus when its pieces' styles agree with each other.
"""
import math
from .attributes import LOGIT_SCALE, STYLES

STYLE_NAMES = tuple(STYLES)
# Embedded once per model and stored (text_embeddings), so this costs nothing per request.
PROMPTS = tuple(STYLES.values())

# How well a piece of one style suits an outfit of another (symmetric, 1 on the diagonal).
AFFINITY = {
    "Everyday": {"Everyday": 1.0, "Minimal": 0.7, "Smart casual": 0.5, "Streetwear": 0.7, "Evening": 0.2},
    "Minimal": {"Everyday": 0.7, "Minimal": 1.0, "Smart casual": 0.7, "Streetwear": 0.4, "Evening": 0.5},
    "Smart casual": {"Everyday": 0.5, "Minimal": 0.7, "Smart casual": 1.0, "Streetwear": 0.3, "Evening": 0.6},
    "Streetwear": {"Everyday": 0.7, "Minimal": 0.4, "Smart casual": 0.3, "Streetwear": 1.0, "Evening": 0.2},
    "Evening": {"Everyday": 0.2, "Minimal": 0.5, "Smart casual": 0.6, "Streetwear": 0.2, "Evening": 1.0},
}
PHOTO_WEIGHT = 0.5  # photo vs. the user's own style tag, per piece
COHESION_WEIGHT = 0.2  # how much the pieces agreeing with each other counts, per outfit
# Bump when the formula changes: saved outfits scored with an older version are rescored once.
SCORE_VERSION = 2


def affinity(target, style):
    """0-1; an unknown or missing style is treated as neutral."""
    return AFFINITY.get(target, {}).get(style, 0.5)


def _unit(v):
    n = math.sqrt(sum(float(x) * float(x) for x in v)) or 1.0
    return [float(x) / n for x in v]


def photo_profile(vector, style_vectors):
    """Shares of each style in a photo (adding up to 1), from CLIP similarities."""
    image = _unit(vector)
    logits = [LOGIT_SCALE * sum(a * b for a, b in zip(image, _unit(v))) for v in style_vectors]
    top = max(logits)
    weights = [math.exp(x - top) for x in logits]
    total = sum(weights)
    return {name: w / total for name, w in zip(STYLE_NAMES, weights)}


def piece_fit(piece, target, style_vectors=None):
    """How well one piece fits the target style. Without photo vectors, the tag alone."""
    tag = affinity(target, getattr(piece, "style", None))
    embedding = getattr(piece, "embedding", None)
    if style_vectors is None or embedding is None:
        return tag
    profile = photo_profile(embedding, style_vectors)
    photo = sum(share * affinity(target, name) for name, share in profile.items())
    return PHOTO_WEIGHT * photo + (1 - PHOTO_WEIGHT) * tag


def piece_scores(items, target, style_vectors=None):
    return {c.id: piece_fit(c, target, style_vectors) for c in items}


def cohesion(items):
    """Average style agreement between every pair of pieces; None when styles are unknown."""
    styles = [s for s in (getattr(c, "style", None) for c in items) if s in AFFINITY]
    pairs = [(a, b) for i, a in enumerate(styles) for b in styles[i + 1 :]]
    if not pairs:
        return None
    return sum(affinity(a, b) for a, b in pairs) / len(pairs)
