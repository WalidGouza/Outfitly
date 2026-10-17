"""What each garment type says about style, and how two garments go together.

Colour and fabric can't tell a hoodie from a blazer, but the type of garment is half of what
makes an outfit read as streetwear or smart casual. Every type lists the styles it suits, most
typical first; from that list come:

* fit(garment, style): how typical the garment is of a style (0-1). A hoodie is 1 for
  Streetwear, 0.4 for Smart casual; heels are 1 for Evening, about 0.24 for Streetwear.
* pair(a, b): how well two garments go together (0-1), from how close their styles are.
  Hoodie with dress shoes is low, jeans with sneakers is high. A few classic pairings that cross
  styles on purpose (a blazer with jeans) are set explicitly in CLASSIC_PAIRS.

Meaning (meaning.py) blends both in, so the real score, and the gain of a suggested piece,
change with the type of garment and not only its colour and fabric.
Mirrored for the browser in frontend/src/garments.ts.
"""
from types import SimpleNamespace


def T(category, fabric, styles, women=False):
    return SimpleNamespace(category=category, fabric=fabric, styles=styles, women=women)


# The fabric each type usually comes in and the styles it suits, most typical first.
TYPES = {
    "t-shirt": T("tops", "cotton", ["Everyday", "Minimal", "Streetwear"]),
    "shirt": T("tops", "cotton", ["Smart casual", "Minimal", "Everyday", "Evening"]),
    "blouse": T("tops", "silk", ["Smart casual", "Evening", "Minimal"], True),
    "polo shirt": T("tops", "cotton", ["Everyday", "Smart casual"]),
    "sweater": T("tops", "knit", ["Everyday", "Minimal", "Smart casual"]),
    "hoodie": T("tops", "cotton", ["Streetwear", "Everyday"]),
    "sweatshirt": T("tops", "cotton", ["Streetwear", "Everyday"]),
    "tank top": T("tops", "cotton", ["Everyday", "Streetwear"]),
    "crop top": T("tops", "cotton", ["Streetwear", "Everyday"], True),
    "camisole": T("tops", "silk", ["Evening", "Minimal"], True),
    "bodysuit": T("tops", "cotton", ["Evening", "Minimal", "Smart casual"], True),
    "corset top": T("tops", "silk", ["Evening"], True),
    "jeans": T("pants", "denim", ["Everyday", "Streetwear", "Minimal"]),
    "trousers": T("pants", "other", ["Smart casual", "Minimal", "Evening"]),
    "chinos": T("pants", "cotton", ["Smart casual", "Everyday", "Minimal"]),
    "shorts": T("pants", "cotton", ["Everyday", "Streetwear"]),
    "skirt": T("pants", "cotton", ["Smart casual", "Minimal", "Everyday"], True),
    "mini skirt": T("pants", "leather", ["Evening", "Streetwear"], True),
    "wide-leg trousers": T("pants", "linen", ["Minimal", "Smart casual", "Evening"]),
    "culottes": T("pants", "linen", ["Minimal", "Smart casual"], True),
    "joggers": T("pants", "cotton", ["Streetwear", "Everyday"]),
    "leggings": T("pants", "other", ["Everyday", "Streetwear"], True),
    "mini dress": T("dresses", "silk", ["Evening", "Everyday"], True),
    "midi dress": T("dresses", "linen", ["Smart casual", "Minimal", "Evening", "Everyday"], True),
    "maxi dress": T("dresses", "linen", ["Evening", "Everyday"], True),
    "shirt dress": T("dresses", "cotton", ["Smart casual", "Everyday", "Minimal"], True),
    "jumpsuit": T("dresses", "linen", ["Minimal", "Evening", "Smart casual"], True),
    "sneakers": T("shoes", "leather", ["Everyday", "Streetwear", "Minimal"]),
    "boots": T("shoes", "leather", ["Everyday", "Streetwear"]),
    "loafers": T("shoes", "leather", ["Smart casual", "Minimal"]),
    "sandals": T("shoes", "leather", ["Everyday"]),
    "heels": T("shoes", "leather", ["Evening", "Smart casual"], True),
    "flats": T("shoes", "leather", ["Minimal", "Smart casual", "Everyday"]),
    "ballet flats": T("shoes", "leather", ["Minimal", "Everyday", "Smart casual"], True),
    "mules": T("shoes", "leather", ["Minimal", "Smart casual", "Evening"], True),
    "ankle boots": T("shoes", "leather", ["Smart casual", "Everyday", "Minimal"]),
    "dress shoes": T("shoes", "leather", ["Evening", "Smart casual"]),
    "jacket": T("jackets", "denim", ["Everyday", "Streetwear"]),
    "coat": T("jackets", "other", ["Smart casual", "Minimal", "Evening"]),
    "blazer": T("jackets", "other", ["Smart casual", "Evening", "Minimal"]),
    "cardigan": T("jackets", "knit", ["Everyday", "Minimal"]),
    "puffer jacket": T("jackets", "other", ["Streetwear", "Everyday"]),
    "trench coat": T("jackets", "cotton", ["Smart casual", "Minimal"]),
    "cropped jacket": T("jackets", "denim", ["Streetwear", "Everyday"], True),
}

# Weight of a style by its place in a type's list: the first is what the garment is, the
# others what it can also do.
RANK_WEIGHTS = (1.0, 0.8, 0.65, 0.5)

# Pairings that cross styles on purpose and work (symmetric).
CLASSIC_PAIRS = {
    frozenset(p): v
    for p, v in {
        ("blazer", "jeans"): 0.85,
        ("blazer", "t-shirt"): 0.8,
        ("blazer", "sneakers"): 0.7,
        ("coat", "sneakers"): 0.7,
        ("trench coat", "jeans"): 0.85,
        ("shirt", "jeans"): 0.85,
        ("sweater", "trousers"): 0.8,
        ("t-shirt", "trousers"): 0.75,
        ("midi dress", "sneakers"): 0.75,
        ("shirt dress", "sneakers"): 0.75,
        ("jacket", "midi dress"): 0.75,
        ("hoodie", "coat"): 0.7,
        ("loafers", "jeans"): 0.8,
        ("ankle boots", "jeans"): 0.85,
        ("ankle boots", "midi dress"): 0.8,
    }.items()
}


def profile(garment):
    """(style, weight) pairs for a known garment type, most typical first; empty otherwise."""
    t = TYPES.get(garment or "")
    return list(zip(t.styles, RANK_WEIGHTS)) if t else []


def fit(garment, target, affinity):
    """How typical a garment is of the target style (0-1), or None for an unknown type."""
    styles = profile(garment)
    if not styles:
        return None
    return max(w * affinity(target, s) for s, w in styles)


def pair(a, b, affinity):
    """How well two garments go together (0-1), or None when either type is unknown."""
    if not profile(a) or not profile(b):
        return None
    classic = CLASSIC_PAIRS.get(frozenset((a, b)))
    if classic is not None:
        return classic
    return max(wa * wb * affinity(sa, sb) for sa, wa in profile(a) for sb, wb in profile(b))
