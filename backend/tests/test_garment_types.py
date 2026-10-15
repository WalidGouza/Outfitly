from io import BytesIO
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from app import main, weather


class Session:
    def __init__(self):
        self.added = []

    def get(self, model, ident):
        return SimpleNamespace(user_id="owner")

    def add(self, item):
        self.added.append(item)

    def commit(self):
        pass


@pytest.fixture
def upload(monkeypatch):
    session = Session()
    monkeypatch.setattr(main, "image_storage", SimpleNamespace(save=lambda jpeg: "photo.jpg", delete=lambda f: None))
    monkeypatch.setattr(main.embeddings, "image", lambda jpeg: [0.0] * 512)
    main.app.dependency_overrides[main.db] = lambda: session
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner")
    raw = BytesIO()
    Image.new("RGB", (8, 8)).save(raw, format="PNG")

    def post(category, garment=None):
        data = {"name": "Piece", "category": category, "texture": "cotton", "style": "Everyday", "color": "#ffffff"}
        if garment is not None:
            data["garment"] = garment
        return TestClient(main.app).post("/wardrobes/w/clothes", data=data, files={"image": ("p.png", raw.getvalue(), "image/png")})

    yield post, session
    main.app.dependency_overrides.clear()


def test_type_is_stored_and_returned(upload):
    post, session = upload
    r = post("tops", "Hoodie")
    assert r.status_code == 200 and r.json()["garment"] == "hoodie"
    assert session.added[0].garment == "hoodie"


def test_type_is_optional(upload):
    post, _ = upload
    assert post("pants").json()["garment"] is None


def test_type_must_belong_to_the_category(upload):
    post, session = upload
    r = post("pants", "hoodie")
    assert r.status_code == 422 and not session.added


def piece(category, name, garment=None, texture="cotton"):
    return SimpleNamespace(category=category, name=name, garment=garment, texture=texture)


def test_weather_reads_the_type_even_when_the_name_says_nothing():
    assert "warm" in weather.tags(piece("tops", "Weekend favourite", "hoodie"))
    assert "summer" in weather.tags(piece("pants", "Beach day", "shorts"))
    assert "heavy" in weather.tags(piece("jackets", "Grandpa's", "coat"))
    assert "boots" in weather.tags(piece("shoes", "Old faithfuls", "boots"))
    # Without a type the name is still used.
    assert "warm" in weather.tags(piece("tops", "Grey hoodie"))
