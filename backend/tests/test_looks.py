from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.pool import StaticPool
from app import improve, learning, main
from app.config import settings
from app.models import Base, Cloth, Outfit, SavedLook, SuggestionEvent, User, Wardrobe

RULES = settings().rules


def piece(id, category, color, texture, style, garment):
    return SimpleNamespace(id=id, name=f"{garment} {id}", category=category, color=color, texture=texture,
                           style=style, garment=garment, embedding=None)


OUTFIT = [
    piece("h", "tops", "#191919", "cotton", "Streetwear", "hoodie"),
    piece("j", "pants", "#808080", "cotton", "Streetwear", "joggers"),
    piece("x", "shoes", "#C8232D", "silk", "Evening", "heels"),  # the odd one out
]
SEMANTIC = {c.id: 0.5 * 0.5 + 0.5 * (1 if c.style == "Streetwear" else 0.2) for c in OUTFIT}


def measured():
    fit = improve.virtual_fit("Streetwear", None)
    found = improve.improvements(OUTFIT, "Streetwear", SEMANTIC, RULES, fit)
    outfit = {"cloth_ids": [c.id for c in OUTFIT], "style": "Streetwear", "source": "saved", "name": "Friday"}
    return [(outfit, OUTFIT, SEMANTIC, found)]


def suggested():
    return improve.looks(measured(), lambda spec: 0.5, RULES, lambda style: improve.virtual_fit(style, None))


def test_an_outfit_is_suggested_improved_and_taken_further():
    improved = next(l for l in suggested() if l["kind"] == "improved")
    assert len(improved["pieces"]) == 1 and improved["after"] - improved["before"] == improved["gain"] >= improve.MIN_GAIN
    new = improved["pieces"][0]
    # It keeps every owned piece but the one the new piece replaces.
    assert set(improved["cloth_ids"]) == {"h", "j", "x"} - {new["replaces"]}
    assert improved["name"] == "Friday" and improved["reason"]

    further = next(l for l in suggested() if l["kind"] == "new")
    assert len(further["pieces"]) == 2 and len({p["key"] for p in further["pieces"]}) == 2
    assert further["after"] > improved["after"] - 1  # a second piece only when it helps
    assert all(p["replaces"] != improve.FIRST for p in further["pieces"])
    assert further["key"] == improve.look_key(further["cloth_ids"], further["pieces"])


def test_reactions_to_an_outfit_teach_through_its_new_pieces_gently():
    spec = {"category": "shoes", "garment": "sneakers", "color_name": "White", "texture": "leather", "style": "Streetwear"}
    at = main.datetime.now(main.timezone.utc)
    look = learning.learn([("look_saved", "shoes|sneakers|White", spec, at)])["weights"]["garment"]["sneakers"]
    piece_saved = learning.learn([("saved", "shoes|sneakers|White", spec, at)])["weights"]["garment"]["sneakers"]
    assert 0 < look < piece_saved
    no = learning.learn([("look_dismissed", "shoes|sneakers|White", spec, at)])["weights"]["garment"]["sneakers"]
    assert -learning.learn([("dismissed", "shoes|sneakers|White", spec, at)])["weights"]["garment"]["sneakers"] > -no > 0


# ── Saving, listing and completing, on a real (in-memory) database ───────────
@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    session = DbSession(engine)
    session.add(User(id="u1", email="a@example.com", password_hash="x"))
    session.add(User(id="u2", email="b@example.com", password_hash="x"))
    session.flush()
    session.add_all([Wardrobe(id="w1", user_id="u1", name="Mine"), Wardrobe(id="w2", user_id="u2", name="Theirs")])
    session.flush()
    for c in OUTFIT:
        session.add(Cloth(id=c.id, wardrobe_id="w1", name=c.name, category=c.category, texture=c.texture,
                          style=c.style, color=c.color, garment=c.garment, image=f"{c.id}.jpg", embedding=[0.0] * 512))
    session.commit()
    monkeypatch.setattr(main, "saved_score", lambda items, style: {})
    main.app.dependency_overrides[main.db] = lambda: session
    main.app.dependency_overrides[main.user] = lambda: session.get(User, "u1")
    yield TestClient(main.app), session
    main.app.dependency_overrides.clear()
    session.close()


def payload(look):
    return {"wardrobe_id": "w1", "look": {k: look[k] for k in ("kind", "style", "source", "name", "cloth_ids", "pieces", "before", "after", "reason")}}


def test_a_saved_outfit_is_listed_with_its_pieces_and_saved_once(db):
    client, session = db
    look = next(l for l in suggested() if l["kind"] == "new")
    r = client.post("/me/looks", json=payload(look))
    assert r.status_code == 200, r.text
    assert client.post("/me/looks", json=payload(look)).json()["id"] == r.json()["id"]
    listed = client.get("/me/looks").json()
    assert len(listed) == 1 and listed[0]["key"] == look["key"] and listed[0]["wardrobe"] == "Mine"
    assert [i["id"] for i in listed[0]["items"]] == look["cloth_ids"]
    assert listed[0]["pieces"][0]["title"] == look["pieces"][0]["title"]

    assert client.delete(f"/me/looks/{r.json()['id']}").status_code == 200
    assert client.get("/me/looks").json() == []


def test_saving_checks_the_wardrobe_and_the_pieces(db):
    client, _ = db
    look = next(l for l in suggested() if l["kind"] == "improved")
    assert client.post("/me/looks", json={**payload(look), "wardrobe_id": "w2"}).status_code == 404
    lying = payload(look)
    lying["look"]["pieces"] = [{**lying["look"]["pieces"][0], "key": "shoes|heels|Red"}]
    assert client.post("/me/looks", json=lying).status_code == 422
    missing = payload(look)
    missing["look"]["cloth_ids"] = ["nope", *look["cloth_ids"][1:]]
    assert client.post("/me/looks", json=missing).status_code == 400


def test_adding_the_missing_pieces_turns_the_outfit_into_a_saved_one(db):
    client, session = db
    look = next(l for l in suggested() if l["kind"] == "new")
    client.post("/me/looks", json=payload(look))
    u = session.get(User, "u1")
    added = []
    for i, p in enumerate(look["pieces"]):
        spec = p["spec"]
        c = Cloth(id=f"n{i}", wardrobe_id="w1", name=p["title"], category=spec["category"], texture=spec["texture"],
                  style=spec["style"], color=spec["color"], garment=spec["garment"], image="n.jpg", embedding=[0.0] * 512)
        session.add(c)
        session.commit()
        added.append(main.complete_looks(u, c, session))
    # Not complete after the first piece; complete after the second.
    assert added[0] == [] and len(added[1]) == 1 and added[1][0]["name"] == "Friday"
    o = session.scalar(select(Outfit))
    assert sorted(o.cloth_ids) == sorted([*look["cloth_ids"], "n0", "n1"]) and o.style == "Streetwear"
    assert session.scalar(select(func.count()).select_from(SavedLook)) == 0


def test_outfit_reactions_need_their_outfit_and_count_once_on_the_profile(db):
    client, session = db
    look = next(l for l in suggested() if l["kind"] == "new")
    events = [
        {"action": "look_saved", "key": p["key"], "spec": p["spec"], "source": "next-buys", "wardrobe_id": "w1", "look": look["key"]}
        for p in look["pieces"]
    ]
    assert client.post("/me/suggestion-events", json={"events": [{**events[0], "look": None}]}).status_code == 422
    assert client.post("/me/suggestion-events", json={"events": [{**events[0], "action": "saved"}]}).status_code == 422
    assert client.post("/me/suggestion-events", json={"events": events}).status_code == 200
    assert session.scalar(select(func.count()).select_from(SuggestionEvent)) == 2
    assert main.look_reactions("u1", session) == {look["key"]: "look_saved"}
    monkey_vectors = main.optional_style_vectors
    main.optional_style_vectors = lambda: None
    try:
        feedback = client.get("/me/persona").json()["feedback"]
    finally:
        main.optional_style_vectors = monkey_vectors
    assert feedback["outfits_saved"] == 1 and feedback["saved"] == 0
