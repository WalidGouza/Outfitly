from app.database import database_url
from app.config import Settings
import pytest


def test_supabase_uri_normalized_and_encrypted():
    url = database_url(
        "postgres://postgres.ref:secret@aws-0-region.pooler.supabase.com:5432/postgres"
    )
    assert url.drivername == "postgresql+psycopg"
    assert url.query["sslmode"] == "require"
    assert url.username == "postgres.ref"


def test_explicit_ssl_and_encoded_password_preserved():
    url = database_url(
        "postgresql://postgres:pass%40word@db.ref.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=root.crt"
    )
    assert url.password == "pass@word"
    assert url.query["sslmode"] == "verify-full"
    assert url.query["sslrootcert"] == "root.crt"


def test_local_connection_does_not_force_ssl():
    assert "sslmode" not in database_url("postgresql+psycopg://u:p@localhost/app").query


def test_project_url_rejected_without_echoing_credentials():
    with pytest.raises(ValueError, match="Supabase project URLs"):
        database_url("https://ref.supabase.co")


def test_cors_origins_allow_only_explicit_hosts_and_local_aliases():
    config = Settings(
        database_url="postgresql://u:p@localhost/db",
        jwt_secret="a" * 40,
        business_rules_json="{}",
        frontend_origins="http://localhost:5173,https://app.example.com",
    )
    assert set(config.cors_origins) == {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://app.example.com",
    }
    config.frontend_origins = "*"
    with pytest.raises(ValueError):
        config.cors_origins
