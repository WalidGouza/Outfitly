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
