"""Exploration: a few cards in Next buys that aren't there to improve an outfit, but to learn the
user's taste where Outfitly knows least: styles they don't wear much, colours they don't own,
garments and colours they haven't reacted to yet. Reactions to them train the persona like any
other suggestion's (learning.py), so later suggestions fit better.

Picks are drawn fresh each day (seeded by user and date, so the deck doesn't reshuffle on every
visit), varied (one per style, category and colour), and never repeat a trait the user has
clearly turned down or a piece they've already reacted to.
"""
import random

from . import meaning
from .garments import TYPES
from .improve import PALETTE, key_of, spec_of
from .persona import style_share

COUNT = 4
AVOID = -0.4  # learned weight at which a trait counts as turned down
JITTER = 0.35  # how much chance mixes up the order, so it's not always the same few pieces


def picks(persona, exclude, seed, count=COUNT):
    """Up to `count` pieces worth asking the user about, most informative first."""
    weights = (persona.get("learned") or {}).get("weights") or {}
    wear = persona.get("wear") or "both"
    owned_colours = {c["name"] for c in persona.get("colors") or []}
    rng = random.Random(seed)

    def weight(trait, value):
        return weights.get(trait, {}).get(value, 0.0)

    options = []
    for style in meaning.AFFINITY:
        # 1 for a style the user never wears, 0 once it's half their wardrobe.
        novelty = 1 - min(1.0, 2 * style_share(persona, style))
        for garment, t in TYPES.items():
            if style not in t.styles or (t.women and wear == "men"):
                continue
            for colour in PALETTE:
                key = key_of(t.category, garment, colour)
                traits = (("style", style), ("garment", garment), ("color_name", colour))
                if key in exclude or any(weight(tr, v) <= AVOID for tr, v in traits):
                    continue
                # What a reaction would teach: little where the weights are already clear.
                unknown = sum(1 - abs(weight(tr, v)) for tr, v in traits) / len(traits)
                new_colour = colour not in owned_colours
                score = 0.45 * novelty + 0.2 * new_colour + 0.35 * unknown + JITTER * rng.random()
                options.append((score, key, garment, colour, style, novelty, new_colour))
    options.sort(key=lambda o: -o[0])

    chosen, used = [], set()
    for _, key, garment, colour, style, novelty, new_colour in options:
        category = TYPES[garment].category
        if {("style", style), ("category", category), ("colour", colour)} & used:
            continue
        used |= {("style", style), ("category", category), ("colour", colour)}
        chosen.append({
            "key": key,
            **spec_of(garment, colour, style),
            "value": 0, "outfits": 0, "total_gain": 0, "avg_gain": 0, "best_gain": 0,
            "reason": reason(style, colour, novelty, new_colour),
            "examples": [],
            "explore": True,
        })
        if len(chosen) == count:
            break
    return chosen


def reason(style, colour, novelty, new_colour):
    if novelty >= 0.6:
        return f"More {style.lower()} than what you usually wear."
    if new_colour:
        return f"{colour} isn’t in your wardrobe yet."
    return f"A different take on {style.lower()}."
