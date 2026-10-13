import os
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.config import Settings
from app.run import api_options, runtime_options


def make(mode, **overrides):
    return Settings(_env_file=None, app_env=mode, database_url="postgresql://u:p@localhost/db",
                    jwt_secret="x" * 40, business_rules_json=os.environ["BUSINESS_RULES_JSON"],
                    frontend_origins=overrides.pop("frontend_origins", "http://localhost:5173" if mode == "dev" else "https://outfitly.vercel.app"),
                    **overrides)


def test_dev_defaults_and_localhost_alias():
    config = make("dev")
    assert config.image_storage == "local"
    assert "http://127.0.0.1:5173" in config.cors_origins
    assert runtime_options(config)["reload"]
    assert api_options(config)["debug"]
    assert TestClient(FastAPI(**api_options(config))).get("/docs").status_code == 200


def test_prod_defaults_and_api_policy():
    config = make("prod")
    assert config.image_storage == "supabase"
    assert config.cors_origins == ["https://outfitly.vercel.app"]
    assert runtime_options(config) == {"host": "0.0.0.0", "port": 8000, "workers": 1, "reload": False}
    assert not api_options(config)["debug"]
    client = TestClient(FastAPI(**api_options(config)))
    for path in ["/docs", "/redoc", "/openapi.json"]:
        assert client.get(path).status_code == 404


@pytest.mark.parametrize("origin", ["http://example.com", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://0.0.0.0", "*", "https://user:password@example.com"])
def test_prod_rejects_invalid_origins(origin):
    with pytest.raises(ValueError):
        make("prod", frontend_origins=origin)


def test_explicit_local_storage_override_remains_supported():
    assert make("prod", image_storage="local").image_storage == "local"


def test_unknown_mode_is_rejected():
    with pytest.raises(ValueError):
        make("production")


def test_prod_requires_a_configured_frontend_origin():
    with pytest.raises(ValueError):
        make("prod", frontend_origins="", frontend_origin="")


def test_configuration_errors_do_not_print_secrets():
    with pytest.raises(ValueError) as exc:
        Settings(_env_file=None, app_env="prod", database_url="postgresql://user:private-password@example.com/db",
                 jwt_secret="private-jwt-secret" * 3, business_rules_json="{}", frontend_origins="http://localhost:5173")
    assert "private-password" not in str(exc.value)
    assert "private-jwt-secret" not in str(exc.value)
