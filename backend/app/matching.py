import colorsys
import itertools


def hsv(color):
    return colorsys.rgb_to_hsv(*(int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)))


def color_score(a, b, rules):
    h1, s1, v1 = hsv(a)
    h2, s2, v2 = hsv(b)
    if (
        min(s1, s2) < rules["neutral_saturation"]
        or min(v1, v2) < rules["neutral_value_low"]
    ):
        return rules["neutral_score"]
    angle = min(abs(h1 - h2), 1 - abs(h1 - h2)) * 360
    if angle <= rules["analogous_degrees"]:
        return 1 - angle / rules["analogous_falloff_degrees"]
    if abs(angle - 180) <= rules["complementary_tolerance"]:
        return rules["complementary_score"]
    if abs(angle - 120) <= rules["complementary_tolerance"]:
        return rules["triadic_score"]
    return rules["unmatched_color_score"]


def texture_score(a, b, rules):
    if a == b:
        return rules["same_texture_score"]
    return rules["texture_pairs"].get(
        f"{a}:{b}",
        rules["texture_pairs"].get(f"{b}:{a}", rules["unknown_texture_score"]),
    )


def score_combo(combo, semantic, rules):
    """Match score (0-100) and its meaning/colour/fabric breakdown for one outfit."""
    pairs = list(itertools.combinations(combo, 2))
    parts = {
        "semantic": sum(semantic[x.id] for x in combo) / len(combo),
        "color": sum(color_score(a.color, b.color, rules) for a, b in pairs)
        / len(pairs),
        "texture": sum(texture_score(a.texture, b.texture, rules) for a, b in pairs)
        / len(pairs),
    }
    score = sum(parts[k] * rules["weights"][k] for k in parts)
    return {
        "score": round(score * 100),
        "breakdown": {k: round(v * 100) for k, v in parts.items()},
    }


# The two ways to build an outfit; a layer (jackets) can go over either.
SHAPES = (("tops", "pants", "shoes"), ("dresses", "shoes"))


def is_outfit(categories):
    """True for one piece per slot of a valid shape, with or without a layer."""
    cats = list(categories)
    if len(cats) != len(set(cats)):
        return False
    base = set(cats) - {"jackets"}
    return any(base == set(shape) for shape in SHAPES)


def rank(pools, semantic, rules, limit=6, anchor=None):
    layer = ["jackets"] if pools.get("jackets") else []
    shapes = [list(shape) + layer for shape in SHAPES if all(pools.get(c) for c in shape)]
    if not shapes:
        return []
    results = []
    n = 0
    for categories in shapes:
        for combo in itertools.product(*(pools[c] for c in categories)):
            n += 1
            if n > rules["max_combinations"]:
                break
            if anchor and anchor not in [x.id for x in combo]:
                continue
            results.append({"items": list(combo), **score_combo(combo, semantic, rules)})
    results.sort(key=lambda x: x["score"], reverse=True)
    # Greedy diversity avoids returning the same base outfit with only different jackets.
    selected = []
    bases = set()
    for result in results:
        base = tuple(x.id for x in result["items"] if x.category != "jackets")
        if base in bases:
            continue
        selected.append(result)
        bases.add(base)
        if len(selected) >= limit:
            break
    return selected
