"""Service tests with a stub model; PyTorch is not needed to run them."""
import os
from io import BytesIO
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from app import main
from app.config import Settings

TOKEN = {"Authorization": "Bearer " + os.environ["ML_SERVICE_TOKEN"]}


@pytest.fixture
def client(monkeypatch):
    seen = []
    monkeypatch.setattr(main.clip, "embed", lambda value: seen.append(value) or [0.5] * 512)
    with TestClient(main.app) as c:
        c.seen = seen
        yield c


def jpeg():
    raw = BytesIO()
    Image.new("RGB", (8, 8), "red").save(raw, format="JPEG")
    return raw.getvalue()


def test_requires_service_token(client):
    assert client.post("/embed/text", json={"text": "x"}).status_code == 401
    bad = {"Authorization": "Bearer wrong-token"}
    assert client.post("/embed/image", content=jpeg(), headers=bad).status_code == 401
    assert client.seen == []


def test_embeds_images_and_text(client):
    r = client.post("/embed/image", content=jpeg(), headers={**TOKEN, "Content-Type": "image/jpeg"})
    assert r.status_code == 200 and len(r.json()["embedding"]) == 512
    assert isinstance(client.seen[0], Image.Image)
    r = client.post("/embed/text", json={"text": "A Minimal fashion outfit"}, headers=TOKEN)
    assert r.status_code == 200 and client.seen[1] == "A Minimal fashion outfit"


def test_rejects_invalid_and_oversized_images(client):
    assert client.post("/embed/image", content=b"not an image", headers=TOKEN).status_code == 400
    big = b"\0" * (10 * 1024 * 1024 + 1)
    assert client.post("/embed/image", content=big, headers=TOKEN).status_code == 413


def test_prod_hides_api_docs(client):
    for path in ["/docs", "/redoc", "/openapi.json"]:
        assert client.get(path).status_code == 404
    assert client.get("/live").json() == {"status": "ok", "service": "outfitly-ml", "environment": "prod"}


@pytest.mark.parametrize("raw, expected", [("prod", "prod"), (" PROD ", "prod"), ('"dev"', "dev"), ("Dev", "dev")])
def test_app_env_is_normalized(raw, expected):
    assert Settings(_env_file=None, app_env=raw).app_env == expected


@pytest.mark.parametrize("raw", ["production", "", "staging"])
def test_unknown_app_env_is_rejected(raw):
    with pytest.raises(ValueError):
        Settings(_env_file=None, app_env=raw)


def test_weak_token_is_rejected():
    with pytest.raises(ValueError):
        Settings(_env_file=None, app_env="prod", ml_service_token="short")
