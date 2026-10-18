import os
from pathlib import Path

os.environ["DATABASE_URL"] = (
    "postgresql+psycopg://atelier:atelier@localhost:5432/atelier"
)
os.environ["JWT_SECRET"] = "a-test-only-secret-not-for-production-123456"
os.environ["BUSINESS_RULES_JSON"] = (
    Path(".env.example").read_text().split("BUSINESS_RULES_JSON=", 1)[1].strip()
)
# Pin the mode so a developer's backend/.env (e.g. APP_ENV=prod) cannot leak into tests.
os.environ["APP_ENV"] = "dev"
os.environ["ML_SERVICE_URL"] = ""
os.environ["FRONTEND_ORIGIN"] = "http://localhost:5173"
os.environ["FRONTEND_ORIGINS"] = ""


import pytest


@pytest.fixture(autouse=True)
def fresh_attempt_limits():
    # Each test starts with no sign-in attempts counted.
    from app.limits import limiter

    limiter.reset()
    yield


def pytest_configure(config):
    # Unit tests never reach a database: keep text embeddings in memory only.
    from app import main

    main.embeddings.store = None
