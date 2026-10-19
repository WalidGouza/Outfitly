"""Real PostgreSQL API tests. Uses a dedicated *_test database only."""

import os
from urllib.parse import urlparse
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

url = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not url, reason="Set TEST_DATABASE_URL to run PostgreSQL integration tests"
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    if not url:
        pytest.skip("No test database configured")
    if not urlparse(url).path.endswith("_test"):
        pytest.fail("Integration DB name must end in _test")
    from app import main
    from app.models import Base

    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "uploads", tmp_path)
    monkeypatch.setattr(main.image_storage, "local", tmp_path)

    def fake_embed(value):
        return [1.0] + [0.0] * 511

    monkeypatch.setattr(main.embeddings, "image", fake_embed)
    monkeypatch.setattr(main.embeddings, "text", fake_embed)
    # Meaning compares photos with the five style descriptions (meaning.PROMPTS).
    monkeypatch.setattr(main.embeddings, "texts", lambda values: [fake_embed(v) for v in values])
    with TestClient(main.app) as c:
        yield c
    Base.metadata.drop_all(engine)
    engine.dispose()


def auth(client, email):
    r = client.post(
        "/auth/register", json={"email": email, "password": "a-safe-test-password"}
    )
    assert r.status_code == 200
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_wardrobe_upload_generate_save_and_isolation(client):
    from PIL import Image
    from io import BytesIO

    alice = auth(client, "alice@example.com")
    bob = auth(client, "bob@example.com")
    wid = client.post("/wardrobes", headers=alice, json={"name": "Everyday"}).json()[
        "id"
    ]
    other = client.post("/wardrobes", headers=alice, json={"name": "Travel"}).json()[
        "id"
    ]
    assert client.get(f"/wardrobes/{wid}/clothes", headers=bob).status_code == 404
    assert client.get(f"/wardrobes/{other}/clothes", headers=alice).json() == []
    ids = []
    for category in ("tops", "pants", "shoes", "jackets"):
        raw = BytesIO()
        Image.new("RGB", (32, 32), "blue").save(raw, format="PNG")
        r = client.post(
            f"/wardrobes/{wid}/clothes",
            headers=alice,
            data={
                "name": category,
                "category": category,
                "texture": "cotton",
                "style": "Everyday",
                "color": "#436c8b",
            },
            files={"image": ("piece.png", raw.getvalue(), "image/png")},
        )
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
        filename = r.json()["image"]
        assert client.get(f"/images/{filename}", headers=bob).status_code == 404
        assert client.get(f"/images/{filename}", headers=alice).status_code == 200
    r = client.post(
        f"/wardrobes/{wid}/generate",
        headers=alice,
        json={"style": "Everyday", "include_jacket": True, "anchor_id": ids[0]},
    )
    assert r.status_code == 200, r.text
    look = r.json()[0]
    assert len(look["items"]) == 4
    body = {
        "name": "Monday",
        "style": "Everyday",
        "cloth_ids": [c["id"] for c in look["items"]],
    }
    assert (
        client.post(f"/wardrobes/{other}/outfits", headers=alice, json=body).status_code
        == 400
    )
    oid = client.post(f"/wardrobes/{wid}/outfits", headers=alice, json=body).json()[
        "id"
    ]
    assert len(client.get(f"/wardrobes/{wid}/outfits", headers=alice).json()) == 1
    assert (
        client.delete(f"/wardrobes/{wid}/outfits/{oid}", headers=bob).status_code == 404
    )
    assert (
        client.delete(f"/wardrobes/{wid}/outfits/{oid}", headers=alice).status_code
        == 200
    )
    client.post(f"/wardrobes/{wid}/outfits", headers=alice, json=body)
    removed = look["items"][1]
    assert (
        client.delete(f"/wardrobes/{wid}/clothes/{removed['id']}", headers=bob).status_code
        == 404
    )
    r = client.delete(f"/wardrobes/{wid}/clothes/{removed['id']}", headers=alice)
    assert r.status_code == 200 and r.json()["removed_outfits"] == 1
    assert client.get(f"/wardrobes/{wid}/outfits", headers=alice).json() == []
    assert removed["id"] not in [c["id"] for c in client.get(f"/wardrobes/{wid}/clothes", headers=alice).json()]
    assert client.get(f"/images/{removed['image']}", headers=alice).status_code == 404


def test_invalid_upload_and_incomplete_wardrobe(client):
    headers = auth(client, "fresh@example.com")
    wid = client.post("/wardrobes", headers=headers, json={"name": "Empty"}).json()[
        "id"
    ]
    assert (
        client.post(f"/wardrobes/{wid}/generate", headers=headers, json={}).status_code
        == 400
    )
    r = client.post(
        f"/wardrobes/{wid}/clothes",
        headers=headers,
        data={
            "name": "Invalid",
            "category": "tops",
            "texture": "cotton",
            "style": "Everyday",
            "color": "#123456",
        },
        files={"image": ("piece.png", b"not an image", "image/png")},
    )
    assert r.status_code == 400


def test_startup_takes_every_privilege_away_from_the_supabase_data_api_roles(client):
    # Supabase has anon/authenticated roles holding all privileges on new tables; plain
    # PostgreSQL doesn't, so create them here as Supabase would, then restart the app.
    from app import main

    with main.engine.begin() as conn:
        for role in ("anon", "authenticated"):
            conn.execute(text(f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$"))
            conn.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {role}"))
    with TestClient(main.app):
        pass
    with main.engine.connect() as conn:
        grants = conn.execute(text(
            "SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants "
            "WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')"
        )).all()
        rls = conn.scalars(text(
            "SELECT relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'"
        )).all()
    assert grants == []
    assert rls and all(rls)


def test_persona_suggestions_and_feedback_events(client):
    from PIL import Image
    from io import BytesIO

    alice = auth(client, "persona@example.com")
    bob = auth(client, "other@example.com")
    wid = client.post("/wardrobes", headers=alice, json={"name": "Street"}).json()["id"]
    ids = []
    for category, garment, color, texture, style in (
        ("tops", "hoodie", "#191919", "cotton", "Streetwear"),
        ("pants", "joggers", "#808080", "cotton", "Streetwear"),
        ("shoes", "heels", "#C8232D", "silk", "Evening"),
    ):
        raw = BytesIO()
        Image.new("RGB", (32, 32), color).save(raw, format="PNG")
        r = client.post(
            f"/wardrobes/{wid}/clothes", headers=alice,
            data={"name": garment, "category": category, "garment": garment, "texture": texture, "style": style, "color": color},
            files={"image": ("piece.png", raw.getvalue(), "image/png")},
        )
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
    client.post(f"/wardrobes/{wid}/outfits", headers=alice, json={"name": "Mine", "style": "Streetwear", "cloth_ids": ids})

    p = client.get("/me/persona", headers=alice).json()
    assert p["based_on"] == {"pieces": 3, "outfits": 1} and "fingerprint" not in p
    assert p["styles"][0]["name"] == "Streetwear"

    listed = client.get(f"/wardrobes/{wid}/suggestions", headers=alice)
    assert listed.status_code == 200, listed.text
    assert listed.json()["suggestions"], "the odd pair of heels should leave room to improve"
    assert client.get(f"/wardrobes/{wid}/suggestions", headers=bob).status_code == 404

    r = client.post(f"/wardrobes/{wid}/improve", headers=alice, json={"cloth_ids": ids, "style": "Streetwear"})
    assert r.status_code == 200, r.text
    best = r.json()["suggestions"][0]
    assert best["gain"] >= 2 and best["outfits"] >= 1

    event = {"action": "dismissed", "key": best["key"], "spec": best["spec"], "source": "outfit", "wardrobe_id": wid}
    assert client.post("/me/suggestion-events", headers=bob, json={"events": [event]}).status_code == 404
    assert client.post("/me/suggestion-events", headers=alice, json={"events": [event]}).status_code == 200
    again = client.post(f"/wardrobes/{wid}/improve", headers=alice, json={"cloth_ids": ids, "style": "Streetwear"}).json()
    assert best["key"] not in [s["key"] for s in again["suggestions"]]
    learned = client.get("/me/persona", headers=alice).json()
    assert learned["feedback"]["dismissed"] == 1
    assert learned["learned"]["signals"] == 1 and learned["learned"]["dislikes"] == []  # one reaction: not a taste yet

    assert client.delete("/me/suggestion-events", headers=alice).json()["removed"] == 1
    assert client.get("/me/persona", headers=alice).json()["feedback"]["dismissed"] == 0
    assert listed.json()["considered"] >= 1 and listed.json()["complete"] is True

    # Exploration cards: pieces to learn taste from, none of them already suggested; once the user
    # has reacted to one, it isn't asked about again.
    assert all(look["pieces"] and look["after"] > look["before"] for look in listed.json()["looks"])
    explored = listed.json()["explore"]
    assert explored and all(x["explore"] for x in explored)
    assert not {x["key"] for x in explored} & {x["key"] for x in listed.json()["suggestions"]}
    probe = explored[0]
    saved = {"action": "saved", "key": probe["key"], "spec": probe["spec"], "source": "next-buys", "wardrobe_id": wid, "explore": True}
    assert client.post("/me/suggestion-events", headers=alice, json={"events": [saved]}).status_code == 200
    after = client.get(f"/wardrobes/{wid}/suggestions", headers=alice).json()
    assert probe["key"] not in [x["key"] for x in after["explore"]]
    assert client.get("/me/persona", headers=alice).json()["feedback"]["saved"] == 1
    assert client.delete("/me/suggestion-events", headers=alice).json()["removed"] == 1

    # Saved list: saving adds it, unsaving or "I own this" takes it off; owned pieces aren't suggested.
    def send(action):
        r = client.post("/me/suggestion-events", headers=alice, json={"events": [{**event, "action": action}]})
        assert r.status_code == 200, r.text

    send("saved")
    wishlist = client.get("/me/wishlist", headers=alice).json()
    assert [w["key"] for w in wishlist] == [best["key"]] and wishlist[0]["title"] == best["title"]
    send("unsaved")
    assert client.get("/me/wishlist", headers=alice).json() == []
    send("saved")
    send("owned")
    assert client.get("/me/wishlist", headers=alice).json() == []
    again = client.post(f"/wardrobes/{wid}/improve", headers=alice, json={"cloth_ids": ids, "style": "Streetwear"}).json()
    assert best["key"] not in [s["key"] for s in again["suggestions"]]
    r = client.request("DELETE", "/me", headers=alice, json={"password": "a-safe-test-password"})
    assert r.status_code == 200, r.text
