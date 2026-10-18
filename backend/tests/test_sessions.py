from datetime import datetime, timedelta, timezone
from io import BytesIO
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app import limits, main, weather
from app.models import Base, RevokedToken


@pytest.fixture
def api(monkeypatch, tmp_path):
    """The real API on a throwaway SQLite database, signed in as one user on two devices."""
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)

    def db():
        with Session(engine) as s:
            yield s

    main.app.dependency_overrides[main.db] = db
    monkeypatch.setattr(main.image_storage, "local", tmp_path)
    monkeypatch.setattr(main.image_storage, "remote", False)
    client = TestClient(main.app)
    phone = client.post("/auth/register", json={"email": "walid@example.com", "password": "a-safe-test-password", "remember": True}).json()
    laptop = client.post("/auth/login", json={"email": "walid@example.com", "password": "a-safe-test-password"}).json()
    yield client, engine, {"Authorization": "Bearer " + phone["token"]}, {"Authorization": "Bearer " + laptop["token"]}
    main.app.dependency_overrides.clear()


def test_signing_out_cancels_that_token_only(api):
    client, engine, phone, laptop = api
    assert client.get("/me", headers=phone).status_code == 200
    assert client.post("/auth/logout", headers=phone).json() == {"ok": True}
    assert client.get("/me", headers=phone).status_code == 401  # a copy of it is useless too
    assert client.get("/me", headers=laptop).status_code == 200  # the other device stays signed in
    assert client.post("/auth/logout", headers=phone).status_code == 200  # twice is fine


def test_signing_out_clears_entries_for_tokens_that_expired_anyway(api):
    client, engine, phone, _ = api
    with Session(engine) as s:
        s.add(RevokedToken(jti="old", user_id="x", expires_at=datetime.now(timezone.utc) - timedelta(days=1)))
        s.commit()
    client.post("/auth/logout", headers=phone)
    with Session(engine) as s:
        assert s.scalar(select(func.count()).select_from(RevokedToken)) == 1  # only the new one


def test_sign_out_of_all_devices(api):
    client, _, phone, laptop = api
    assert client.post("/me/sign-out-everywhere", headers=laptop).status_code == 200
    assert client.get("/me", headers=phone).status_code == 401
    assert client.get("/me", headers=laptop).status_code == 401
    again = client.post("/auth/login", json={"email": "walid@example.com", "password": "a-safe-test-password"}).json()
    assert client.get("/me", headers={"Authorization": "Bearer " + again["token"]}).status_code == 200


def png():
    out = BytesIO()
    Image.new("RGB", (32, 32), "blue").save(out, format="PNG")
    return out.getvalue()


def test_photos_have_a_daily_allowance(api, monkeypatch):
    client, _, phone, _ = api
    monkeypatch.setitem(limits.LIMITS, "photos", (2, limits.DAY))
    monkeypatch.setattr(main.embeddings, "image", lambda jpeg: [1.0] + [0.0] * 511)
    wid = client.post("/wardrobes", headers=phone, json={"name": "Mine"}).json()["id"]
    form = {"name": "Tee", "category": "tops", "texture": "cotton", "style": "Everyday", "color": "#111111"}
    codes = [client.post(f"/wardrobes/{wid}/clothes", headers=phone, data=form, files={"image": ("p.png", png(), "image/png")}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    refused = client.post(f"/wardrobes/{wid}/clothes/analyze", headers=phone, files={"image": ("p.png", png(), "image/png")})
    assert refused.status_code == 429 and "today’s limit of 2 photos" in refused.json()["detail"]
    assert "hours" in refused.json()["detail"]


def test_the_public_weather_endpoint_is_limited_per_address(api, monkeypatch):
    client, *_ = api
    monkeypatch.setattr(weather, "fetch_forecast", lambda *a, **k: {
        "temp_max": 20, "temp_min": 12, "temp_now": 18, "feels_like": 18, "rain_chance": 0, "precipitation": 0,
        "wind": 10, "code": 1, "summary": "Mainly clear", "timezone": "Europe/Paris"})
    monkeypatch.setattr(weather, "place_name", lambda *a, **k: "Lyon, France")
    place = {"latitude": 45.76, "longitude": 4.84, "pieces": []}
    codes = [client.post("/today/sample", json=place).status_code for _ in range(31)]
    assert codes[:30] == [200] * 30 and codes[30] == 429
