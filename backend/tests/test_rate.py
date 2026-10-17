from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app import main, meaning
from app.embeddings import EmbeddingUnavailable
from app.models import Wardrobe

SC = meaning.STYLE_NAMES.index("Smart casual")


def axis(i):
    return [1.0 if j == i else 0.0 for j in range(512)]


def style_axes(prompts):
    return [axis(i) for i in range(len(prompts))]


def piece(id, category, color="#808080", texture="cotton", style="Smart casual"):
    # Photos "look" Smart casual and the user tagged them Smart casual.
    return SimpleNamespace(id=id, name=id, category=category, color=color, texture=texture,
                           style=style, garment=None, image=None, wardrobe_id="w", embedding=axis(SC))


PIECES = [
    piece("t", "tops", "#eee7d7"), piece("p", "pants", "#1f2a4a"),
    piece("s", "shoes", "#7a5235", "leather"), piece("t2", "tops"),
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
    monkeypatch.setattr(main.embeddings, "texts", style_axes)
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
    # Smart casual pieces judged as Evening: a related style, so partly, not fully.
    assert body["style"] == "Evening" and 50 <= body["breakdown"]["semantic"] < 80


def test_rating_matches_the_saved_outfit_score(client):
    body = client.post("/wardrobes/w/rate", json={"cloth_ids": ["t", "p", "s"], "style": "Everyday"}).json()
    assert body["score"] == main.saved_score([PIECES[0], PIECES[1], PIECES[2]], "Everyday")["score"]


def test_an_outfit_needs_one_piece_per_category(client):
    assert client.post("/wardrobes/w/rate", json={"cloth_ids": ["t", "t2", "s"]}).status_code == 400


def test_without_the_ml_service_the_style_tags_still_rate(client, monkeypatch):
    def down(prompts):
        raise EmbeddingUnavailable("down")

    monkeypatch.setattr(main.embeddings, "texts", down)
    body = client.post("/wardrobes/w/rate", json={"cloth_ids": ["t", "p", "s"]}).json()
    assert body["estimated"] and body["style"] == "Smart casual" and body["breakdown"]["semantic"] == 100
