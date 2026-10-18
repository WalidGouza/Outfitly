from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app import limits, main
from app.limits import Limiter, client_ip

PASSWORD = "correct horse battery"


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_attempts_are_counted_in_a_sliding_window():
    clock = Clock()
    lim = Limiter({"x": (3, 60)}, clock=clock)
    for _ in range(3):
        lim.take("x", "a")
    with pytest.raises(main.HTTPException) as refused:
        lim.take("x", "a")
    assert refused.value.status_code == 429 and refused.value.headers["Retry-After"] == "60"
    lim.take("x", "b")  # someone else is unaffected
    clock.now += 61
    lim.take("x", "a")  # the window has passed


def test_tracked_keys_stay_bounded_under_a_flood(monkeypatch):
    monkeypatch.setattr(limits, "MAX_TRACKED", 100)
    lim = Limiter({"x": (5, 60)})
    for i in range(1000):
        lim.hit("x", f"ip{i}")
    assert len(lim.hits) <= 100


def request(client="10.0.0.1", forwarded=None):
    headers = {"x-forwarded-for": forwarded} if forwarded else {}
    return SimpleNamespace(client=SimpleNamespace(host=client), headers=headers)


def test_the_visitor_address_comes_from_the_trusted_proxy_only():
    assert client_ip(request(), 0) == "10.0.0.1"
    # The visitor can write anything on the left; the proxy's own entry is the last one.
    assert client_ip(request(forwarded="6.6.6.6, 203.0.113.9"), 1) == "203.0.113.9"
    assert client_ip(request(forwarded="203.0.113.9, 10.1.1.1"), 2) == "203.0.113.9"
    assert client_ip(request(), 1) == "10.0.0.1"  # no header: the connection itself


class Users:
    """One account, walid@example.com."""

    def __init__(self):
        self.u = SimpleNamespace(id="u1", email="walid@example.com", password_hash=main.passwords.hash(PASSWORD),
                                 session_version=0, username=None, avatar=None)
        self.added = []

    def scalar(self, stmt):
        wanted = stmt.whereclause.right.value
        return self.u if wanted == self.u.email else None

    def get(self, model, ident):
        return self.u if ident == "u1" else None

    def add(self, row):
        self.added.append(row)

    def commit(self):
        pass

    def rollback(self):
        pass


@pytest.fixture
def client(monkeypatch):
    session = Users()
    main.app.dependency_overrides[main.db] = lambda: session
    yield TestClient(main.app), session
    main.app.dependency_overrides.clear()


def login(c, password, email="walid@example.com", ip=None):
    headers = {"x-forwarded-for": ip} if ip else {}
    return c.post("/auth/login", json={"email": email, "password": password}, headers=headers)


def test_password_guessing_is_stopped_after_5_wrong_tries(client):
    c, _ = client
    assert [login(c, f"wrong-guess-{i:03d}").status_code for i in range(5)] == [401] * 5
    refused = login(c, PASSWORD)  # even the right password, until the window passes
    assert refused.status_code == 429 and "Too many attempts" in refused.json()["detail"]
    assert int(refused.headers["Retry-After"]) > 800
    assert login(c, PASSWORD, email="someone-else@example.com").status_code == 401  # other accounts unaffected


def test_signing_in_clears_the_wrong_tries(client):
    c, _ = client
    for i in range(4):
        login(c, f"wrong-guess-{i:03d}")
    assert login(c, PASSWORD).status_code == 200
    assert [login(c, f"again-{i:03d}-xx").status_code for i in range(5)] == [401] * 5


def test_guessing_one_account_from_many_addresses_is_stopped_too(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(main.s, "trusted_proxy_hops", 1)
    codes = [login(c, f"wrong-guess-{i:03d}", ip=f"198.51.100.{i}").status_code for i in range(20)]
    assert codes == [401] * 20
    assert login(c, PASSWORD, ip="198.51.100.250").status_code == 429


def test_one_address_trying_many_accounts_is_stopped(client):
    c, _ = client
    codes = [login(c, "wrong-guess-123", email=f"user{i}@example.com").status_code for i in range(60)]
    assert set(codes) == {401}
    assert login(c, PASSWORD).status_code == 429


def test_an_unknown_email_costs_the_same_password_check(client, monkeypatch):
    c, _ = client
    checked = []
    real = main.passwords.verify
    monkeypatch.setattr(main.passwords, "verify", lambda pw, h: checked.append(h) or real(pw, h))
    assert login(c, "whatever-password", email="nobody@example.com").status_code == 401
    assert checked == [main.UNKNOWN_USER_HASH]


def test_new_accounts_are_limited_per_address(client):
    c, _ = client
    codes = [c.post("/auth/register", json={"email": f"new{i}@example.com", "password": "a-long-password"}).status_code for i in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429


def test_a_stolen_session_cant_guess_the_current_password(client):
    c, session = client
    signed_in = {"Authorization": "Bearer " + main.token(session.u)["token"]}
    change = lambda pw: c.post("/me/password", headers=signed_in, json={"current_password": pw, "new_password": "a-brand-new-password"})
    assert [change(f"guess-{i}").status_code for i in range(10)] == [403] * 10
    assert change(PASSWORD).status_code == 429


# ── Request size ─────────────────────────────────────────────────────────────
@pytest.fixture
def parsed(monkeypatch):
    """How many bytes of multipart data the API parsed."""
    import starlette.formparsers as fp
    seen = {"bytes": 0}
    original = fp.MultiPartParser.on_part_data

    def spy(self, data, start, end):
        seen["bytes"] += end - start
        return original(self, data, start, end)

    monkeypatch.setattr(fp.MultiPartParser, "on_part_data", spy)
    return seen


def test_an_oversized_upload_is_refused_before_it_is_read(parsed):
    c = TestClient(main.app)
    r = c.post("/wardrobes/w/clothes", files={"image": ("p.png", b"0" * (12 * 1024 * 1024), "image/png")},
               headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 413 and "under 10 MB" in r.json()["detail"]
    assert parsed["bytes"] == 0
    # Still readable by the browser: CORS headers are on the refusal.
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_a_body_without_a_length_is_cut_off_at_the_limit():
    c = TestClient(main.app)

    def chunks():
        for _ in range(20):
            yield b"x" * 32 * 1024  # 640 KB in total, over the 256 KB limit for JSON routes

    r = c.post("/auth/login", content=chunks(), headers={"Content-Type": "application/json"})
    assert r.status_code == 413


def test_ordinary_json_is_limited_to_256_kb():
    c = TestClient(main.app)
    big = {"email": "a@example.com", "password": "x" * 300_000}
    assert c.post("/auth/login", json=big).status_code == 413


def test_normal_requests_are_untouched(client):
    c, _ = client
    assert login(c, PASSWORD).status_code == 200
