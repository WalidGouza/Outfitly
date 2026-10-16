from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app import main
from app.models import Cloth, Wardrobe

CATEGORIES = ("tops", "pants", "shoes", "jackets", "dresses")


def vector(*head):
    return list(head) + [0.0] * (512 - len(head))


def piece(id, category, embedding, color="#808080", texture="cotton"):
    return SimpleNamespace(id=id, name=id, category=category, color=color, texture=texture,
                           style="Everyday", image=None, wardrobe_id="w", embedding=embedding)


# The starting piece looks nothing like the style text, which used to drag its outfits' scores around.
PIECES = {p.id: p for p in (
    piece("t1", "tops", vector(0.9, 0.1)), piece("t2", "tops", vector(0.2, 0.9)),
    piece("p1", "pants", vector(0.8, 0.3), "#2e3a52", "denim"),
    piece("s1", "shoes", vector(0.7, 0.2), "#7a5235", "leather"),
)}


class Session:
    def get(self, model, ident):
        if model is Wardrobe:
            return SimpleNamespace(user_id="owner")
        if model is Cloth:
            return PIECES.get(ident)

    def scalars(self, stmt):
        params = stmt.compile().params.values()
        category = next(v for v in params if v in CATEGORIES)
        return SimpleNamespace(all=lambda: [p for p in PIECES.values() if p.category == category])


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main.embeddings, "text", lambda value: vector(1.0))
    main.app.dependency_overrides[main.db] = lambda: Session()
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner")
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def scores(response):
    return {tuple(sorted(i["id"] for i in look["items"])): (look["score"], look["breakdown"]) for look in response.json()}


def test_starting_piece_does_not_change_an_outfits_score(client):
    body = {"style": "Everyday", "include_jacket": False}
    free = scores(client.post("/wardrobes/w/generate", json=body))
    anchored = scores(client.post("/wardrobes/w/generate", json={**body, "anchor_id": "t2"}))
    outfit = ("p1", "s1", "t2")
    assert anchored[outfit] == free[outfit]
    # Only outfits with the starting piece come back.
    assert list(anchored) == [outfit]


def test_generated_and_saved_scores_agree(client):
    look = client.post("/wardrobes/w/generate", json={"style": "Everyday", "include_jacket": False, "anchor_id": "t1"}).json()[0]
    items = [PIECES[i["id"]] for i in look["items"]]
    assert main.saved_score(items, "Everyday")["score"] == look["score"]
