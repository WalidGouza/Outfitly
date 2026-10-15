from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app import main
from app.embeddings import EmbeddingUnavailable
from app.models import Cloth, Wardrobe


def piece(id, category, color, texture="cotton"):
    return SimpleNamespace(
        id=id, name=id, category=category, color=color, texture=texture,
        style="Everyday", image=None, embedding=[1.0] + [0.0] * 511,
    )


class Session:
    def __init__(self):
        self.pieces = {p.id: p for p in (
            piece("t", "tops", "#eeeeee"), piece("p", "pants", "#2e3a52", "denim"), piece("s", "shoes", "#7a5235", "leather"),
        )}

    def get(self, model, ident):
        if model is Wardrobe:
            return SimpleNamespace(user_id="owner")
        if model is Cloth:
            return self.pieces.get(ident)

    def scalars(self, query):
        return iter([SimpleNamespace(id="o1", name="Look", style="Everyday", cloth_ids=["t", "p", "s"])])


@pytest.fixture
def client():
    main.app.dependency_overrides[main.db] = lambda: Session()
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner")
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_saved_outfits_carry_their_match_score(client, monkeypatch):
    monkeypatch.setattr(main.embeddings, "text", lambda value: [1.0] + [0.0] * 511)
    look = client.get("/wardrobes/w/outfits").json()[0]
    assert set(look["breakdown"]) == {"semantic", "color", "texture"}
    assert look["breakdown"]["semantic"] == 100
    assert 0 <= look["score"] <= 100


def test_saved_outfits_still_list_when_ml_is_down(client, monkeypatch):
    def down(value):
        raise EmbeddingUnavailable("down")

    monkeypatch.setattr(main.embeddings, "text", down)
    look = client.get("/wardrobes/w/outfits").json()[0]
    assert look["id"] == "o1" and "score" not in look
