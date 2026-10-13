from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# ml-service/.env is found regardless of the working directory. Real environment
# variables always take precedence over values in this file.
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def parse_app_env(value):
    """Accept dev/prod in any case, with stray whitespace or quotes; reject anything else."""
    if isinstance(value, str):
        value = value.strip().strip("\"'").strip().lower()
    return value


class Settings(BaseSettings):
    app_env: Literal["dev", "prod"]
    port: int = 8001
    # Shared secret; the core backend sends the same value as its ML_SERVICE_TOKEN.
    ml_service_token: SecretStr
    embedding_model: str = "sentence-transformers/clip-ViT-B-32"
    # Load CLIP at startup instead of on the first request. Defaults: dev=no, prod=yes.
    preload_model: bool | None = None
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore", hide_input_in_errors=True)

    _normalize_app_env = field_validator("app_env", mode="before")(parse_app_env)

    @field_validator("ml_service_token")
    @classmethod
    def strong_token(cls, value):
        secret = value.get_secret_value()
        if len(secret) < 32 or secret.startswith("replace-"):
            raise ValueError("Set ML_SERVICE_TOKEN to a random secret of at least 32 characters")
        return value

    @property
    def is_dev(self):
        return self.app_env == "dev"

    @property
    def preload(self):
        return not self.is_dev if self.preload_model is None else self.preload_model


@lru_cache
def settings():
    return Settings()
