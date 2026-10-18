from io import BytesIO
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from app import main
from app.models import Cloth, Outfit, Wardrobe


class Session:
    """In-memory stand-in: one user with one wardrobe, two pieces and a saved outfit."""

    def __init__(self, u):
        self.u = u
        self.wardrobes = [SimpleNamespace(id="w1", user_id=u.id)]
        self.clothes = [SimpleNamespace(id="c1", wardrobe_id="w1", image="a.jpg"), SimpleNamespace(id="c2", wardrobe_id="w1", image="b.jpg")]
        self.outfits = [SimpleNamespace(id="o1", wardrobe_id="w1")]
        self.deleted, self.commits, self.rolled_back = [], 0, False

    def scalars(self, stmt):
        model = stmt.column_descriptions[0]["entity"]
        return iter({Wardrobe: self.wardrobes, Cloth: self.clothes, Outfit: self.outfits}.get(model, []))

    def delete(self, item):
        self.deleted.append(item)

    def flush(self):
        pass

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rolled_back = True


class Store:
    def __init__(self):
        self.saved, self.removed = [], []

    def save(self, jpeg):
        self.saved.append(jpeg)
        return f"{len(self.saved):08d}-0000-0000-0000-000000000000.jpg"

    def read(self, filename):
        return b"jpeg"

    def delete(self, filename):
        self.removed.append(filename)


@pytest.fixture
def account(monkeypatch):
    u = SimpleNamespace(id="u1", email="walid@example.com", username=None, avatar=None,
                        password_hash=main.passwords.hash("correct horse battery"))
    session, store = Session(u), Store()
    monkeypatch.setattr(main, "image_storage", store)
    main.app.dependency_overrides[main.db] = lambda: session
    main.app.dependency_overrides[main.user] = lambda: u
    yield TestClient(main.app), u, session, store
    main.app.dependency_overrides.clear()


def test_profile_starts_with_email_only(account):
    client, *_ = account
    assert client.get("/me").json() == {"email": "walid@example.com", "username": None, "avatar": False, "wear": None, "styles": None, "seen": []}


def test_styles_picked_at_first_sign_in_are_saved_once_each(account):
    client, u, *_ = account
    u.wear, u.styles = None, None  # never asked: the app shows the style picker
    r = client.patch("/me", json={"styles": ["Streetwear", "Minimal", "Streetwear"]})
    assert r.status_code == 200 and r.json()["styles"] == ["Streetwear", "Minimal"]
    assert client.patch("/me", json={"styles": []}).json()["styles"] == []  # skipped: not asked again
    assert client.patch("/me", json={"styles": ["Gothic"]}).status_code == 422


def test_a_new_feature_is_announced_once_per_account(account):
    client, u, *_ = account
    u.seen = None
    assert client.get("/me").json()["seen"] == []
    assert client.patch("/me", json={"seen": ["next-buys"]}).json()["seen"] == ["next-buys"]
    assert client.patch("/me", json={"seen": ["next-buys"]}).json()["seen"] == ["next-buys"]  # once
    assert client.patch("/me", json={"seen": ["anything"]}).status_code == 422


def test_username_is_trimmed_and_validated(account):
    client, u, session, _ = account
    assert client.patch("/me", json={"username": "  Walid   G "}).json()["username"] == "Walid G"
    assert u.username == "Walid G" and session.commits == 1
    assert client.patch("/me", json={"username": "<script>"}).status_code == 422
    assert client.patch("/me", json={"username": "x"}).status_code == 422


def test_password_change_needs_the_current_password(account):
    client, u, _, _ = account
    signed_in = {"Authorization": "Bearer " + main.token(u)["token"]}
    def change(current, new):
        return client.post("/me/password", headers=signed_in, json={"current_password": current, "new_password": new})
    assert change("wrong", "a-new-long-password").status_code == 403
    assert change("correct horse battery", "short").status_code == 422
    assert change("correct horse battery", "a-new-long-password").status_code == 200
    assert main.passwords.verify("a-new-long-password", u.password_hash)


def test_remember_me_keeps_the_sign_in_for_30_days_instead_of_12_hours():
    import jwt
    from datetime import datetime, timezone
    u = SimpleNamespace(id="u1", session_version=0)
    def hours_left(t):
        exp = jwt.decode(t["token"], main.s.jwt_secret, algorithms=["HS256"])["exp"]
        return (exp - datetime.now(timezone.utc).timestamp()) / 3600
    assert 11.9 < hours_left(main.token(u)) <= 12
    remembered = main.token(u, remember=True)
    assert remembered["remember"] is True and 30 * 24 - 0.1 < hours_left(remembered) <= 30 * 24


def test_changing_the_password_signs_out_every_other_device(monkeypatch):
    # Real token checks: no user override, so the session_version claim is what decides.
    u = SimpleNamespace(id="u1", email="walid@example.com", username=None, avatar=None, session_version=0,
                        password_hash=main.passwords.hash("correct horse battery"))
    session = Session(u)
    session.get = lambda model, ident: u if ident == "u1" else None
    main.app.dependency_overrides[main.db] = lambda: session
    try:
        client = TestClient(main.app)
        phone = {"Authorization": "Bearer " + main.token(u, remember=True)["token"]}
        laptop = {"Authorization": "Bearer " + main.token(u, remember=True)["token"]}
        assert client.get("/me", headers=phone).status_code == 200
        r = client.post("/me/password", headers=laptop, json={"current_password": "correct horse battery", "new_password": "a-new-long-password"})
        assert r.status_code == 200 and r.json()["remember"] is True  # same choice, renewed
        assert client.get("/me", headers=phone).status_code == 401  # the other device is signed out
        assert client.get("/me", headers=laptop).status_code == 401  # and so is the old token here...
        assert client.get("/me", headers={"Authorization": "Bearer " + r.json()["token"]}).status_code == 200  # ...replaced by this one
    finally:
        main.app.dependency_overrides.clear()


def test_photo_is_cropped_square_and_replaces_the_old_one(account):
    client, u, _, store = account
    raw = BytesIO()
    Image.new("RGB", (900, 400), "navy").save(raw, format="PNG")
    first = client.put("/me/avatar", files={"image": ("me.png", raw.getvalue(), "image/png")})
    assert first.status_code == 200 and first.json()["avatar"] is True
    assert Image.open(BytesIO(store.saved[0])).size == (512, 512)
    old = u.avatar
    client.put("/me/avatar", files={"image": ("me.png", raw.getvalue(), "image/png")})
    assert store.removed == [old] and u.avatar != old
    assert client.get("/me/avatar").status_code == 200
    assert client.delete("/me/avatar").json()["avatar"] is False


def test_deleting_the_account_needs_the_password_and_removes_everything(account):
    client, u, session, store = account
    assert client.request("DELETE", "/me", json={"password": "wrong"}).status_code == 403
    assert not session.deleted
    u.avatar = "avatar.jpg"
    r = client.request("DELETE", "/me", json={"password": "correct horse battery"})
    assert r.status_code == 200 and r.json()["removed_photos"] == 3
    assert u in session.deleted and len(session.deleted) == 5  # outfit, 2 pieces, wardrobe, user
    assert sorted(store.removed) == ["a.jpg", "avatar.jpg", "b.jpg"]


def test_deleting_an_account_respects_foreign_keys_on_a_real_database(monkeypatch):
    # The fake session above can't see delete order. On a real database the ORM, which has no
    # relationships to go by, deleted the user before its wardrobes and the foreign key refused it.
    from sqlalchemy import create_engine, event, func, select
    from sqlalchemy.orm import Session as DbSession
    from app.models import Base, Suggestion, SuggestionEvent, User

    from sqlalchemy.pool import StaticPool

    # One in-memory database shared with the thread FastAPI runs the endpoint in.
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    with DbSession(engine) as s:
        s.add(User(id="u1", email="walid@example.com", password_hash=main.passwords.hash("correct horse battery")))
        s.flush()
        s.add(Wardrobe(id="w1", user_id="u1", name="Mine"))
        s.flush()
        s.add_all([
            Cloth(id="c1", wardrobe_id="w1", name="Tee", category="tops", texture="cotton", style="Everyday",
                  color="#000000", image="a.jpg", embedding=[0.0] * 512),
            Outfit(id="o1", wardrobe_id="w1", name="Mon", style="Everyday", cloth_ids=["c1"]),
            Suggestion(wardrobe_id="w1", fingerprint="f", rank=0, key="k", value=1, data={}),
            SuggestionEvent(user_id="u1", action="saved", key="k", spec={}, context={}),
        ])
        s.commit()

    session = DbSession(engine)
    store = Store()
    monkeypatch.setattr(main, "image_storage", store)
    main.app.dependency_overrides[main.db] = lambda: session
    main.app.dependency_overrides[main.user] = lambda: session.get(User, "u1")
    try:
        r = TestClient(main.app).request("DELETE", "/me", json={"password": "correct horse battery"})
        assert r.status_code == 200, r.text
        assert store.removed == ["a.jpg"]
        for model in (User, Wardrobe, Cloth, Outfit, Suggestion, SuggestionEvent):
            assert session.scalar(select(func.count()).select_from(model)) == 0, model.__name__
    finally:
        main.app.dependency_overrides.clear()
        session.close()
