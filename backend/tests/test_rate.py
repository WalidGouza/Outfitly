from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app import main
from app.embeddings import EmbeddingUnavailable
from app.models import Wardrobe

STYLE_AXIS = {"Everyday": 0, "Minimal": 1, "Smart casual": 2, "Streetwear": 3, "Evening": 4}


def vector(i):
    return [1.0 if j == i else 0.0 for j in range(512)]


def piece(id, category, embedding, color="#808080", texture="cotton"):
    return SimpleNamespace(id=id, name=id, category=category, color=color, texture=texture,
                           style="Everyday", garment=None, image=None, wardrobe_id="w", embedding=embedding)


# Every piece "looks" Smart casual, so Auto should pick that style.
PIECES = [
    piece("t", "tops", vector(2), "#eee7d7"), piece("p", "pants", vector(2), "#1f2a4a"),
    piece("s", "shoes", vector(2), "#7a5235", "leather"), piece("t2", "tops", vector(2)),
]


class Session:
    def get(self, model, ident):
        if model is Wardrobe:
            return SimpleNamespace(user_id="owner")

    def scalars(self, stmt):
        ids = next(v for v in stmt.compile().params.values() if isinstance(v, list))
        return iter([p for p in PIECES if p.id in ids])


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main.embeddings, "text", lambda value: vector(next(i for s, i in STYLE_AXIS.items() if f"A {s} " in value)))
    main.app.dependency_overrides[main.db] = lambda: Session()
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner")
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_auto_reports_the_style_the_outfit_fits_best(client):
    r = client.post("/wardrobes/w/rate", json={"cloth_ids": ["t", "p", "s"]})
    assert r.status_code == 200
    body = r.json()
    assert body["style"] == "Smart casual" and body["breakdown"]["semantic"] == 100 and not body["estimated"]
    assert {i["id"] for i in body["items"]} == {"t", "p", "s"}


def test_a_chosen_style_is_scored_as_that_style(client):
    body = client.post("/wardrobes/w/rate", json={"cloth_ids": ["t", "p", "s"], "style": "Evening"}).json()
    assert body["style"] == "Evening" and body["breakdown"]["semantic"] == 0


def test_rating_matches_the_saved_outfit_score(client):
    body = client.post("/wardrobes/w/rate", json={"cloth_ids": ["t", "p", "s"], "style": "Everyday"}).json()
    assert body["score"] == main.saved_score([PIECES[0], PIECES[1], PIECES[2]], "Everyday")["score"]


def test_an_outfit_needs_one_piece_per_category(client):
    assert client.post("/wardrobes/w/rate", json={"cloth_ids": ["t", "t2", "s"]}).status_code == 400


def test_without_the_ml_service_colour_and_fabric_still_rate(client, monkeypatch):
    def down(value):
        raise EmbeddingUnavailable("down")

    monkeypatch.setattr(main.embeddings, "text", down)
    body = client.post("/wardrobes/w/rate", json={"cloth_ids": ["t", "p", "s"]}).json()
    assert body["estimated"] and body["breakdown"]["semantic"] == 75 and body["style"] == "Everyday"
