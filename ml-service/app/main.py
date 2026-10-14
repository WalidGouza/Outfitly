from contextlib import asynccontextmanager
from io import BytesIO
import hmac
import logging
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from typing import Annotated
from pydantic import BaseModel, Field
from .config import settings
from . import model as clip

Image.MAX_IMAGE_PIXELS = 16_000_000
MAX_UPLOAD = 10 * 1024 * 1024
s = settings()
bearer = HTTPBearer(auto_error=False)
log = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app):
    log.info("Outfitly ML service starting in %s mode (preload model: %s)", s.app_env, s.preload)
    if s.preload:
        await run_in_threadpool(clip.model)
    yield


docs = {} if s.is_dev else {"docs_url": None, "redoc_url": None, "openapi_url": None}
app = FastAPI(title="Outfitly ML service", lifespan=lifespan, debug=s.is_dev, **docs)


def authorized(auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
    expected = s.ml_service_token.get_secret_value().encode()
    if not auth or not hmac.compare_digest(auth.credentials.encode(), expected):
        raise HTTPException(401, "Invalid service token")


@app.get("/live")
def live():
    return {"status": "ok", "service": "outfitly-ml", "environment": s.app_env}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": clip.model.cache_info().currsize > 0}


@app.post("/embed/image", dependencies=[Depends(authorized)])
async def embed_image(request: Request):
    raw = bytearray()
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > MAX_UPLOAD:
            raise HTTPException(413, "Image must be under 10 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            im = Image.open(BytesIO(raw))
            im.load()
            im = ImageOps.exif_transpose(im).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(400, "Invalid image") from None
    return {"embedding": await run_in_threadpool(clip.embed, im)}


class Text(BaseModel):
    text: str = Field(min_length=1, max_length=500)


@app.post("/embed/text", dependencies=[Depends(authorized)])
async def embed_text(body: Text):
    return {"embedding": await run_in_threadpool(clip.embed, body.text)}


class Texts(BaseModel):
    texts: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(min_length=1, max_length=64)


@app.post("/embed/texts", dependencies=[Depends(authorized)])
async def embed_texts(body: Texts):
    # Batch form, used for zero-shot attribute labels; one round trip instead of dozens.
    return {"embeddings": await run_in_threadpool(clip.embed_many, body.texts)}
