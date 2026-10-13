"""Environment-aware entry point, also used by Docker."""
import uvicorn
from pathlib import Path
from .config import settings


def runtime_options(config):
    options = {"host": "0.0.0.0", "port": 8000, "workers": 1, "reload": config.is_dev}
    if config.is_dev:
        options["reload_dirs"] = [str(Path(__file__).resolve().parent)]
    return options


def api_options(config):
    return {"debug": config.is_dev, "docs_url": "/docs" if config.is_dev else None,
            "redoc_url": "/redoc" if config.is_dev else None,
            "openapi_url": "/openapi.json" if config.is_dev else None}


if __name__ == "__main__":
    uvicorn.run("app.main:app", **runtime_options(settings()))
