import json, os
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi import HTTPException

os.environ["DATABASE_URL"] = (
    "postgresql+psycopg://atelier:atelier@localhost:5432/atelier"
)
os.environ["JWT_SECRET"] = "a-test-only-secret-not-for-production-123456"
os.environ["BUSINESS_RULES_JSON"] = (
    Path(".env.example").read_text().split("BUSINESS_RULES_JSON=", 1)[1].strip()
)
from app.main import owned, token, user
from app.config import Settings


class FakeSession:
    def __init__(self, result):
        self.result = result

    def get(self, *args):
        return self.result


def test_wardrobe_owner_is_allowed():
    wardrobe = SimpleNamespace(user_id="alice")
    assert owned("w", SimpleNamespace(id="alice"), FakeSession(wardrobe)) is wardrobe


@pytest.mark.parametrize("wardrobe", [None, SimpleNamespace(user_id="bob")])
def test_other_users_cannot_access_wardrobe(wardrobe):
    with pytest.raises(HTTPException) as exc:
        owned("w", SimpleNamespace(id="alice"), FakeSession(wardrobe))
    assert exc.value.status_code == 404


def test_tampered_token_is_rejected():
    with pytest.raises(HTTPException) as exc:
        user(SimpleNamespace(credentials="invalid"), FakeSession(None))
    assert exc.value.status_code == 401


def test_deleted_user_token_is_rejected():
    signed = token(SimpleNamespace(id="alice"))["token"]
    with pytest.raises(HTTPException) as exc:
        user(SimpleNamespace(credentials=signed), FakeSession(None))
    assert exc.value.status_code == 401


def test_rule_weights_are_validated():
    rules = json.loads(os.environ["BUSINESS_RULES_JSON"])
    rules["weights"]["semantic"] = 4
    config = Settings(business_rules_json=json.dumps(rules))
    with pytest.raises(ValueError):
        config.rules
