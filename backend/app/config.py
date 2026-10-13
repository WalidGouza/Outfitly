import json
from functools import lru_cache
from typing import Literal
from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: Literal["dev", "prod"] = "dev"
    database_url: str
    jwt_secret: str
    frontend_origin: str = "http://localhost:5173"
    frontend_origins: str = ""
    upload_dir: str = "uploads"
    image_storage: Literal["local", "supabase"] | None = None
    supabase_url: str = ""
    supabase_service_role_key: SecretStr = SecretStr("")
    supabase_storage_bucket: str = "wardrobe-images"
    embedding_model: str = "sentence-transformers/clip-ViT-B-32"
    business_rules_json: str
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    @model_validator(mode="after")
    def environment_defaults(self):
        if self.image_storage is None:
            self.image_storage = "supabase" if self.app_env == "prod" else "local"
        self.cors_origins
        return self

    @property
    def is_dev(self):
        return self.app_env == "dev"

    @property
    def cors_origins(self):
        from urllib.parse import urlsplit
        from ipaddress import ip_address

        origins = [
            value.strip().rstrip("/")
            for value in (self.frontend_origins or self.frontend_origin).split(",")
            if value.strip()
        ]
        if not origins:
            raise ValueError("Configure at least one explicit frontend origin")
        for origin in list(origins):
            url = urlsplit(origin)
            if (
                url.scheme not in {"http", "https"}
                or not url.netloc
                or url.path
                or url.query
                or url.fragment
                or url.username
                or url.password
            ):
                raise ValueError(
                    "FRONTEND_ORIGINS must contain comma-separated HTTP(S) origins without paths"
                )
            if not self.is_dev:
                host = url.hostname or ""
                local = host == "localhost" or host.endswith((".localhost", ".local"))
                try:
                    address = ip_address(host)
                    local = local or address.is_loopback or address.is_unspecified
                except ValueError:
                    pass
                if url.scheme != "https" or local:
                    raise ValueError("APP_ENV=prod requires explicit HTTPS frontend origins without localhost")
            if self.is_dev and url.hostname in {"localhost", "127.0.0.1"}:
                counterpart = (
                    "127.0.0.1" if url.hostname == "localhost" else "localhost"
                )
                origins.append(
                    f"{url.scheme}://{counterpart}"
                    + (f":{url.port}" if url.port else "")
                )
        return list(dict.fromkeys(origins))

    @property
    def rules(self):
        data = json.loads(self.business_rules_json)
        weights = data["weights"]
        if (
            set(weights) != {"semantic", "color", "texture"}
            or any(v < 0 for v in weights.values())
            or abs(sum(weights.values()) - 1) > 1e-6
        ):
            raise ValueError("Scoring weights must be nonnegative and sum to one")
        for key in (
            "neutral_saturation",
            "neutral_value_low",
            "analogous_degrees",
            "complementary_tolerance",
            "max_candidates",
            "max_combinations",
            "texture_pairs",
            "neutral_score",
            "complementary_score",
            "triadic_score",
            "unmatched_color_score",
            "same_texture_score",
            "unknown_texture_score",
            "analogous_falloff_degrees",
        ):
            if key not in data:
                raise ValueError(f"Missing rule: {key}")
        if (
            not 1 <= data["max_candidates"] <= 30
            or not 1 <= data["max_combinations"] <= 50000
        ):
            raise ValueError("Candidate limits out of bounds")
        return data


@lru_cache
def settings():
    s = Settings()
    if len(s.jwt_secret) < 32 or s.jwt_secret.startswith("replace-"):
        raise ValueError("Set a strong JWT_SECRET in .env")
    s.rules
    s.cors_origins
    return s
