from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Literal
import warnings
import logging
import jwt
from PIL import Image, ImageOps, UnidentifiedImageError
from pwdlib import PasswordHash
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.security import HTTPBearer
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from .config import settings
from .database import make_engine
from .models import Base, User, Wardrobe, Cloth, Outfit
from .embeddings import embed
from .matching import rank
from .storage import ImageStorage, StorageUnavailable
from .run import api_options

Image.MAX_IMAGE_PIXELS = 16_000_000
s = settings()
engine = make_engine(s.database_url)
passwords = PasswordHash.recommended()
bearer = HTTPBearer()
uploads = Path(s.upload_dir).resolve()
image_storage = ImageStorage(s)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    if not image_storage.remote:
        uploads.mkdir(parents=True, exist_ok=True)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            # Browser access must pass through FastAPI authorization. No Data API policies.
            conn.execute(
                text(f'ALTER TABLE public."{table.name}" ENABLE ROW LEVEL SECURITY')
            )
    yield


app = FastAPI(title="Outfitly API", lifespan=lifespan, **api_options(s))
app.add_middleware(
    CORSMiddleware,
    allow_origins=s.cors_origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(StorageUnavailable)
async def storage_error(request, exc):
    logger.error("Image storage failed: %s", exc)
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(SQLAlchemyError)
async def database_error(request, exc):
    return JSONResponse(
        status_code=503,
        content={
            "detail": "The API is running but the database request failed. Check backend DATABASE_URL, Supabase connectivity, and schema permissions. See the backend terminal for startup errors."
        },
    )


@app.get("/live")
def live():
    return {"status": "ok", "service": "outfitly-api", "environment": s.app_env}


def db():
    with Session(engine) as session:
        yield session


def user(auth=Depends(bearer), session=Depends(db)):
    try:
        data = jwt.decode(auth.credentials, s.jwt_secret, algorithms=["HS256"])
        found = session.get(User, data["sub"])
        if found:
            return found
    except (jwt.PyJWTError, KeyError):
        pass
    raise HTTPException(401, "Session expired. Please sign in again.")


def owned(wid, u, session):
    w = session.get(Wardrobe, wid)
    if not w or w.user_id != u.id:
        raise HTTPException(404, "Wardrobe not found")
    return w


def cloth_json(c):
    return {
        k: getattr(c, k)
        for k in ("id", "name", "category", "texture", "style", "color", "image")
    }


class Credentials(BaseModel):
    email: str = Field(
        min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    )
    password: str = Field(min_length=10, max_length=128)


def token(u):
    return {
        "token": jwt.encode(
            {"sub": u.id, "exp": datetime.now(timezone.utc) + timedelta(hours=12)},
            s.jwt_secret,
            algorithm="HS256",
        )
    }


@app.post("/auth/register")
def register(body: Credentials, session=Depends(db)):
    u = User(
        email=body.email.strip().lower(), password_hash=passwords.hash(body.password)
    )
    session.add(u)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Email already registered")
    return token(u)


@app.post("/auth/login")
def login(body: Credentials, session=Depends(db)):
    u = session.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not u or not passwords.verify(body.password, u.password_hash):
        raise HTTPException(401, "Email or password incorrect")
    return token(u)


class Name(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@app.get("/wardrobes")
def wardrobes(u=Depends(user), session=Depends(db)):
    return [
        {"id": w.id, "name": w.name}
        for w in session.scalars(select(Wardrobe).where(Wardrobe.user_id == u.id))
    ]


@app.post("/wardrobes")
def new_wardrobe(body: Name, u=Depends(user), session=Depends(db)):
    w = Wardrobe(user_id=u.id, name=body.name)
    session.add(w)
    session.commit()
    return {"id": w.id, "name": w.name}


@app.get("/wardrobes/{wid}/clothes")
def clothes(wid: str, u=Depends(user), session=Depends(db)):
    owned(wid, u, session)
    return [
        cloth_json(c)
        for c in session.scalars(select(Cloth).where(Cloth.wardrobe_id == wid))
    ]


@app.post("/wardrobes/{wid}/clothes")
def upload(
    wid: str,
    name: str = Form(min_length=1, max_length=80),
    category: Literal["tops", "pants", "shoes", "jackets"] = Form(),
    texture: Literal[
        "cotton", "denim", "knit", "leather", "linen", "silk", "other"
    ] = Form(),
    style: Literal[
        "Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"
    ] = Form(),
    color: str = Form(pattern=r"^#[0-9a-fA-F]{6}$"),
    image: UploadFile = File(),
    u=Depends(user),
    session=Depends(db),
):
    owned(wid, u, session)
    raw = image.file.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image must be under 10 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            im = Image.open(BytesIO(raw))
            im.load()
            im = ImageOps.exif_transpose(im).convert("RGB")
            im.thumbnail((1600, 1600))
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise HTTPException(400, "Upload a valid JPG, PNG or WebP image")
    try:
        vector = embed(im)
    except Exception as exc:
        logger.exception("Image embedding failed")
        raise HTTPException(
            503, "Image model unavailable. Check model download and server logs."
        ) from exc
    jpeg = BytesIO()
    im.save(jpeg, format="JPEG", quality=90)
    filename = image_storage.save(jpeg.getvalue())
    c = Cloth(
        wardrobe_id=wid,
        name=name,
        category=category,
        texture=texture,
        style=style,
        color=color,
        image=filename,
        embedding=vector,
    )
    session.add(c)
    try:
        session.commit()
    except Exception:
        session.rollback()
        try:
            image_storage.delete(filename)
        except Exception:
            logger.error("Image cleanup failed after database rollback")
        raise
    return cloth_json(c)


@app.get("/images/{filename}")
def get_image(filename: str, u=Depends(user), session=Depends(db)):
    c = session.scalar(
        select(Cloth)
        .join(Wardrobe)
        .where(Cloth.image == filename, Wardrobe.user_id == u.id)
    )
    if not c:
        raise HTTPException(404, "Image not found")
    try:
        jpeg = image_storage.read(c.image)
    except FileNotFoundError:
        raise HTTPException(404, "Photo unavailable. The stored file is missing; upload the photo again.") from None
    return Response(jpeg, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})


class Generate(BaseModel):
    style: Literal["Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"] = (
        "Everyday"
    )
    harmony: Literal["balanced", "tonal", "contrast"] = "balanced"
    include_jacket: bool = True
    anchor_id: str | None = None


@app.post("/wardrobes/{wid}/generate")
def generate(wid: str, body: Generate, u=Depends(user), session=Depends(db)):
    owned(wid, u, session)
    try:
        query = embed(f"A {body.style} fashion outfit with coordinated textures")
    except Exception as exc:
        raise HTTPException(503, "Embedding model unavailable") from exc
    anchor = None
    if body.anchor_id:
        anchor = session.get(Cloth, body.anchor_id)
        if not anchor or anchor.wardrobe_id != wid:
            raise HTTPException(404, "Selected piece not found")
        query = [(a + b) / 2 for a, b in zip(query, anchor.embedding)]
    pools = {}
    semantic = {}
    for category in ["tops", "pants", "shoes"] + (
        ["jackets"] if body.include_jacket else []
    ):
        distance = Cloth.embedding.cosine_distance(query)
        rows = session.execute(
            select(Cloth, distance)
            .where(Cloth.wardrobe_id == wid, Cloth.category == category)
            .order_by(distance)
            .limit(s.rules["max_candidates"])
        ).all()
        pools[category] = [c for c, d in rows]
        for c, d in rows:
            semantic[c.id] = max(0, min(1, 1 - float(d)))
    if anchor:
        if anchor.category == "jackets" and not body.include_jacket:
            raise HTTPException(400, "Enable jackets to use this selected piece")
        pools[anchor.category] = [anchor]
        semantic[anchor.id] = max(
            0,
            min(
                1,
                1
                - float(
                    session.scalar(
                        select(Cloth.embedding.cosine_distance(query)).where(
                            Cloth.id == anchor.id
                        )
                    )
                ),
            ),
        )
    rules = dict(s.rules)
    if body.harmony == "tonal":
        rules["complementary_tolerance"] = -1
    if body.harmony == "contrast":
        rules["analogous_degrees"] = -1
    results = rank(pools, semantic, rules, anchor=body.anchor_id)
    if not results:
        raise HTTPException(
            400, "Add at least one top, one pair of pants, and one pair of shoes"
        )
    return [
        {**r, "items": [cloth_json(c) for c in r["items"]], "style": body.style}
        for r in results
    ]


class Save(Name):
    style: str = Field(max_length=40)
    cloth_ids: list[str] = Field(min_length=3, max_length=4)


@app.post("/wardrobes/{wid}/outfits")
def save(wid: str, body: Save, u=Depends(user), session=Depends(db)):
    owned(wid, u, session)
    items = list(
        session.scalars(
            select(Cloth).where(Cloth.wardrobe_id == wid, Cloth.id.in_(body.cloth_ids))
        )
    )
    if len(items) != len(body.cloth_ids) or set(c.category for c in items) not in (
        {"tops", "pants", "shoes"},
        {"tops", "pants", "shoes", "jackets"},
    ):
        raise HTTPException(400, "Choose one piece per category from this wardrobe")
    o = Outfit(
        wardrobe_id=wid, name=body.name, style=body.style, cloth_ids=body.cloth_ids
    )
    session.add(o)
    session.commit()
    return {"id": o.id}


@app.get("/wardrobes/{wid}/outfits")
def saved(wid: str, u=Depends(user), session=Depends(db)):
    owned(wid, u, session)
    return [
        {
            "id": o.id,
            "name": o.name,
            "style": o.style,
            "items": [cloth_json(session.get(Cloth, cid)) for cid in o.cloth_ids],
        }
        for o in session.scalars(select(Outfit).where(Outfit.wardrobe_id == wid))
    ]


@app.delete("/wardrobes/{wid}/outfits/{oid}")
def unsave(wid: str, oid: str, u=Depends(user), session=Depends(db)):
    owned(wid, u, session)
    o = session.get(Outfit, oid)
    if not o or o.wardrobe_id != wid:
        raise HTTPException(404, "Outfit not found")
    session.delete(o)
    session.commit()
    return {"ok": True}


@app.get("/health")
def health(session=Depends(db)):
    session.execute(text("SELECT 1"))
    return {"status": "ok"}
