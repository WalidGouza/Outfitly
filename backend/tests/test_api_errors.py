from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from app.main import app, db


def test_localhost_alias_preflight_and_unknown_origin_rejection():
    client = TestClient(app)
    allowed = client.options(
        "/auth/register",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    rejected = client.options(
        "/auth/register",
        headers={
            "Origin": "https://unknown.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers


def test_database_failure_is_json_and_keeps_cors_headers():
    class BrokenSession:
        def scalar(self, *args):
            raise OperationalError("SELECT", {}, RuntimeError("unavailable"))

    def broken_db():
        yield BrokenSession()

    app.dependency_overrides[db] = broken_db
    try:
        r = TestClient(app).post(
            "/auth/login",
            headers={"Origin": "http://localhost:5173"},
            json={"email": "user@example.com", "password": "test-password-123"},
        )
        assert r.status_code == 503
        assert "database request failed" in r.json()["detail"]
        assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    finally:
        app.dependency_overrides.pop(db, None)


def test_liveness_identifies_the_expected_api():
    assert TestClient(app).get("/live").json()["service"] == "outfitly-api"
