"""Environment-aware entry point, also used by Docker."""
import uvicorn
from pathlib import Path
from .config import settings


def runtime_options(config):
    # PORT is provided by hosts such as Render; Docker and local runs default to 8000.
    options = {"host": "127.0.0.1", "port": config.port, "workers": 1, "reload": config.is_dev}
    if config.is_dev:
        options["reload_dirs"] = [str(Path(__file__).resolve().parent)]
    return options


def api_options(config):
    return {"debug": config.is_dev, "docs_url": "/docs" if config.is_dev else None,
            "redoc_url": "/redoc" if config.is_dev else None,
            "openapi_url": "/openapi.json" if config.is_dev else None}


if __name__ == "__main__":
    uvicorn.run("app.main:app", **runtime_options(settings()))
