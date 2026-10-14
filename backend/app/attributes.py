"""Suggest a garment's name, category, texture, style and color from its photo.

Color comes from the pixels (Pillow only). Category, texture and style use CLIP
zero-shot classification: the photo's embedding is compared with embeddings of
short text labels from the ML service. Suggestions only pre-fill the upload
form; the user confirms or edits every field before saving.
"""
import math
from PIL import Image

# Garment types, grouped by app category. The type also names the piece.
GARMENTS = {
    "tops": {
        "t-shirt": "a photo of a t-shirt",
        "shirt": "a photo of a button-up shirt",
        "blouse": "a photo of a blouse",
        "polo shirt": "a photo of a polo shirt",
        "sweater": "a photo of a sweater",
        "hoodie": "a photo of a hoodie",
        "sweatshirt": "a photo of a sweatshirt",
        "tank top": "a photo of a tank top",
    },
    "pants": {
        "jeans": "a photo of jeans",
        "trousers": "a photo of trousers",
        "chinos": "a photo of chinos",
        "shorts": "a photo of shorts",
        "skirt": "a photo of a skirt",
        "joggers": "a photo of joggers",
        "leggings": "a photo of leggings",
    },
    "shoes": {
        "sneakers": "a photo of sneakers",
        "boots": "a photo of boots",
        "loafers": "a photo of loafers",
        "sandals": "a photo of sandals",
        "heels": "a photo of high heels",
        "dress shoes": "a photo of leather dress shoes",
    },
    "jackets": {
        "jacket": "a photo of a jacket",
        "coat": "a photo of a coat",
        "blazer": "a photo of a blazer",
        "cardigan": "a photo of a cardigan",
        "puffer jacket": "a photo of a puffer jacket",
    },
}
TEXTURES = {
    "cotton": "a close-up photo of a cotton garment",
    "denim": "a close-up photo of a denim garment",
    "knit": "a close-up photo of a knitted wool garment",
    "leather": "a close-up photo of a leather garment",
    "linen": "a close-up photo of a linen garment",
    "silk": "a close-up photo of a shiny silk garment",
}
STYLES = {
    "Everyday": "a photo of casual everyday clothing",
    "Minimal": "a photo of plain minimalist clothing",
    "Smart casual": "a photo of smart casual clothing",
    "Streetwear": "a photo of streetwear clothing",
    "Evening": "a photo of elegant evening wear",
}
# Below this probability, texture falls back to "other".
TEXTURE_MIN = 0.35
# CLIP's learned logit scale for turning cosine similarities into probabilities.
LOGIT_SCALE = 100

COLOR_NAMES = {
    "Black": (25, 25, 25), "Charcoal": (60, 64, 70), "Grey": (128, 128, 128),
    "Light grey": (195, 195, 195), "White": (245, 245, 245), "Cream": (240, 230, 205),
    "Beige": (214, 196, 163), "Camel": (193, 154, 107), "Brown": (110, 72, 45),
    "Burgundy": (120, 25, 40), "Red": (200, 35, 45), "Pink": (238, 150, 170),
    "Orange": (232, 120, 45), "Mustard": (205, 165, 45), "Yellow": (240, 215, 70),
    "Olive": (107, 107, 52), "Khaki": (170, 160, 115), "Sage": (150, 170, 140),
    "Green": (45, 135, 70), "Teal": (20, 125, 125), "Light blue": (155, 190, 225),
    "Blue": (45, 90, 190), "Navy": (30, 40, 75), "Purple": (110, 60, 140),
    "Lavender": (190, 170, 220),
}


def dominant_color(im: Image.Image) -> str:
    """Most common color of the garment, ignoring a plain background."""
    small = im.convert("RGB")
    small.thumbnail((96, 96))
    w, h = small.size
    border = [small.getpixel((x, y)) for x in range(w) for y in (0, h - 1)]
    border += [small.getpixel((x, y)) for y in range(h) for x in (0, w - 1)]
    background = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))
    # Garments are usually centered; the border is mostly background.
    center = small.crop((w * 15 // 100, h * 15 // 100, max(1, w * 85 // 100), max(1, h * 85 // 100)))
    raw = center.tobytes()
    pixels = [tuple(raw[i : i + 3]) for i in range(0, len(raw), 3)]
    garment = [p for p in pixels if math.dist(p, background) > 45]
    if len(garment) >= len(pixels) // 10:
        pixels = garment
    strip = Image.new("RGB", (len(pixels), 1))
    strip.putdata(pixels)
    quantized = strip.quantize(colors=5, method=Image.Quantize.MEDIANCUT)
    _, index = max(quantized.getcolors())
    r, g, b = quantized.getpalette()[index * 3 : index * 3 + 3]
    return f"#{r:02x}{g:02x}{b:02x}"


def color_name(color: str) -> str:
    rgb = tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))
    return min(COLOR_NAMES, key=lambda name: math.dist(COLOR_NAMES[name], rgb))


def _probabilities(image, vectors):
    logits = [LOGIT_SCALE * sum(a * b for a, b in zip(image, v)) for v in vectors]
    top = max(logits)
    weights = [math.exp(x - top) for x in logits]
    total = sum(weights)
    return [x / total for x in weights]


def _labels():
    garments = [(c, g, p) for c, types in GARMENTS.items() for g, p in types.items()]
    return garments, tuple(p for *_, p in garments) + tuple(TEXTURES.values()) + tuple(STYLES.values())


def classify(image_vector, label_vectors):
    """Zero-shot category/type, texture and style with confidences in [0, 1]."""
    garments, _ = _labels()
    n, t = len(garments), len(TEXTURES)
    garment_p = _probabilities(image_vector, label_vectors[:n])
    by_category = {c: 0.0 for c in GARMENTS}
    for (category, _, _), p in zip(garments, garment_p):
        by_category[category] += p
    category = max(by_category, key=by_category.get)
    best = max(
        (i for i, g in enumerate(garments) if g[0] == category), key=lambda i: garment_p[i]
    )
    texture_p = dict(zip(TEXTURES, _probabilities(image_vector, label_vectors[n : n + t])))
    texture = max(texture_p, key=texture_p.get)
    style_p = dict(zip(STYLES, _probabilities(image_vector, label_vectors[n + t :])))
    style = max(style_p, key=style_p.get)
    return {
        "category": category,
        "garment": garments[best][1],
        "texture": texture if texture_p[texture] >= TEXTURE_MIN else "other",
        "style": style,
        "confidence": {
            "category": round(by_category[category], 2),
            "texture": round(texture_p[texture], 2),
            "style": round(style_p[style], 2),
        },
    }


def piece_name(color: str, garment: str | None, texture: str | None) -> str:
    words = [color_name(color)]
    if texture in {"denim", "leather", "linen", "silk"} and garment not in {"jeans", None}:
        words.append(texture)
    words.append(garment or "piece")
    return " ".join(words).capitalize()


def suggest(im: Image.Image, jpeg: bytes, embeddings):
    """Form suggestions; raises EmbeddingUnavailable when the ML service is down."""
    color = dominant_color(im)
    _, prompts = _labels()
    result = classify(embeddings.image(jpeg), embeddings.texts(prompts))
    return {
        "name": piece_name(color, result["garment"], result["texture"]),
        "color": color,
        **{k: result[k] for k in ("category", "texture", "style", "confidence")},
        "detected": True,
    }


def suggest_color_only(im: Image.Image):
    """Fallback without the ML service: color and a generic name only."""
    color = dominant_color(im)
    return {
        "name": piece_name(color, None, None),
        "color": color,
        "category": None,
        "texture": None,
        "style": None,
        "confidence": {},
        "detected": False,
    }
