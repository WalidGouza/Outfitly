from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from app import main
from app.embeddings import EmbeddingUnavailable
from app.models import Wardrobe
from app.storage import StorageUnavailable

# Words that must never reach a user in production.
TECHNICAL = ["DATABASE_URL", "Supabase", "backend", "HTTP", "ML service", "FastAPI", "credentials", "bucket", "Error:", "Exception", "loc"]


def technical(detail):
    return [w for w in TECHNICAL if w.lower() in str(detail).lower()]


@pytest.fixture(params=["dev", "prod"])
def mode(request, monkeypatch):
    monkeypatch.setattr(main.s, "app_env", request.param)
    # The app runs with debug on in dev (traceback pages) and off in prod, as api_options sets it.
    monkeypatch.setattr(main.app, "debug", request.param == "dev")
    monkeypatch.setattr(main.app, "middleware_stack", None)  # rebuilt with that debug flag
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="owner", wear=None)
    yield request.param
    main.app.dependency_overrides.clear()
    main.app.middleware_stack = None


def broken_session(error):
    class Session:
        def get(self, model, ident):
            if model is Wardrobe:
                return SimpleNamespace(user_id="owner")
            raise error

        def scalars(self, stmt):
            raise error

    return lambda: Session()


def call(path="/wardrobes/w/clothes", method="GET", **kw):
    return TestClient(main.app, raise_server_exceptions=False).request(method, path, **kw)


def check(mode, response, dev_hint):
    detail = response.json()["detail"]
    if mode == "dev":
        assert dev_hint.lower() in str(detail).lower(), detail
    else:
        assert not technical(detail), detail
        assert "try again" in detail.lower()


def test_database_errors(mode):
    main.app.dependency_overrides[main.db] = broken_session(OperationalError("SELECT", {}, Exception("connection refused")))
    r = call()
    assert r.status_code == 503
    check(mode, r, "DATABASE_URL")


def test_storage_errors(mode):
    main.app.dependency_overrides[main.db] = broken_session(StorageUnavailable("Supabase Storage returned HTTP 403; check bucket and backend credentials"))
    r = call()
    assert r.status_code == 503
    check(mode, r, "Supabase Storage")


def test_ml_errors(mode):
    main.app.dependency_overrides[main.db] = broken_session(EmbeddingUnavailable("Image analysis service returned HTTP 502"))
    r = call()
    assert r.status_code == 503
    check(mode, r, "HTTP 502")


def test_unexpected_errors(mode):
    main.app.dependency_overrides[main.db] = broken_session(KeyError("boom"))
    r = call()
    assert r.status_code == 500
    if mode == "dev":
        # Starlette's traceback page, for whoever is debugging the API directly.
        assert "KeyError" in r.text
    else:
        assert not technical(r.json()["detail"]) and "try again" in r.json()["detail"].lower()


def test_validation_errors_name_the_field_in_plain_words(mode):
    r = call("/auth/register", "POST", json={"email": "walid@example.com", "password": "short"})
    assert r.status_code == 422
    detail = r.json()["detail"]
    if mode == "dev":
        assert isinstance(detail, list) and detail[0]["loc"][-1] == "password"
    else:
        assert detail == "Passwords are 10 to 128 characters."


def test_friendly_messages_are_kept_as_they_are(mode, monkeypatch):
    # Messages written for users (wrong password, session expired...) are the same in both modes.
    main.app.dependency_overrides.pop(main.user)
    r = call("/wardrobes", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401 and r.json()["detail"] == "Session expired. Please sign in again."
