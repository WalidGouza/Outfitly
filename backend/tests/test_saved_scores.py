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
    def __init__(self, score=None):
        self.commits = 0
        self.outfits = [SimpleNamespace(id="o1", name="Look", style="Everyday", cloth_ids=["t", "p", "s"], score=score,
                                        breakdown={"semantic": 50, "color": 50, "texture": 50} if score is not None else None,
                                        score_version=main.meaning.SCORE_VERSION if score is not None else None)]
        self.pieces = {p.id: p for p in (
            piece("t", "tops", "#eeeeee"), piece("p", "pants", "#2e3a52", "denim"), piece("s", "shoes", "#7a5235", "leather"),
        )}

    def get(self, model, ident):
        if model is Wardrobe:
            return SimpleNamespace(user_id="owner")
        if model is Cloth:
            return self.pieces.get(ident)

    def scalars(self, query):
        # Answers by table, like a real session: pieces by id, otherwise the outfits.
        if query.column_descriptions[0]["entity"] is Cloth:
            ids = next((v for v in query.compile().params.values() if isinstance(v, (list, tuple, set))), [])
            return iter([self.pieces[i] for i in ids if i in self.pieces])
        return iter(self.outfits)

    def commit(self):
        self.commits += 1


def style_axes(prompts):
    """Each style description points along its own axis, in meaning.STYLE_NAMES order."""
    return [[1.0 if j == i else 0.0 for j in range(512)] for i in range(len(prompts))]


def test_outfits_scored_by_an_older_formula_are_rescored(monkeypatch):
    monkeypatch.setattr(main.embeddings, "texts", style_axes)
    session = Session(score=12)
    session.outfits[0].score_version = 1
    main.app.dependency_overrides[main.db] = lambda: session
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner")
    try:
        look = TestClient(main.app).get("/wardrobes/w/outfits").json()[0]
    finally:
        main.app.dependency_overrides.clear()
    assert look["score"] != 12 and session.outfits[0].score_version == main.meaning.SCORE_VERSION


@pytest.fixture
def client():
    main.app.dependency_overrides[main.db] = lambda: Session()
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner")
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_saved_outfits_carry_their_match_score(client, monkeypatch):
    # The photos look Everyday (axis 0), the tags say Everyday, the outfit is Everyday.
    monkeypatch.setattr(main.embeddings, "texts", style_axes)
    look = client.get("/wardrobes/w/outfits").json()[0]
    assert set(look["breakdown"]) == {"semantic", "color", "texture"}
    assert look["breakdown"]["semantic"] == 100
    assert 0 <= look["score"] <= 100


def test_saved_outfits_still_list_when_ml_is_down(client, monkeypatch):
    def down(value):
        raise EmbeddingUnavailable("down")

    monkeypatch.setattr(main.embeddings, "texts", down)
    look = client.get("/wardrobes/w/outfits").json()[0]
    assert look["id"] == "o1" and "score" not in look


def test_stored_scores_are_used_without_the_ml_service(monkeypatch):
    def down(value):
        raise AssertionError("listing must not call the ML service")

    monkeypatch.setattr(main.embeddings, "texts", down)
    main.app.dependency_overrides[main.db] = lambda: Session(score=77)
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner")
    try:
        look = TestClient(main.app).get("/wardrobes/w/outfits").json()[0]
    finally:
        main.app.dependency_overrides.clear()
    assert look["score"] == 77


def test_old_outfits_are_scored_once_and_kept(monkeypatch):
    calls = []
    monkeypatch.setattr(main.embeddings, "texts", lambda prompts: calls.append(prompts) or style_axes(prompts))
    session = Session()
    main.app.dependency_overrides[main.db] = lambda: session
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner")
    try:
        first = TestClient(main.app).get("/wardrobes/w/outfits").json()[0]
        second = TestClient(main.app).get("/wardrobes/w/outfits").json()[0]
    finally:
        main.app.dependency_overrides.clear()
    assert first["score"] == second["score"] and session.outfits[0].score == first["score"]
    assert len(calls) == 1 and session.commits == 1
