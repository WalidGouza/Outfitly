from io import BytesIO
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from app import attributes, main
from app.embeddings import EmbeddingUnavailable


def photo(garment=(30, 40, 75), background=(250, 250, 250)):
    im = Image.new("RGB", (200, 260), background)
    ImageDraw.Draw(im).rectangle((50, 40, 150, 220), fill=garment)
    return im


@pytest.mark.parametrize("garment, background, name", [
    ((30, 40, 75), (250, 250, 250), "Navy"),
    ((245, 245, 245), (40, 40, 40), "White"),
    ((200, 35, 45), (210, 210, 210), "Red"),
])
def test_dominant_color_ignores_background(garment, background, name):
    color = attributes.dominant_color(photo(garment, background))
    assert attributes.color_name(color) == name


def test_dominant_color_handles_full_frame_garment():
    assert attributes.color_name(attributes.dominant_color(Image.new("RGB", (64, 64), (110, 72, 45)))) == "Brown"


def one_hot(index, size=512):
    return [1.0 if i == index else 0.0 for i in range(size)]


def labels_pointing_at(garment, texture, style):
    """Label vectors where the wanted labels align with the image vector (axis 0)."""
    garments, prompts = attributes._labels()
    wanted = {attributes.GARMENTS[c][g] for c, g, _ in garments if g == garment}
    wanted |= {attributes.TEXTURES.get(texture), attributes.STYLES[style]}
    return [one_hot(0) if p in wanted else one_hot(i + 1) for i, p in enumerate(prompts)]


def test_classify_picks_labels_and_category():
    result = attributes.classify(one_hot(0), labels_pointing_at("blazer", "linen", "Smart casual"))
    assert result["category"] == "jackets" and result["garment"] == "blazer"
    assert result["texture"] == "linen" and result["style"] == "Smart casual"
    assert all(v > 0.9 for v in result["confidence"].values())


def test_uncertain_texture_falls_back_to_other():
    vectors = labels_pointing_at("jeans", None, "Everyday")
    assert attributes.classify(one_hot(0), vectors)["texture"] == "other"


@pytest.mark.parametrize("color, garment, texture, expected", [
    ("#1e284b", "blazer", "linen", "Navy linen blazer"),
    ("#2d5abe", "jeans", "denim", "Blue jeans"),
    ("#191919", "boots", "leather", "Black leather boots"),
    ("#f5f5f5", "t-shirt", "cotton", "White t-shirt"),
    ("#f5f5f5", None, None, "White piece"),
])
def test_piece_name(color, garment, texture, expected):
    assert attributes.piece_name(color, garment, texture) == expected


def jpeg_bytes():
    raw = BytesIO()
    photo().save(raw, format="PNG")
    return raw.getvalue()


@pytest.fixture
def api(monkeypatch):
    main.app.dependency_overrides[main.db] = lambda: SimpleNamespace(get=lambda model, ident: SimpleNamespace(user_id="owner"))
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner")
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_analyze_endpoint_suggests_all_fields(api, monkeypatch):
    monkeypatch.setattr(main.embeddings, "image", lambda jpeg: one_hot(0))
    monkeypatch.setattr(main.embeddings, "texts", lambda prompts: labels_pointing_at("sweater", "knit", "Minimal"))
    r = api.post("/wardrobes/w/clothes/analyze", files={"image": ("top.png", jpeg_bytes(), "image/png")})
    assert r.status_code == 200
    body = r.json()
    assert body["detected"] and body["name"] == "Navy sweater"
    assert (body["category"], body["garment"], body["texture"], body["style"]) == ("tops", "sweater", "knit", "Minimal")
    assert attributes.color_name(body["color"]) == "Navy"


def test_analyze_without_ml_service_still_detects_color(api, monkeypatch):
    def down(jpeg):
        raise EmbeddingUnavailable("not configured")

    monkeypatch.setattr(main.embeddings, "image", down)
    r = api.post("/wardrobes/w/clothes/analyze", files={"image": ("top.png", jpeg_bytes(), "image/png")})
    assert r.status_code == 200
    body = r.json()
    assert not body["detected"] and body["category"] is None and body["garment"] is None and body["name"] == "Navy piece"


def test_analyze_rejects_non_images(api):
    r = api.post("/wardrobes/w/clothes/analyze", files={"image": ("x.png", b"nope", "image/png")})
    assert r.status_code == 400
