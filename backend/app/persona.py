"""The persona: what Outfitly knows about a user's taste, derived from their wardrobe.

v0 needs no history: the wardrobe is already the best signal, and before there is one, the
styles the user picked when they first signed in. It reads, across all of the user's wardrobes:

* styles: the style mix of their pieces (half the photo, half the tag, as Meaning reads them)
  and of the outfits they chose to save, which count more because they were picked. The styles
  chosen at sign-in count like a few pieces each (CHOSEN_WEIGHT): all there is at first, a
  smaller part of the mix as the wardrobe grows;
* colours, fabrics and garment types they own most;
* what they wear (profile) and how they reacted to suggestions so far (suggestion_events).

Suggestions are weighted by `fit`, how well a suggested piece suits this persona, adjusted by
what the user's reactions to earlier suggestions taught us (learning.py).
"""
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from . import learning, meaning
from .attributes import COLOR_NAMES, color_name
from .matching import color_score

VERSION = 3
SAVED_OUTFIT_WEIGHT = 1.5  # a saved outfit says more about taste than one piece
CHOSEN_WEIGHT = 3  # pieces' worth, shared between the styles picked at sign-in
STYLE_WEIGHT, COLOUR_WEIGHT, FABRIC_WEIGHT = 0.55, 0.3, 0.15


def fingerprint(*parts):
    """Changes whenever anything the result depends on changes; used to know when to recompute."""
    raw = json.dumps(parts, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha1(raw.encode()).hexdigest()[:20]


def _shares(counter, top=None):
    total = sum(counter.values())
    if not total:
        return []
    return [(k, v / total) for k, v in counter.most_common(top)]


def derive(pieces, outfits, wear, style_vectors=None, feedback=None, learned=None, chosen=None):
    """The persona as stored on the user and shown on the profile page."""
    styles = Counter()
    for c in pieces:
        tag = {c.style: 1.0} if c.style in meaning.AFFINITY else {}
        embedding = getattr(c, "embedding", None)
        if style_vectors is not None and embedding is not None:
            photo = meaning.photo_profile(embedding, style_vectors)
            mix = {k: meaning.PHOTO_WEIGHT * v for k, v in photo.items()}
            for k, v in tag.items():
                mix[k] = mix.get(k, 0) + (1 - meaning.PHOTO_WEIGHT) * v
        else:
            mix = tag
        styles.update(mix)
    for o in outfits:
        if o.style in meaning.AFFINITY:
            styles[o.style] += SAVED_OUTFIT_WEIGHT
    picked = [s for s in (chosen or []) if s in meaning.AFFINITY]
    for s in picked:
        styles[s] += CHOSEN_WEIGHT / len(picked)
    colours = Counter(color_name(c.color) for c in pieces)
    fabrics = Counter(c.texture for c in pieces)
    garments = Counter(c.garment for c in pieces if c.garment)
    persona = {
        "version": VERSION,
        "styles": [{"name": k, "share": round(v, 3)} for k, v in _shares(styles)],
        "colors": [
            {"name": k, "hex": "#{:02X}{:02X}{:02X}".format(*COLOR_NAMES[k]), "share": round(v, 3)}
            for k, v in _shares(colours, 6)
        ],
        "fabrics": [{"name": k, "share": round(v, 3)} for k, v in _shares(fabrics, 4)],
        "garments": [{"name": k, "count": v} for k, v in garments.most_common(5)],
        "wear": wear or "both",
        "based_on": {"pieces": len(pieces), "outfits": len(outfits)},
        "chosen": picked,
        "feedback": {k: (feedback or {}).get(k, 0) for k in ("saved", "dismissed", "owned")},
        "learned": learned or learning.learn([]),
        "estimated": style_vectors is None,
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    persona["summary"] = summary(persona)
    return persona


def _join(words):
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def summary(p):
    """One plain sentence describing the persona."""
    if not p["based_on"]["pieces"]:
        if p.get("chosen"):
            names = [s.lower() for s in p["chosen"]]
            return f"You like {_join(names)}. Add a few pieces and Outfitly will learn the rest from your wardrobe."
        return "Add a few pieces and Outfitly will learn your style from them."
    styles = p["styles"]
    lead = styles[0]
    if lead["share"] >= 0.55 or len(styles) == 1:
        style = f"Mostly {lead['name'].lower()}"
    else:
        style = f"{lead['name']} with a good share of {styles[1]['name'].lower()}"
    colours = [c["name"].lower() for c in p["colors"][:3]]
    text = f"{style}. You wear a lot of {_join(colours)}"
    if p["fabrics"]:
        text += f", mostly in {p['fabrics'][0]['name']}" if p["fabrics"][0]["name"] != "other" else ""
    return text + "."


def style_share(persona, name):
    return next((s["share"] for s in persona.get("styles", []) if s["name"] == name), 0.0)


def top_styles(persona, n=3, min_share=0.15):
    """The styles worth building outfits in for this user, most worn first."""
    chosen = [s["name"] for s in persona.get("styles", []) if s["share"] >= min_share][:n]
    return chosen or ["Everyday"]


def fit(persona, spec, rules):
    """0-1: how well a suggested piece suits this persona.

    Style: how close the piece's style is to the styles the user wears (through AFFINITY).
    Colour: how well its colour goes with the colours they own most.
    Fabric: whether they already wear that fabric.
    Then learning: what their reactions to earlier suggestions say about the piece's traits.
    """
    styles = persona.get("styles") or []
    style = sum(s["share"] * meaning.affinity(spec["style"], s["name"]) for s in styles) if styles else 0.5
    colours = persona.get("colors") or []
    total = sum(c["share"] for c in colours)
    colour = (
        sum(c["share"] * color_score(spec["color"], c["hex"], rules) for c in colours) / total if total else 0.5
    )
    fabrics = {f["name"]: f["share"] for f in persona.get("fabrics") or []}
    top = max(fabrics.values(), default=0)
    fabric = 0.5 + 0.5 * (fabrics.get(spec["texture"], 0) / top) if top else 0.5
    base = STYLE_WEIGHT * style + COLOUR_WEIGHT * colour + FABRIC_WEIGHT * fabric
    learned = learning.adjustment(persona.get("learned"), spec)
    return min(1.0, max(0.0, base + learning.STRENGTH * learned))
