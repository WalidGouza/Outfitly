from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app import main
from app.models import Cloth, Outfit, SavedLook, Wardrobe
from app.storage import StorageUnavailable


class Session:
    def __init__(self, pieces, outfits):
        self.pieces = pieces
        self.outfits = outfits
        self.deleted = []
        self.committed = False

    def get(self, model, ident):
        if model is Wardrobe:
            return SimpleNamespace(user_id="owner" if ident == "mine" else "someone-else")
        if model is Cloth:
            return self.pieces.get(ident)

    def scalars(self, query):
        # Answers by table, like a real session: pieces by id, no saved suggested outfits,
        # otherwise the outfits.
        if query.column_descriptions[0]["entity"] is SavedLook:
            return iter([])
        if query.column_descriptions[0]["entity"] is Cloth:
            ids = next((v for v in query.compile().params.values() if isinstance(v, (list, tuple, set))), [])
            return iter([self.pieces[i] for i in ids if i in self.pieces])
        return iter(self.outfits)

    def delete(self, item):
        self.deleted.append(item)

    def commit(self):
        self.committed = True


class Store:
    def __init__(self, fail=False):
        self.fail = fail
        self.deleted = []

    def delete(self, filename):
        if self.fail:
            raise StorageUnavailable("down")
        self.deleted.append(filename)


@pytest.fixture
def setup(monkeypatch):
    piece = SimpleNamespace(id="p1", wardrobe_id="mine", image="photo.jpg")
    with_piece = SimpleNamespace(id="o1", cloth_ids=["p1", "p2", "p3"])
    without = SimpleNamespace(id="o2", cloth_ids=["p2", "p3", "p4"])
    session = Session({"p1": piece}, [with_piece, without])
    store = Store()
    monkeypatch.setattr(main, "image_storage", store)
    main.app.dependency_overrides[main.db] = lambda: session
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner")
    yield TestClient(main.app), session, store, piece, with_piece
    main.app.dependency_overrides.clear()


def test_removes_piece_its_outfits_and_photo(setup):
    client, session, store, piece, with_piece = setup
    r = client.delete("/wardrobes/mine/clothes/p1")
    assert r.status_code == 200 and r.json() == {"ok": True, "removed_outfits": 1, "removed_looks": 0}
    assert session.deleted == [with_piece, piece] and session.committed
    assert store.deleted == ["photo.jpg"]


def test_storage_failure_does_not_fail_removal(setup, monkeypatch):
    client, session, _, _, _ = setup
    monkeypatch.setattr(main, "image_storage", Store(fail=True))
    assert client.delete("/wardrobes/mine/clothes/p1").status_code == 200
    assert session.committed


@pytest.mark.parametrize("path", ["/wardrobes/mine/clothes/missing", "/wardrobes/theirs/clothes/p1"])
def test_unknown_or_foreign_piece_is_not_found(setup, path):
    client, session, store, _, _ = setup
    assert client.delete(path).status_code == 404
    assert session.deleted == [] and store.deleted == []


def test_piece_from_another_wardrobe_is_not_found(setup):
    client, session, _, piece, _ = setup
    piece.wardrobe_id = "other"
    assert client.delete("/wardrobes/mine/clothes/p1").status_code == 404
    assert not session.committed


def test_saved_outfits_skip_missing_pieces(setup):
    client, session, _, _, _ = setup
    session.pieces.update({k: SimpleNamespace(id=k, name=k, category="tops", texture="cotton",
                                              style="Everyday", color="#ffffff", image=f"{k}.jpg")
                           for k in ("p2", "p3", "p4")})
    del session.pieces["p1"]
    session.outfits = [SimpleNamespace(id="o1", name="A", style="Everyday", cloth_ids=["p1", "p2", "p3"]),
                       SimpleNamespace(id="o2", name="B", style="Everyday", cloth_ids=["p2", "p3", "p4"])]
    assert [o["id"] for o in client.get("/wardrobes/mine/outfits").json()] == ["o2"]
