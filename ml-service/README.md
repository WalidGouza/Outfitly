# Outfitly ML service

Standalone FastAPI service that runs CLIP (PyTorch + sentence-transformers) and turns clothing photos and style prompts into 512-dimension embeddings. It is the only part of Outfitly that needs PyTorch, so the core API in `backend/` can run on small hosts such as Render's free tier.

It has no database access and stores nothing. The core API calls it over HTTP with a shared bearer token:

| Endpoint | Body | Returns |
|---|---|---|
| `POST /embed/image` | raw JPEG bytes (`Content-Type: image/jpeg`, max 10 MB) | `{"embedding": [512 floats]}` |
| `POST /embed/text` | `{"text": "..."}` | `{"embedding": [512 floats]}` |
| `POST /embed/texts` | `{"texts": ["...", ...]}` (1–64) | `{"embeddings": [[512 floats], ...]}` — used for upload auto-detection labels |
| `GET /`, `GET /live`, `GET /health` | – | status, and whether the model is loaded |

## Configuration

Copy `.env.example` to `.env` (or set real environment variables on the host):

- `APP_ENV` — required, `dev` or `prod`. `prod` disables API docs/debug and preloads the model at startup.
- `ML_SERVICE_TOKEN` — required, at least 32 characters. Must equal `ML_SERVICE_TOKEN` in the backend.
- `PORT` — defaults to 8001.
- `PRELOAD_MODEL` — optional.

The CLIP model is downloaded while the image is built and loaded offline at runtime (`HF_HUB_OFFLINE=1`), so containers start without a download and need no persistent disk. To use a different model, rebuild with `--build-arg EMBEDDING_MODEL=...` (it must output 512 dimensions).

Then point the backend at it: `ML_SERVICE_URL=https://your-ml-host` and the same `ML_SERVICE_TOKEN`.

## Hosting on Modal

[Modal](https://modal.com) runs the service from `modal_app.py`, which wraps the unchanged FastAPI app. Containers scale to zero when idle, so you only pay for time spent serving requests (plus a 2-minute warm window after each burst). The free Starter plan includes $30 of compute per month; at 1 CPU core and 2 GB that covers roughly 475 active hours, far more than this app needs.

1. Create a Modal account, then install the CLI and sign in:
   ```bash
   pip install modal
   ```
   ```bash
   modal setup
   ```
2. Generate the service token and copy it; the same value goes to Modal and to Render:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
3. In the Modal dashboard open **Secrets > Create new secret > Custom**, name it `outfitly-ml`, and add the key `ML_SERVICE_TOKEN` with that value.
4. Deploy from this folder (`ml-service/`). The first deploy builds the image, including the CLIP model, and takes several minutes:
   ```bash
   modal deploy modal_app.py
   ```
5. The deploy prints the endpoint URL, which looks like `https://YOUR_WORKSPACE--outfitly-ml-web.modal.run`. Open it with `/live` appended and expect `"service": "outfitly-ml"` and `"environment": "prod"`.
6. On Render set `ML_SERVICE_URL` to that URL and `ML_SERVICE_TOKEN` to the same value, then upload a photo in the app.

To deploy changes, rerun `modal deploy modal_app.py`. The endpoint is public, but every embedding route requires `ML_SERVICE_TOKEN`. `max_containers=2` in `modal_app.py` caps concurrent containers and so the cost.

After an idle period the first request starts a container and loads CLIP, which takes roughly 10–30 seconds; the backend's 90-second `ML_SERVICE_TIMEOUT` covers that.

The `Dockerfile` remains for local runs and Docker Compose.

## Running locally

```bash
docker build -t outfitly-ml .
docker run --env-file .env -p 8001:8001 outfitly-ml
```

Without Docker: install CPU PyTorch (`pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu`), then `pip install -r requirements.txt` and `python -m app.run` (the model downloads on first use). Tests use a stub model and do not need PyTorch: `python -m pytest tests -q`.
