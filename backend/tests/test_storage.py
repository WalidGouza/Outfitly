from types import SimpleNamespace
from io import BytesIO
from PIL import Image
import httpx
import pytest
from pydantic import SecretStr
from fastapi.testclient import TestClient
from app.storage import ImageStorage, StorageUnavailable
from app.main import app, db, user
import app.main as api


def config(tmp_path, remote=False):
    return SimpleNamespace(upload_dir=str(tmp_path), image_storage="supabase" if remote else "local",
                           supabase_url="https://project.supabase.co", supabase_service_role_key=SecretStr("private-test-key"),
                           supabase_storage_bucket="wardrobe-images")


def test_local_missing_and_path_traversal(tmp_path):
    store = ImageStorage(config(tmp_path))
    name = store.save(b"jpeg")
    assert store.read(name) == b"jpeg"
    store.delete(name)
    with pytest.raises(FileNotFoundError):
        store.read(name)
    with pytest.raises(FileNotFoundError):
        store.read("../secrets.jpg")


def test_private_remote_roundtrip_survives_new_instance(tmp_path):
    objects = {}
    def request(req):
        assert req.headers["authorization"] == "Bearer private-test-key"
        assert req.headers["apikey"] == "private-test-key"
        name = req.url.path.rsplit("/", 1)[1]
        if req.method == "POST":
            assert req.headers["content-type"] == "image/jpeg"
            objects[name] = req.content
            return httpx.Response(200, json={"Key": name})
        if req.method == "GET":
            assert "/object/authenticated/" in req.url.path
            return httpx.Response(200, content=objects[name])
        objects.pop(name)
        return httpx.Response(200, json={})
    transport = httpx.MockTransport(request)
    store = ImageStorage(config(tmp_path, True), transport)
    name = store.save(b"jpeg")
    assert name.startswith("supabase--")
    assert not list(tmp_path.iterdir())
    fresh = ImageStorage(config(tmp_path, True), transport)
    assert fresh.read(name) == b"jpeg"
    fresh.delete(name)
    assert objects == {}


@pytest.mark.parametrize("status,payload", [(404, {}), (400, {"statusCode": "404"})])
def test_remote_missing_object(tmp_path, status, payload):
    store = ImageStorage(config(tmp_path, True), httpx.MockTransport(lambda r: httpx.Response(status, json=payload)))
    with pytest.raises(FileNotFoundError):
        store.read("supabase--00000000-0000-0000-0000-000000000000.jpg")


def test_remote_error_does_not_expose_response(tmp_path):
    store = ImageStorage(config(tmp_path, True), httpx.MockTransport(lambda r: httpx.Response(403, text="private-test-key")))
    with pytest.raises(StorageUnavailable) as exc:
        store.save(b"jpeg")
    assert "private-test-key" not in str(exc.value)


def test_remote_timeout_is_actionable(tmp_path):
    def timeout(req):
        raise httpx.ReadTimeout("private-test-key", request=req)
    store = ImageStorage(config(tmp_path, True), httpx.MockTransport(timeout))
    with pytest.raises(StorageUnavailable, match="Cannot reach Supabase Storage"):
        store.save(b"jpeg")


def test_storage_requires_backend_credentials(tmp_path):
    settings = config(tmp_path, True)
    settings.supabase_service_role_key = SecretStr("")
    with pytest.raises(ValueError):
        ImageStorage(settings)


@pytest.mark.parametrize("owned", [True, False])
def test_missing_photo_is_404_with_cors_and_checks_ownership(tmp_path, monkeypatch, owned):
    class Session:
        def scalar(self, query):
            return SimpleNamespace(image="00000000-0000-0000-0000-000000000000.jpg") if owned else None
    store = ImageStorage(config(tmp_path))
    reads = []
    def missing(filename):
        reads.append(filename)
        raise FileNotFoundError(filename)
    monkeypatch.setattr(store, "read", missing)
    monkeypatch.setattr(api, "image_storage", store)
    app.dependency_overrides[db] = lambda: Session()
    app.dependency_overrides[user] = lambda: SimpleNamespace(id="owner")
    try:
        response = TestClient(app).get("/images/00000000-0000-0000-0000-000000000000.jpg", headers={"Origin": "http://localhost:5173"})
        assert response.status_code == 404
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert bool(reads) == owned
        assert ("stored file is missing" in response.json()["detail"]) == owned
    finally:
        app.dependency_overrides.clear()


def test_switch_to_supabase_preserves_existing_local_images(tmp_path):
    local = ImageStorage(config(tmp_path))
    name = local.save(b"legacy")
    remote = ImageStorage(config(tmp_path, True))
    assert remote.read(name) == b"legacy"


@pytest.mark.parametrize("failure", ["storage", "database"])
def test_upload_storage_failure_and_database_rollback(tmp_path, monkeypatch, failure):
    state = {"commits": 0, "deleted": [], "rollback": False}
    class Session:
        def get(self, model, ident):
            return SimpleNamespace(user_id="owner")
        def add(self, item):
            pass
        def commit(self):
            state["commits"] += 1
            raise RuntimeError("database failure")
        def rollback(self):
            state["rollback"] = True
    class Store:
        def save(self, jpeg):
            assert jpeg.startswith(b"\xff\xd8")
            if failure == "storage":
                raise StorageUnavailable("Supabase Storage returned HTTP 403; check bucket and backend credentials")
            return "supabase--00000000-0000-0000-0000-000000000000.jpg"
        def delete(self, filename):
            state["deleted"].append(filename)
    monkeypatch.setattr(api, "image_storage", Store())
    monkeypatch.setattr(api, "embed", lambda image: [0.0] * 512)
    app.dependency_overrides[db] = lambda: Session()
    app.dependency_overrides[user] = lambda: SimpleNamespace(id="owner")
    raw = BytesIO()
    Image.new("RGB", (8, 8)).save(raw, format="PNG")
    try:
        response = TestClient(app, raise_server_exceptions=False).post(
            "/wardrobes/test/clothes", headers={"Origin": "http://localhost:5173"},
            data={"name": "Top", "category": "tops", "texture": "cotton", "style": "Everyday", "color": "#ffffff"},
            files={"image": ("top.png", raw.getvalue(), "image/png")})
        if failure == "storage":
            assert response.status_code == 503
            assert "backend credentials" in response.json()["detail"]
            assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
            assert state["commits"] == 0
        else:
            assert response.status_code == 500
            assert state["rollback"]
            assert len(state["deleted"]) == 1
    finally:
        app.dependency_overrides.clear()
