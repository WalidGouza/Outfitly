# Outfitly ML service

Standalone FastAPI service that runs CLIP (PyTorch + sentence-transformers) and turns clothing photos and style prompts into 512-dimension embeddings. It is the only part of Outfitly that needs PyTorch, so the core API in `backend/` can run on small hosts such as Render's free tier.

It has no database access and stores nothing. The core API calls it over HTTP with a shared bearer token:

| Endpoint | Body | Returns |
|---|---|---|
| `POST /embed/image` | raw JPEG bytes (`Content-Type: image/jpeg`, max 10 MB) | `{"embedding": [512 floats]}` |
| `POST /embed/text` | `{"text": "..."}` | `{"embedding": [512 floats]}` |
| `POST /embed/texts` | `{"texts": ["...", ...]}` (1–64) | `{"embeddings": [[512 floats], ...]}` — used for upload auto-detection labels |
| `GET /live`, `GET /health` | – | status, and whether the model is loaded |

## Configuration

Copy `.env.example` to `.env` (or set real environment variables on the host):

- `APP_ENV` — required, `dev` or `prod`. `prod` disables API docs/debug and preloads the model at startup.
- `ML_SERVICE_TOKEN` — required, at least 32 characters. Must equal `ML_SERVICE_TOKEN` in the backend.
- `PORT` — defaults to 8001; most hosts set it automatically.
- `EMBEDDING_MODEL`, `PRELOAD_MODEL` — optional.

Then point the backend at it: `ML_SERVICE_URL=https://your-ml-host` and the same `ML_SERVICE_TOKEN`.

## Running

```bash
docker build -t outfitly-ml .
docker run --env-file .env -p 8001:8001 outfitly-ml
```

Without Docker: install CPU PyTorch (`pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu`), then `pip install -r requirements.txt` and `python -m app.run`.

Hosting needs roughly 1–2 GB RAM for CLIP ViT-B/32 (peak not yet measured). The first start downloads the model (~600 MB) from Hugging Face; persist `HF_HOME` if the host allows it. Tests use a stub model and do not need PyTorch: `python -m pytest tests -q`.
