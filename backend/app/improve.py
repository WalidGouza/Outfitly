"""Suggestions: pieces the user doesn't own that would make their outfits better.

For one outfit, every slot is tried with every garment type that suits the outfit's style, in
every wearable colour and in that type's usual fabric, plus an extra layer when there is none.
Each version is scored with the real engine (matching.score_combo), so a suggested gain is the
change the user would see on the outfit's score.

A suggested piece only exists as a description, so its Meaning can't come from a photo. Its
photo half is calibrated on the user's own photos instead: what their pieces with the same
style tag typically score for that style. Without the ML service every piece, real or not,
is judged on its tag alone, so the comparison stays fair either way.

Across the wardrobe the same piece often improves several outfits. Improvements are grouped by
piece and ranked by how much they add in total, weighted by how well they suit the persona.
"""
from types import SimpleNamespace
from . import meaning
from .attributes import COLOR_NAMES, color_name
from . import garments
from .garments import TYPES
from .matching import hsv, score_combo, texture_score

# Bump when the way suggestions are made changes: stored ones are then recomputed.
VERSION = 3

# Colours people actually buy clothes in (a subset of attributes.COLOR_NAMES).
PALETTE = (
    "Black", "Charcoal", "Grey", "Light grey", "White", "Cream", "Beige", "Camel", "Brown",
    "Burgundy", "Olive", "Khaki", "Sage", "Navy", "Light blue", "Blue", "Red", "Pink",
)
# Near-ties go to colours that work with almost anything: they're the more useful buy.
VERSATILE = {"Black", "Charcoal", "Grey", "White", "Cream", "Beige", "Camel", "Brown", "Navy"}
NEUTRAL_NAMES = {"Navy", "Beige", "Camel", "Brown", "Cream", "Khaki"}
MIN_GAIN = 2  # points; smaller differences aren't worth buying something for


# Types that already say their fabric ("jeans" are denim) don't repeat it.
IMPLIED = {"jeans": "denim", "sweater": "knit", "cardigan": "knit"}
ROLE = {"tops": "top", "pants": "bottoms", "dresses": "dress", "shoes": "shoes", "jackets": "layer"}
SUGGESTED = "suggested"  # the id a candidate piece is scored under


def hex_of(name):
    return "#{:02X}{:02X}{:02X}".format(*COLOR_NAMES[name])


def key_of(category, garment, colour):
    """Identifies a suggested piece, for grouping, dismissals and events."""
    return f"{category}|{garment}|{colour}"


def piece_key(c):
    return key_of(c.category, c.garment or "", color_name(c.color))


def describe(colour, texture, garment):
    fabric = f"{texture} " if texture != "other" and IMPLIED.get(garment) != texture else ""
    return f"{colour} {fabric}{garment}".lower()


def spec_of(garment, colour, style):
    t = TYPES[garment]
    query = describe(colour, t.fabric, garment)
    return {
        "spec": {
            "category": t.category, "garment": garment, "color": hex_of(colour),
            "color_name": colour, "texture": t.fabric, "style": style,
        },
        "query": query,
        "title": query[:1].upper() + query[1:],
    }


# ── Meaning of a piece that has no photo ─────────────────────────────────────
def calibration(pieces, style_vectors):
    """Photo part of Meaning for each target style, by the pieces' style tag (from their photos)."""
    if style_vectors is None:
        return None
    rows = []
    for c in pieces:
        if getattr(c, "embedding", None) is None:
            continue
        profile = meaning.photo_profile(c.embedding, style_vectors)
        rows.append((c.style, profile))
    if not rows:
        return None
    table = {}
    for target in meaning.STYLE_NAMES:
        photo = [(tag, sum(share * meaning.affinity(target, name) for name, share in p.items())) for tag, p in rows]
        overall = sum(v for _, v in photo) / len(photo)
        by_tag = {}
        for tag, v in photo:
            by_tag.setdefault(tag, []).append(v)
        table[target] = {"_all": overall, **{tag: sum(v) / len(v) for tag, v in by_tag.items()}}
    return table


def virtual_fit(target, calib):
    """Meaning of a suggested piece tagged with the target style."""
    tag = meaning.affinity(target, target)
    if not calib:
        return tag
    photo = calib[target].get(target, calib[target]["_all"])
    return meaning.PHOTO_WEIGHT * photo + (1 - meaning.PHOTO_WEIGHT) * tag


# ── One outfit ───────────────────────────────────────────────────────────────
def candidates(category, style, wear):
    for garment, t in TYPES.items():
        if t.category == category and style in t.styles and not (t.women and wear == "men"):
            yield garment, t


def improvements(items, style, semantic, rules, fit, wear="both", exclude=frozenset()):
    """Every clear improvement to one outfit (gain >= MIN_GAIN), one entry per candidate piece."""
    before = score_combo(items, semantic, rules)
    slots = [(c.category, c) for c in items]
    if not any(c.category == "jackets" for c in items):
        slots.append(("jackets", None))
    found = []
    for category, replaced in slots:
        for garment, t in candidates(category, style, wear):
            # Its Meaning: calibrated photo + tag (`fit`), and how typical this type is of the style.
            scores = {**semantic, SUGGESTED: meaning.with_garment(fit, garment, style)}
            for colour in PALETTE:
                key = key_of(category, garment, colour)
                if key in exclude:
                    continue
                if replaced is not None and replaced.garment == garment and color_name(replaced.color) == colour:
                    continue
                piece = SimpleNamespace(
                    id=SUGGESTED, category=category, garment=garment, color=hex_of(colour),
                    texture=t.fabric, style=style, embedding=None,
                )
                after_items = [piece if c is replaced else c for c in items] if replaced is not None else [*items, piece]
                after = score_combo(after_items, scores, rules)
                gain = after["score"] - before["score"]
                if gain >= MIN_GAIN:
                    found.append({
                        "key": key, **spec_of(garment, colour, style),
                        "replaces": replaced.id if replaced is not None else None,
                        "gain": gain, "before": before, "after": after,
                        "_others": [c for c in items if c is not replaced], "_replaced": replaced,
                    })
    return found


def primacy(garment, style):
    """0-1: how typical a garment is of a style (its first listed style is 1). The score can't
    tell beige loafers from beige flats, so this decides between pieces that score the same."""
    styles = TYPES[garment].styles
    return 1 - styles.index(style) / len(styles) if style in styles else 0


def preference(s, persona_fit):
    """Ranks improvements to one outfit: the gain, nudged by versatility and the persona."""
    spec = s["spec"]
    return (
        s["gain"] + (1 if spec["color_name"] in VERSATILE else 0) + 4 * (persona_fit - 0.5)
        + 0.5 * primacy(spec["garment"], spec["style"])
    )


def best_for_outfit(found, persona_fit, rules, limit=3):
    """The best improvement per slot, best first (what the outfit view and the lab show)."""
    by_slot = {}
    for s in found:
        slot = s["replaces"] or "layer"
        score = preference(s, persona_fit(s["spec"]))
        if slot not in by_slot or score > by_slot[slot][0]:
            by_slot[slot] = (score, s)
    chosen = sorted(by_slot.values(), key=lambda x: (x[1]["gain"], x[0]), reverse=True)[:limit]
    return [public(s, persona_fit(s["spec"]), rules) for _, s in chosen]


def public(s, persona_fit, rules):
    out = {k: v for k, v in s.items() if not k.startswith("_")}
    out["reason"] = reason(s, rules)
    out["persona_fit"] = round(persona_fit, 2)
    return out


# ── Why it helps ─────────────────────────────────────────────────────────────
def is_neutral(color, rules):
    _, sat, val = hsv(color)
    return sat < rules["neutral_saturation"] or val < rules["neutral_value_low"]


def relation(a, b, rules):
    if is_neutral(a, rules) or is_neutral(b, rules):
        return "neutral"
    h1, h2 = hsv(a)[0], hsv(b)[0]
    angle = min(abs(h1 - h2), 1 - abs(h1 - h2)) * 360
    if angle <= rules["analogous_degrees"]:
        return "analogous"
    if abs(angle - 180) <= rules["complementary_tolerance"]:
        return "complementary"
    return "clash"


def reason(s, rules):
    """One sentence on why it helps, from whichever part of the score improved most."""
    b, a = s["before"]["breakdown"], s["after"]["breakdown"]
    w = rules["weights"]
    delta = {k: w[k] * (a[k] - b[k]) for k in ("color", "texture", "semantic")}
    main = max(delta, key=delta.get)
    spec, others = s["spec"], s["_others"]
    colour = spec["color_name"]
    if main == "color":
        if is_neutral(spec["color"], rules) or colour in NEUTRAL_NAMES:
            return f"{colour} is a neutral, so it calms the palette and lets the rest of the outfit work together."
        for o in others:
            rel = relation(o.color, spec["color"], rules)
            name = color_name(o.color).lower()
            if rel == "analogous":
                return f"{colour} sits close to your {name} on the colour wheel, so the look feels cohesive."
            if rel == "complementary":
                return f"{colour} is the opposite of your {name} on the colour wheel, which balances it."
        return f"{colour} sits more easily with the other colours in this outfit."
    if main == "texture":
        partner = max(others, key=lambda o: texture_score(o.texture, spec["texture"], rules), default=None)
        if partner is not None and partner.texture != spec["texture"]:
            return f"{spec['texture'].capitalize()} pairs better with your {partner.texture} {ROLE[partner.category]}."
        return f"A {spec['texture']} {spec['garment']} gives the outfit a better mix of fabrics."
    style = spec["style"].lower()
    garment = spec["garment"]
    # The piece it goes best with, by garment type ("go well with your joggers").
    partner = max(
        (o for o in others if garments.pair(garment, o.garment, meaning.affinity) is not None),
        key=lambda o: garments.pair(garment, o.garment, meaning.affinity),
        default=None,
    )
    def with_partner(plural_subject):
        if partner is None:
            return ""
        return f", and {'go' if plural_subject else 'goes'} well with your {partner.garment}"

    replaced = s.get("_replaced")
    if replaced is not None and replaced.garment and replaced.garment != garment:
        return f"{plural(garment).capitalize()} suit {style} better than {plural(replaced.garment)}{with_partner(True)}."
    if replaced is not None:
        return f"It reads more clearly as {style} than your {replaced.name.lower()}{with_partner(False)}."
    if partner is not None:
        return f"A {garment} suits {style}{with_partner(False)}."
    return f"A {garment} reads clearly as {style} and pulls the outfit together."


def is_plural(garment):
    """Jeans, sneakers, trousers...: the names that are already plural."""
    return garment.endswith("s") and not garment.endswith("dress")


def plural(garment):
    if is_plural(garment):
        return garment
    return garment + ("es" if garment.endswith(("ss", "sh")) else "s")


# ── The whole wardrobe ───────────────────────────────────────────────────────
# The stored row holding `reach` for every piece, next to the ranked list (rank -1).
REACH_KEY = "*reach*"


def reach(per_outfit):
    """For every piece that improves any outfit: how many outfits it improves. Covers pieces
    the ranked list leaves out for variety, so an outfit's own best swap can show it too."""
    counts = {}
    for _, found in per_outfit:
        for key in {s["key"] for s in found}:
            counts[key] = counts.get(key, 0) + 1
    return counts


def group(per_outfit, persona_fit, rules, limit=30):
    """Combines every outfit's improvements by piece and ranks the pieces.

    `per_outfit` is a list of (outfit, improvements); an outfit is a dict with its cloth_ids,
    style, source ("saved" or "generated") and name. The value of a piece is the total score it
    adds across outfits, weighted by persona fit. The list keeps one colour per garment type, one
    garment per colour and fabric (they score the same), and at most three pieces per category,
    so it reads as a choice rather than shades of one idea.
    """
    pieces = {}
    for outfit, found in per_outfit:
        best = {}
        for s in found:
            if s["key"] not in best or s["gain"] > best[s["key"]]["gain"]:
                best[s["key"]] = s
        for key, s in best.items():
            entry = pieces.setdefault(key, {"s": s, "uses": []})
            entry["uses"].append((outfit, s))
            if s["gain"] > entry["s"]["gain"]:
                entry["s"] = s
    ranked = []
    for key, entry in pieces.items():
        s, uses = entry["s"], entry["uses"]
        fit = persona_fit(s["spec"])
        total = sum(u["gain"] for _, u in uses)
        value = total * (0.6 + 0.8 * fit) + (1 if s["spec"]["color_name"] in VERSATILE else 0)
        uses.sort(key=lambda u: u[1]["gain"], reverse=True)
        typical = sum(primacy(s["spec"]["garment"], o["style"]) for o, _ in uses) / len(uses)
        ranked.append({
            "_typical": typical,
            "key": key, "spec": s["spec"], "query": s["query"], "title": s["title"],
            "value": round(value, 2), "outfits": len(uses), "total_gain": total,
            "avg_gain": round(total / len(uses), 1), "best_gain": uses[0][1]["gain"],
            "persona_fit": round(fit, 2), "reason": reason(s, rules),
            "examples": [
                {
                    **outfit, "replaces": u["replaces"], "gain": u["gain"],
                    "before": u["before"]["score"], "after": u["after"]["score"],
                }
                for outfit, u in uses[:3]
            ],
        })
    ranked.sort(key=lambda r: (round(r["value"], 1), r["_typical"]), reverse=True)
    chosen, garments, looks, per_category = [], set(), set(), {}
    for r in ranked:
        del r["_typical"]
        spec = r["spec"]
        g = (spec["category"], spec["garment"])
        look = (spec["category"], spec["color_name"], spec["texture"])
        if g in garments or look in looks or per_category.get(g[0], 0) >= 3:
            continue
        garments.add(g)
        looks.add(look)
        per_category[g[0]] = per_category.get(g[0], 0) + 1
        chosen.append(r)
        if len(chosen) >= limit:
            break
    return chosen



# ── Whole outfits ────────────────────────────────────────────────────────────
# The stored row holding the suggested outfits, next to the ranked pieces (rank -2).
LOOKS_KEY = "*looks*"
FIRST = "suggested-1"  # the id the first new piece of a two-piece look is scored under


def look_key(cloth_ids, pieces):
    """Identifies a suggested outfit: the pieces kept and the pieces added."""
    return "look|" + ",".join(sorted(cloth_ids)) + "|" + ",".join(sorted(p["key"] for p in pieces))


def as_piece(s, piece_id):
    """A suggested piece as an outfit item, to score outfits it's part of."""
    spec = s["spec"]
    return SimpleNamespace(
        id=piece_id, category=spec["category"], garment=spec["garment"], color=spec["color"],
        texture=spec["texture"], style=spec["style"], embedding=None, name=s["title"],
    )


def look_json(kind, outfit, steps, rules):
    """A suggested outfit: the owned pieces it keeps, the 1-2 pieces it adds, and the score change."""
    replaced = {s["replaces"] for s in steps if s["replaces"]}
    kept = [cid for cid in outfit["cloth_ids"] if cid not in replaced]
    pieces = [
        {"key": s["key"], "spec": s["spec"], "query": s["query"], "title": s["title"], "replaces": s["replaces"]}
        for s in steps
    ]
    before, after = steps[0]["before"]["score"], steps[-1]["after"]["score"]
    return {
        "key": look_key(kept, pieces), "kind": kind,
        "style": outfit["style"], "source": outfit["source"], "name": outfit.get("name"),
        "cloth_ids": kept, "pieces": pieces,
        "before": before, "after": after, "gain": after - before,
        "reason": reason(steps[0], rules),
    }


def looks(measured, persona_fit, rules, fit_for, wear="both", exclude=frozenset(), improved=4, new=3):
    """Whole outfits to suggest, from the outfits measured for Next buys.

    measured: (outfit, items, semantic, improvements) for each outfit.
    "improved": one of the user's outfits with its best swap in (they own all but one piece).
    "new": that outfit taken further with a second new piece, for a look they don't have yet.
    Each outfit and each new piece is used once per kind, so the looks read as different ideas.
    """
    def pref(s):
        return preference(s, persona_fit(s["spec"]))

    best = [(outfit, items, semantic, max(found, key=pref)) for outfit, items, semantic, found in measured if found]
    best.sort(key=lambda x: pref(x[3]), reverse=True)

    out, outfits, keys = [], set(), set()
    for outfit, _, _, s in best:
        sig = frozenset(outfit["cloth_ids"])
        if sig in outfits or s["key"] in keys:
            continue
        outfits.add(sig)
        keys.add(s["key"])
        out.append(look_json("improved", outfit, [s], rules))
        if len(out) == improved:
            break

    further = []
    for outfit, items, semantic, s in best:
        style = outfit["style"]
        first = as_piece(s, FIRST)
        replaced = s["_replaced"]
        with_first = [first if c is replaced else c for c in items] if replaced is not None else [*items, first]
        scores = {**semantic, FIRST: meaning.with_garment(fit_for(style), s["spec"]["garment"], style)}
        second = [
            t for t in improvements(with_first, style, scores, rules, fit_for(style), wear, exclude | {s["key"]})
            if t["_replaced"] is not first
        ]
        if second:
            t = max(second, key=pref)
            further.append((pref(s) + pref(t), outfit, s, t))
    further.sort(key=lambda x: x[0], reverse=True)
    outfits, keys, count = set(), set(), 0
    for _, outfit, s, t in further:
        sig = frozenset(outfit["cloth_ids"])
        if sig in outfits or {s["key"], t["key"]} & keys:
            continue
        outfits.add(sig)
        keys |= {s["key"], t["key"]}
        out.append(look_json("new", outfit, [s, t], rules))
        count += 1
        if count == new:
            break
    return out
