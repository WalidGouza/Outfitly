from io import BytesIO
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app import improve, main
from app.models import Base, Suggestion, User, Wardrobe


@pytest.fixture
def api(monkeypatch, tmp_path):
    """The real API on a throwaway SQLite database, signed in, with one wardrobe."""
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)

    def db():
        with Session(engine) as s:
            yield s

    main.app.dependency_overrides[main.db] = db
    monkeypatch.setattr(main.image_storage, "local", tmp_path)
    monkeypatch.setattr(main.image_storage, "remote", False)
    monkeypatch.setattr(main.embeddings, "image", lambda jpeg: [1.0] + [0.0] * 511)
    monkeypatch.setattr(main.embeddings, "texts", lambda values: [[1.0] + [0.0] * 511 for _ in values])
    client = TestClient(main.app)
    t = client.post("/auth/register", json={"email": "walid@example.com", "password": "a-safe-test-password"}).json()
    me = {"Authorization": "Bearer " + t["token"]}
    wid = client.post("/wardrobes", headers=me, json={"name": "Mine"}).json()["id"]
    yield client, engine, me, wid
    main.app.dependency_overrides.clear()


def png():
    out = BytesIO()
    Image.new("RGB", (32, 32), "blue").save(out, format="PNG")
    return out.getvalue()


def add(client, me, wid, name="Tee", category="tops", garment="t-shirt", color="#111111"):
    return client.post(f"/wardrobes/{wid}/clothes", headers=me,
                       data={"name": name, "category": category, "garment": garment, "texture": "cotton", "style": "Everyday", "color": color},
                       files={"image": ("p.png", png(), "image/png")})


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_impossible_coordinates_are_refused_not_crashing(api, value):
    client, _, me, wid = api
    body = f'{{"latitude": {value}, "longitude": 2, "pieces": []}}'
    for path, headers in (("/today/sample", {}), (f"/wardrobes/{wid}/today", me)):
        r = client.post(path, content=body, headers={**headers, "Content-Type": "application/json"})
        assert r.status_code == 422, (path, r.status_code, r.text)


@pytest.mark.parametrize("bad", ["Work\x00wear", "Line\nbreak", "Tab\there", "Bell\x07"])
def test_control_characters_in_names_get_a_clear_answer(api, bad):
    client, _, me, wid = api
    assert client.post("/wardrobes", headers=me, json={"name": bad}).status_code == 422
    assert add(client, me, wid, name=bad).status_code == 422


def test_control_characters_in_outfit_names_and_emails(api):
    client, _, me, wid = api
    ids = [add(client, me, wid, *p).json()["id"] for p in (("Tee", "tops", "t-shirt"), ("Jeans", "pants", "jeans"), ("Kicks", "shoes", "sneakers"))]
    r = client.post(f"/wardrobes/{wid}/outfits", headers=me, json={"name": "Mon\x00day", "style": "Everyday", "cloth_ids": ids})
    assert r.status_code == 422
    assert client.post("/auth/register", json={"email": "a\x00b@example.com", "password": "a-safe-test-password"}).status_code == 422


def test_everyday_names_in_any_language_still_work(api):
    client, _, me, wid = api
    for name in ("Été 🌞", "Gardérobe d'hiver", "冬のワードローブ", "Ma garde-robe (2)"):
        assert client.post("/wardrobes", headers=me, json={"name": name}).status_code == 200, name
    assert add(client, me, wid, name="T-shirt blanc — coton").status_code == 200


def test_two_recomputations_at_once_neither_fails_nor_duplicates(api, monkeypatch):
    """Next buys and an outfit's details find the list out of date at the same time: while one
    request recomputes, the other finishes first and replaces the rows it had loaded."""
    client, engine, me, wid = api
    for p in (("Tee", "tops", "t-shirt"), ("Jeans", "pants", "jeans"), ("Heels", "shoes", "heels", "#C8232D")):
        add(client, me, wid, *p)
    real_group = improve.group
    raced = {"done": False}

    def group_while_another_request_finishes(*args, **kwargs):
        if not raced["done"]:
            raced["done"] = True
            with Session(engine) as other:  # the other request, start to finish
                u = other.scalar(select(User))
                main.suggestion_context(other.get(Wardrobe, wid), u, other)
        return real_group(*args, **kwargs)

    monkeypatch.setattr(improve, "group", group_while_another_request_finishes)
    r = client.get(f"/wardrobes/{wid}/suggestions", headers=me)
    assert r.status_code == 200, r.text
    assert raced["done"]
    with Session(engine) as s:
        rows = list(s.scalars(select(Suggestion).where(Suggestion.wardrobe_id == wid)))
        reach_rows = [x for x in rows if x.key == improve.REACH_KEY]
        assert len(reach_rows) == 1 and len({x.rank for x in rows}) == len(rows)  # one set, no duplicates


def test_impossible_coordinates_get_a_plain_message_in_production(api, monkeypatch):
    client, *_ = api
    monkeypatch.setattr(main.s, "app_env", "prod")
    r = client.post("/today/sample", content='{"latitude": NaN, "longitude": 2, "pieces": []}', headers={"Content-Type": "application/json"})
    assert r.status_code == 422 and r.json()["detail"] == "We couldn’t read your location. Please try again."


def test_outfits_are_saved_with_a_real_style_only(api):
    client, _, me, wid = api
    ids = [add(client, me, wid, *p).json()["id"] for p in (("Tee", "tops", "t-shirt"), ("Jeans", "pants", "jeans"), ("Kicks", "shoes", "sneakers"))]
    assert client.post(f"/wardrobes/{wid}/outfits", headers=me, json={"name": "x", "style": "Gothic", "cloth_ids": ids}).status_code == 422
    assert client.post(f"/wardrobes/{wid}/outfits", headers=me, json={"name": "x", "style": "Streetwear", "cloth_ids": ids}).status_code == 200


def test_listing_saved_outfits_takes_the_same_queries_for_one_or_many(api):
    client, engine, me, wid = api
    tops = [add(client, me, wid, f"Tee {i}", "tops", "t-shirt").json()["id"] for i in range(3)]
    jeans = add(client, me, wid, "Jeans", "pants", "jeans").json()["id"]
    kicks = add(client, me, wid, "Kicks", "shoes", "sneakers").json()["id"]
    queries = []
    event.listen(engine, "before_cursor_execute", lambda conn, cursor, statement, *a: queries.append(statement))

    def listing_queries():
        client.get(f"/wardrobes/{wid}/outfits", headers=me)  # first listing may store scores
        queries.clear()
        looks = client.get(f"/wardrobes/{wid}/outfits", headers=me).json()
        return len(looks), sum(q.lstrip().upper().startswith("SELECT") for q in queries)

    client.post(f"/wardrobes/{wid}/outfits", headers=me, json={"name": "a", "style": "Everyday", "cloth_ids": [tops[0], jeans, kicks]})
    one = listing_queries()
    for t in tops[1:]:
        client.post(f"/wardrobes/{wid}/outfits", headers=me, json={"name": "b", "style": "Everyday", "cloth_ids": [t, jeans, kicks]})
    three = listing_queries()
    assert one[0] == 1 and three[0] == 3
    assert three[1] == one[1]  # the pieces of every outfit come in one query
