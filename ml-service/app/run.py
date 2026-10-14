"""Environment-aware entry point, also used by Docker."""
import uvicorn
from pathlib import Path
from .config import settings


def runtime_options(config):
    # PORT is provided by most hosts; Docker and local runs default to 8001.
    options = {"host": "127.0.0.1", "port": config.port, "workers": 1, "reload": config.is_dev}
    if config.is_dev:
        options["reload_dirs"] = [str(Path(__file__).resolve().parent)]
    return options


if __name__ == "__main__":
    uvicorn.run("app.main:app", **runtime_options(settings()))
