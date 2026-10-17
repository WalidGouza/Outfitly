from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Literal
import warnings
import logging
import math
from types import SimpleNamespace
import jwt
from PIL import Image, ImageOps, UnidentifiedImageError
from pwdlib import PasswordHash
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.security import HTTPBearer
from fastapi.responses import Response, JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from .config import settings
from .database import make_engine
from .models import Base, User, Wardrobe, Cloth, Outfit
from .embeddings import EmbeddingClient, EmbeddingUnavailable
from .text_cache import TextEmbeddingStore
from . import meaning
from .matching import is_outfit, rank, score_combo
from . import attributes
from .storage import ImageStorage, StorageUnavailable
from .run import api_options
from . import weather

Image.MAX_IMAGE_PIXELS = 16_000_000
s = settings()
engine = make_engine(s.database_url)
passwords = PasswordHash.recommended()
bearer = HTTPBearer()
uploads = Path(s.upload_dir).resolve()
image_storage = ImageStorage(s)
embeddings = EmbeddingClient(s, store=TextEmbeddingStore(engine, s.embedding_model))
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    # uvicorn configures its own logger, so this line is visible in every host's logs.
    logging.getLogger("uvicorn.error").info(
        "Outfitly API starting in %s mode (image storage: %s, ML service: %s)",
        s.app_env, s.image_storage, "configured" if embeddings.configured else "not configured",
    )
    if not image_storage.remote:
        uploads.mkdir(parents=True, exist_ok=True)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        # create_all never adds columns to an existing table: migrate databases from before garment types.
        conn.execute(text("ALTER TABLE public.clothes ADD COLUMN IF NOT EXISTS garment VARCHAR"))
        conn.execute(text("ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS score INTEGER"))
        conn.execute(text("ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS breakdown JSON"))
        conn.execute(text("ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS score_version INTEGER"))
        conn.execute(text("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username VARCHAR"))
        conn.execute(text("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar VARCHAR"))
        conn.execute(text("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS wear VARCHAR"))
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


# ── Errors: detailed for developers (APP_ENV=dev), plain language for users (APP_ENV=prod) ──
# The detailed cause is always written to the backend log either way.
FRIENDLY = {
    "storage": "We couldn’t save or load your photo right now. Please try again in a moment.",
    "ml": "Photo analysis isn’t available right now. Please try again in a moment.",
    "database": "Something went wrong on our side. Please try again in a moment.",
    "unexpected": "Something went wrong on our side. Please try again in a moment.",
}
# Validation errors by field: what to tell a user who typed something we can't accept.
FIELD_MESSAGES = {
    "email": "Enter a valid email address.",
    "password": "Passwords are 10 to 128 characters.",
    "current_password": "Enter your current password.",
    "new_password": "Your new password must be 10 to 128 characters.",
    "username": "Usernames are 2 to 30 letters, numbers, spaces, dots, dashes or underscores.",
    "name": "Names can be 1 to 80 characters.",
    "color": "Choose a colour from the list.",
    "image": "Choose a photo to upload.",
    "latitude": "We couldn’t read your location. Please try again.",
    "longitude": "We couldn’t read your location. Please try again.",
    "cloth_ids": "Choose the pieces for this outfit again.",
}


def user_message(kind, exc):
    return str(exc) if s.is_dev else FRIENDLY[kind]


@app.exception_handler(StorageUnavailable)
async def storage_error(request, exc):
    logger.error("Image storage failed: %s", exc)
    return JSONResponse(status_code=503, content={"detail": user_message("storage", exc)})


@app.exception_handler(EmbeddingUnavailable)
async def embedding_error(request, exc):
    logger.error("Embedding failed: %s", exc)
    return JSONResponse(status_code=503, content={"detail": user_message("ml", exc)})


@app.exception_handler(SQLAlchemyError)
async def database_error(request, exc):
    logger.error("Database request failed: %s", exc.__class__.__name__)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "The API is running but the database request failed. Check backend DATABASE_URL, Supabase connectivity, and schema permissions. See the backend terminal for startup errors."
            if s.is_dev
            else FRIENDLY["database"]
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    if s.is_dev:
        # FastAPI's own field-by-field list, which the dev frontend formats as "field: problem".
        return await request_validation_exception_handler(request, exc)
    fields = [str(e.get("loc", ["", ""])[-1]) for e in exc.errors()]
    message = next((FIELD_MESSAGES[f] for f in fields if f in FIELD_MESSAGES), None)
    if message is None and any(f in {"category", "texture", "style", "garment", "harmony", "wear"} for f in fields):
        message = "Choose an option from the list."
    return JSONResponse(status_code=422, content={"detail": message or "Some details aren’t valid. Please check them and try again."})


@app.exception_handler(Exception)
async def unexpected_error(request, exc):
    logger.exception("Unexpected error on %s %s", request.method, request.url.path)
    detail = f"Unexpected {exc.__class__.__name__}: {exc}" if s.is_dev else FRIENDLY["unexpected"]
    return JSONResponse(status_code=500, content={"detail": detail})


@app.get("/live")
def live():
    return {
        "status": "ok",
        "service": "outfitly-api",
        "environment": s.app_env,
        "ml_service": "configured" if embeddings.configured else "not configured",
    }


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
        k: getattr(c, k, None)
        for k in ("id", "name", "category", "garment", "texture", "style", "color", "image")
    }


class Credentials(BaseModel):
    email: str = Field(
        min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    )
    password: str = Field(min_length=10, max_length=128)
    # Asked at sign-up; only used on registration and optional.
    wear: Literal["women", "men", "both"] | None = None


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
        email=body.email.strip().lower(), password_hash=passwords.hash(body.password), wear=body.wear
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


# ── Account: profile, password, photo, deletion ─────────────────────────────
def me_json(u):
    return {"email": u.email, "username": u.username, "avatar": bool(u.avatar), "wear": getattr(u, "wear", None)}


class Profile(BaseModel):
    # Letters (any language), digits, spaces and . _ - ; trimmed before checking.
    username: str | None = Field(None, min_length=2, max_length=30, pattern=r"^[\w .-]+$")
    wear: Literal["women", "men", "both"] | None = None


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class Confirm(BaseModel):
    password: str = Field(min_length=1, max_length=128)


def check_password(u, password):
    if not passwords.verify(password, u.password_hash):
        raise HTTPException(403, "Current password is incorrect")


@app.get("/me")
def me(u=Depends(user)):
    return me_json(u)


@app.patch("/me")
def update_me(body: Profile, u=Depends(user), session=Depends(db)):
    if body.username is None and body.wear is None:
        raise HTTPException(422, "Nothing to update")
    if body.username is not None:
        name = " ".join(body.username.split())
        if len(name) < 2:
            raise HTTPException(422, "Username must be at least 2 characters")
        u.username = name
    if body.wear is not None:
        u.wear = body.wear
    session.commit()
    return me_json(u)


@app.post("/me/password")
def change_password(body: PasswordChange, u=Depends(user), session=Depends(db)):
    check_password(u, body.current_password)
    if body.new_password == body.current_password:
        raise HTTPException(422, "Choose a password different from the current one")
    u.password_hash = passwords.hash(body.new_password)
    session.commit()
    return {"ok": True}


@app.put("/me/avatar")
def set_avatar(image: UploadFile = File(), u=Depends(user), session=Depends(db)):
    im, _ = load_image(image)
    # Square, centred crop, small enough for a profile picture.
    square = ImageOps.fit(im, (512, 512), method=Image.Resampling.LANCZOS)
    out = BytesIO()
    square.save(out, format="JPEG", quality=88)
    filename = image_storage.save(out.getvalue())
    old, u.avatar = u.avatar, filename
    try:
        session.commit()
    except Exception:
        session.rollback()
        image_storage.delete(filename)
        raise
    if old:
        try:
            image_storage.delete(old)
        except Exception:
            logger.error("Old profile photo cleanup failed")
    return me_json(u)


@app.get("/me/avatar")
def get_avatar(u=Depends(user)):
    if not u.avatar:
        raise HTTPException(404, "No profile photo")
    try:
        jpeg = image_storage.read(u.avatar)
    except FileNotFoundError:
        raise HTTPException(404, "Profile photo unavailable") from None
    return Response(jpeg, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})


@app.delete("/me/avatar")
def remove_avatar(u=Depends(user), session=Depends(db)):
    old, u.avatar = u.avatar, None
    session.commit()
    if old:
        try:
            image_storage.delete(old)
        except Exception:
            logger.error("Profile photo cleanup failed")
    return me_json(u)


@app.delete("/me")
def delete_account(body: Confirm, u=Depends(user), session=Depends(db)):
    """Deletes the account and everything in it: wardrobes, pieces, saved outfits, photos."""
    check_password(u, body.password)
    wardrobes = list(session.scalars(select(Wardrobe).where(Wardrobe.user_id == u.id)))
    ids = [w.id for w in wardrobes]
    photos = [u.avatar] if u.avatar else []
    if ids:
        for o in session.scalars(select(Outfit).where(Outfit.wardrobe_id.in_(ids))):
            session.delete(o)
        for c in session.scalars(select(Cloth).where(Cloth.wardrobe_id.in_(ids))):
            photos.append(c.image)
            session.delete(c)
    for w in wardrobes:
        session.delete(w)
    session.delete(u)
    session.commit()
    for filename in photos:
        try:
            image_storage.delete(filename)
        except Exception:
            # The account is already gone; an orphaned private photo is harmless.
            logger.error("Photo cleanup failed after deleting an account")
    return {"ok": True, "removed_photos": len(photos)}


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


def load_image(image: UploadFile):
    """Validate an upload and return the normalised image and its stored JPEG bytes."""
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
    jpeg = BytesIO()
    im.save(jpeg, format="JPEG", quality=90)
    return im, jpeg.getvalue()


@app.post("/wardrobes/{wid}/clothes/analyze")
def analyze(wid: str, image: UploadFile = File(), u=Depends(user), session=Depends(db)):
    """Suggested form values for a photo. Nothing is stored."""
    owned(wid, u, session)
    im, jpeg = load_image(image)
    try:
        return attributes.suggest(im, jpeg, embeddings, getattr(u, "wear", None))
    except EmbeddingUnavailable as exc:
        logger.warning("Attribute detection unavailable: %s", exc)
        return attributes.suggest_color_only(im)
    except ValueError:
        raise HTTPException(400, "Upload a valid JPG, PNG or WebP image") from None


@app.post("/wardrobes/{wid}/clothes")
def upload(
    wid: str,
    name: str = Form(min_length=1, max_length=80),
    category: Literal["tops", "pants", "shoes", "jackets", "dresses"] = Form(),
    texture: Literal[
        "cotton", "denim", "knit", "leather", "linen", "silk", "other"
    ] = Form(),
    style: Literal[
        "Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"
    ] = Form(),
    color: str = Form(pattern=r"^#[0-9a-fA-F]{6}$"),
    garment: str = Form("", max_length=40),
    image: UploadFile = File(),
    u=Depends(user),
    session=Depends(db),
):
    owned(wid, u, session)
    garment = garment.strip().lower() or None
    if garment and garment not in attributes.GARMENTS[category]:
        raise HTTPException(422, f"Choose a type of {category} from the list")
    _, jpeg = load_image(image)
    try:
        vector = embeddings.image(jpeg)
    except ValueError:
        raise HTTPException(400, "Upload a valid JPG, PNG or WebP image") from None
    filename = image_storage.save(jpeg)
    c = Cloth(
        wardrobe_id=wid,
        name=name,
        category=category,
        texture=texture,
        style=style,
        color=color,
        garment=garment,
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


@app.delete("/wardrobes/{wid}/clothes/{cid}")
def remove_piece(wid: str, cid: str, u=Depends(user), session=Depends(db)):
    owned(wid, u, session)
    c = session.get(Cloth, cid)
    if not c or c.wardrobe_id != wid:
        raise HTTPException(404, "Piece not found")
    # Saved outfits would be incomplete without this piece, so they go with it.
    outfits = [
        o
        for o in session.scalars(select(Outfit).where(Outfit.wardrobe_id == wid))
        if cid in o.cloth_ids
    ]
    for o in outfits:
        session.delete(o)
    filename = c.image
    session.delete(c)
    session.commit()
    try:
        image_storage.delete(filename)
    except Exception:
        # The piece is already gone; an orphaned private photo is harmless.
        logger.error("Image cleanup failed after removing a piece")
    return {"ok": True, "removed_outfits": len(outfits)}


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
    style_text = f"A {body.style} fashion outfit with coordinated textures"
    query = embeddings.text(style_text)
    anchor = None
    if body.anchor_id:
        anchor = session.get(Cloth, body.anchor_id)
        if not anchor or anchor.wardrobe_id != wid:
            raise HTTPException(404, "Selected piece not found")
        if anchor.category == "jackets" and not body.include_jacket:
            raise HTTPException(400, "Enable jackets to use this selected piece")
        # The starting piece only steers which candidates are considered...
        query = [(a + b) / 2 for a, b in zip(query, anchor.embedding)]
    pools = {}
    for category in ["tops", "pants", "dresses", "shoes"] + (
        ["jackets"] if body.include_jacket else []
    ):
        rows = session.scalars(
            select(Cloth)
            .where(Cloth.wardrobe_id == wid, Cloth.category == category)
            .order_by(Cloth.embedding.cosine_distance(query))
            .limit(s.rules["max_candidates"])
        ).all()
        pools[category] = list(rows)
    if anchor:
        pools[anchor.category] = [anchor]
    # ...while Meaning is always measured against the style alone, so an outfit scores the
    # same with or without a starting piece (and the same as when it is saved).
    semantic = meaning.piece_scores([c for pool in pools.values() for c in pool], body.style, style_vectors())
    rules = dict(s.rules)
    if body.harmony == "tonal":
        rules["complementary_tolerance"] = -1
    if body.harmony == "contrast":
        rules["analogous_degrees"] = -1
    results = rank(pools, semantic, rules, anchor=body.anchor_id)
    if not results:
        raise HTTPException(
            400, "Add a top, bottoms and shoes, or a dress and shoes"
        )
    return [
        {**r, "items": [cloth_json(c) for c in r["items"]], "style": body.style}
        for r in results
    ]


class Save(Name):
    style: str = Field(max_length=40)
    cloth_ids: list[str] = Field(min_length=3, max_length=4)


def outfit_pieces(wid, cloth_ids, session):
    """The pieces of an outfit: one top, pants and shoes (plus an optional jacket) from this wardrobe."""
    items = list(
        session.scalars(
            select(Cloth).where(Cloth.wardrobe_id == wid, Cloth.id.in_(cloth_ids))
        )
    )
    if len(items) != len(cloth_ids) or not is_outfit(c.category for c in items):
        raise HTTPException(400, "Choose a top, bottoms and shoes, or a dress and shoes, from this wardrobe")
    return items


@app.post("/wardrobes/{wid}/outfits")
def save(wid: str, body: Save, u=Depends(user), session=Depends(db)):
    owned(wid, u, session)
    items = outfit_pieces(wid, body.cloth_ids, session)
    # Scored once here (ML service down: left empty and filled in on a later listing).
    scored = saved_score(items, body.style)
    o = Outfit(
        wardrobe_id=wid, name=body.name, style=body.style, cloth_ids=body.cloth_ids,
        score=scored.get("score"), breakdown=scored.get("breakdown"),
        score_version=meaning.SCORE_VERSION if scored else None,
    )
    session.add(o)
    session.commit()
    return {"id": o.id}


@app.get("/wardrobes/{wid}/outfits")
def saved(wid: str, u=Depends(user), session=Depends(db)):
    owned(wid, u, session)
    looks = []
    backfilled = False
    for o in session.scalars(select(Outfit).where(Outfit.wardrobe_id == wid)):
        items = [session.get(Cloth, cid) for cid in o.cloth_ids]
        # Skip outfits left incomplete by data from before piece removal existed.
        if not all(items):
            continue
        if getattr(o, "score", None) is None or getattr(o, "score_version", None) != meaning.SCORE_VERSION:
            # Saved before scores were stored, or under an older formula: score it once and keep it.
            scored = saved_score(items, o.style)
            if scored:
                o.score, o.breakdown = scored["score"], scored["breakdown"]
                o.score_version = meaning.SCORE_VERSION
                backfilled = True
        looks.append(
            {
                "id": o.id,
                "name": o.name,
                "style": o.style,
                "items": [cloth_json(c) for c in items],
                **({"score": o.score, "breakdown": o.breakdown} if getattr(o, "score", None) is not None else {}),
            }
        )
    if backfilled:
        session.commit()
    return looks


def saved_score(items, style):
    """Scores a saved outfit the way generation did (balanced colours, no anchor).

    The meaning part needs the ML service; when it is down the outfit is listed without a score.
    """
    try:
        vectors = style_vectors()
    except EmbeddingUnavailable:
        return {}
    return score_combo(items, meaning.piece_scores(items, style, vectors), s.rules)


def style_vectors():
    """Embeddings of the five style descriptions (stored, so normally no ML call)."""
    return embeddings.texts(meaning.PROMPTS)


# ── Outfit of the day, from the weather ─────────────────────────────────────
Style = Literal["Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"]
WEIGHT_OF_WEATHER = 0.35


STYLES = ["Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"]


class Rate(BaseModel):
    cloth_ids: list[str] = Field(min_length=3, max_length=4)
    # "Auto" scores the outfit in every style and reports the one it fits best.
    style: Literal["Auto", "Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"] = "Auto"


@app.post("/wardrobes/{wid}/rate")
def rate(wid: str, body: Rate, u=Depends(user), session=Depends(db)):
    """Outfit lab: the match score of an outfit the user put together themselves."""
    owned(wid, u, session)
    items = outfit_pieces(wid, body.cloth_ids, session)
    candidates = STYLES if body.style == "Auto" else [body.style]
    try:
        vectors, estimated = style_vectors(), False
    except EmbeddingUnavailable:
        # Without the ML service, meaning comes from the pieces' style tags alone.
        vectors, estimated = None, True
    scored = [
        {"style": style, **score_combo(items, meaning.piece_scores(items, style, vectors), s.rules)}
        for style in candidates
    ]
    best = max(scored, key=lambda r: r["score"])
    return {**best, "estimated": estimated, "items": [cloth_json(c) for c in items]}


class Place(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    style: Style = "Everyday"


class SamplePiece(BaseModel):
    id: str = Field(max_length=40)
    name: str = Field(max_length=80)
    category: Literal["tops", "pants", "shoes", "jackets", "dresses"]
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    texture: Literal["cotton", "denim", "knit", "leather", "linen", "silk", "other"]
    style: Style = "Everyday"
    garment: str | None = Field(None, max_length=40)


class SamplePlace(Place):
    pieces: list[SamplePiece] = Field(max_length=40)


def forecast_for(place):
    try:
        w = weather.fetch_forecast(place.latitude, place.longitude, url=s.weather_api_url)
    except weather.WeatherUnavailable as exc:
        raise HTTPException(503, str(exc)) from None
    return {
        **w,
        # The exact (rounded to ~1 km) point the forecast is for, shown next to the place name.
        "latitude": round(place.latitude, 2),
        "longitude": round(place.longitude, 2),
        "place": weather.place_name(place.latitude, place.longitude, w.get("timezone", ""), url=s.geocoder_url),
    }


def weather_looks(pieces, semantic, plan, w, limit=6):
    """Best outfits for today's weather from these pieces, best first."""
    fits = {c.id: weather.fit(c, plan) for c in pieces}
    categories = ["tops", "pants", "dresses", "shoes"] + (["jackets"] if weather.wants_layer(plan, w) else [])
    pools = {}
    for category in categories:
        ranked = sorted(
            (c for c in pieces if c.category == category),
            key=lambda c: (fits[c.id], semantic[c.id]),
            reverse=True,
        )
        # Pieces the weather rules out are only used when nothing else fits.
        suitable = [c for c in ranked if fits[c.id] >= 0.3] or ranked[:1]
        if suitable:
            pools[category] = suitable[: s.rules["max_candidates"]]
    results = rank(pools, semantic, s.rules, limit=limit * 4)
    looks = []
    for r in results:
        fit = sum(fits[c.id] for c in r["items"]) / len(r["items"])
        score = round((1 - WEIGHT_OF_WEATHER) * r["score"] + WEIGHT_OF_WEATHER * fit * 100)
        looks.append({**r, "score": score, "breakdown": {**r["breakdown"], "weather": round(fit * 100)}})
    looks.sort(key=lambda r: r["score"], reverse=True)
    return looks[:limit]


def today_response(pieces, semantic, place, w, plan):
    return {
        "weather": w,
        "advice": plan["notes"],
        "layer": plan["layer"],
        "looks": [
            {**look, "items": [cloth_json(c) for c in look["items"]], "style": place.style}
            for look in weather_looks(pieces, semantic, plan, w)
        ],
        "missing": weather.missing(pieces, plan, w),
    }


@app.post("/wardrobes/{wid}/today")
def today(wid: str, place: Place, u=Depends(user), session=Depends(db)):
    owned(wid, u, session)
    w = forecast_for(place)
    plan = weather.plan(w, s.weather_rules)
    pieces = list(session.scalars(select(Cloth).where(Cloth.wardrobe_id == wid)))
    try:
        vectors = style_vectors()
    except EmbeddingUnavailable:
        # Weather, colour and the style tags still pick a good outfit while the ML service is down.
        vectors = None
    semantic = meaning.piece_scores(pieces, place.style, vectors)
    return today_response(pieces, semantic, place, w, plan)


@app.post("/today/sample")
def today_sample(place: SamplePlace):
    """The same weather pick for the signed-out sample wardrobe (no photos, no embeddings)."""
    w = forecast_for(place)
    plan = weather.plan(w, s.weather_rules)
    pieces = [
        SimpleNamespace(
            **{**p.model_dump(), "garment": p.garment if p.garment in attributes.GARMENTS[p.category] else None},
            image=None,
        )
        for p in place.pieces
    ]
    semantic = {p.id: 0.72 + (0.2 if p.style == place.style else 0) for p in pieces}
    return today_response(pieces, semantic, place, w, plan)


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
