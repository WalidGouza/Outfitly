"""Modal deployment of the ML service. Deploy with `modal deploy modal_app.py` from ml-service/.

Serves the unchanged FastAPI app (app/main.py). The container scales to zero when idle;
the CLIP model is baked into the image so a cold start only has to load it, not download it.
"""
from pathlib import Path
import modal

MODEL = "sentence-transformers/clip-ViT-B-32"
HERE = Path(__file__).resolve().parent


def download_model():
    from sentence_transformers import SentenceTransformer

    SentenceTransformer(MODEL)


image = (
    modal.Image.debian_slim(python_version="3.12")
    # CPU wheels avoid downloading the multi-GB CUDA runtime.
    .pip_install("torch", "torchvision", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install_from_requirements(str(HERE / "requirements.txt"))
    .env(
        {
            "APP_ENV": "prod",
            "EMBEDDING_MODEL": MODEL,
            "HF_HOME": "/models/huggingface",
            "TOKENIZERS_PARALLELISM": "false",
            "OMP_NUM_THREADS": "2",
            "MKL_NUM_THREADS": "2",
        }
    )
    .run_function(download_model)
    # Load only the baked model at runtime: no Hub requests on startup.
    .env({"HF_HUB_OFFLINE": "1"})
    .add_local_dir(str(HERE / "app"), remote_path="/root/app")
)

app = modal.App("outfitly-ml", image=image)


@app.function(
    # Provides ML_SERVICE_TOKEN; create it in the Modal dashboard (see README).
    secrets=[modal.Secret.from_name("outfitly-ml")],
    cpu=1.0,
    memory=2048,
    min_containers=0,
    max_containers=2,
    # Seconds an idle container stays warm; idle time is billed, so keep it short.
    scaledown_window=120,
    timeout=120,
)
@modal.concurrent(max_inputs=8)
@modal.asgi_app()
def web():
    from app.main import app as service

    return service
