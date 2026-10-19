"""Learning from feedback: what the user's reactions to suggestions say about their taste.

Every suggestion is a piece with traits: its garment type, colour, style, fabric and category.
Each reaction is a signal on all of those traits at once:

    added (uploaded a piece we suggested)  +2     saved +1     I own this +1     opened its outfits +0.3
    taken off the saved list              -0.5    Not for me -1
    a suggested outfit: saved +0.8, I own it +0.8, taken off Saved -0.3, Not for me -0.5, on each
    new piece in it (a "no" to an outfit may be about the combination, not the piece)
    shown 5 times without any reaction    -0.25 (repeats: 10 times is -0.5...)

Per trait value the signals are summed and smoothed into a weight between -1 and 1:

    weight = sum(signal x recency) / (PRIOR + sum(|signal| x recency))

PRIOR keeps a single click from swinging a whole colour, and recency halves a signal's say every
HALF_LIFE_DAYS, so tastes can change. A suggested piece's learned adjustment is the weighted mix
of its traits' weights (TRAIT_WEIGHTS), which persona.fit adds to how well the piece suits the
wardrobe. Exact pieces the user dismissed or owns are excluded from suggestions altogether.
"""
from datetime import datetime, timezone
from .garments import TYPES

SIGNALS = {"added": 2.0, "bought": 2.5, "saved": 1.0, "owned": 1.0, "clicked": 0.3, "unsaved": -0.5, "dismissed": -1.0,
           "look_saved": 0.8, "look_owned": 0.8, "look_unsaved": -0.3, "look_dismissed": -0.5}
IGNORED_EVERY = 5  # shown this many times with no reaction at all counts as one "ignored"
IGNORED = -0.25
HALF_LIFE_DAYS = 90
PRIOR = 3.0
# How much each trait says about whether a piece is wanted (adds up to 1).
TRAIT_WEIGHTS = {"garment": 0.3, "color_name": 0.3, "style": 0.2, "texture": 0.1, "category": 0.1}
# How far learning can move a piece's persona fit (0-1) either way.
STRENGTH = 0.3
# Shown on the profile page as learned likes and dislikes: weights at least this strong, from at
# least NOTABLE_REACTIONS reactions (one "Not for me" shouldn't read as "you dislike leather").
NOTABLE = 0.15
NOTABLE_REACTIONS = 2


def recency(at, now):
    if at is None:
        return 1.0
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    days = max(0.0, (now - at).total_seconds() / 86400)
    return 0.5 ** (days / HALF_LIFE_DAYS)


def traits(spec):
    return {t: spec[t] for t in TRAIT_WEIGHTS if spec.get(t)}


def spec_from_key(key):
    """The traits a "category|garment|colour" key carries (fabric from the garment type)."""
    try:
        category, garment, colour = key.split("|")
    except ValueError:
        return {}
    t = TYPES.get(garment)
    return {"category": category, "garment": garment, "color_name": colour, **({"texture": t.fabric} if t else {})}


def learn(events, shown=None, now=None):
    """Learned weights from reactions.

    events: (action, key, spec, created_at) for every reaction except "shown".
    shown: {key: times shown}, for pieces the user never reacted to.
    """
    now = now or datetime.now(timezone.utc)
    sums = {}
    reacted = set()
    signals = 0

    def add(spec, value, reaction=True):
        for trait, v in traits(spec).items():
            signed, size, n = sums.setdefault(trait, {}).get(v, (0.0, 0.0, 0))
            sums[trait][v] = (signed + value, size + abs(value), n + (1 if reaction else 0))

    for action, key, spec, at in events:
        signal = SIGNALS.get(action)
        if signal is None:
            continue
        reacted.add(key)
        signals += 1
        add(spec or spec_from_key(key), signal * recency(at, now))
    for key, n in (shown or {}).items():
        times = n // IGNORED_EVERY
        if key not in reacted and times:
            add(spec_from_key(key), IGNORED * times, reaction=False)
    weights = {
        trait: {v: round(signed / (PRIOR + size), 3) for v, (signed, size, _) in values.items()}
        for trait, values in sums.items()
    }
    notable = sorted(
        (
            (trait, v, w)
            for trait, values in weights.items()
            for v, w in values.items()
            if abs(w) >= NOTABLE and sums[trait][v][2] >= NOTABLE_REACTIONS
        ),
        key=lambda x: -abs(x[2]),
    )
    return {
        "weights": weights,
        "likes": [{"trait": t, "value": v, "weight": w} for t, v, w in notable if w > 0][:6],
        "dislikes": [{"trait": t, "value": v, "weight": w} for t, v, w in notable if w < 0][:6],
        "signals": signals,
    }


def adjustment(learned, spec):
    """-1 to 1: what the user's reactions say about a piece with these traits."""
    weights = (learned or {}).get("weights") or {}
    if not weights:
        return 0.0
    return sum(TRAIT_WEIGHTS[t] * weights.get(t, {}).get(v, 0.0) for t, v in traits(spec).items())


def coarse(learned):
    """The learned weights rounded to 0.05, for fingerprints: one more "shown" or a day of fading
    doesn't recompute every suggestion, a real change in taste does."""
    weights = (learned or {}).get("weights") or {}
    return sorted(
        (t, v, round(w * 20) / 20) for t, values in weights.items() for v, w in values.items() if round(w * 20)
    )
