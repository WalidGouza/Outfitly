from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Literal
from uuid import uuid4
import warnings
import logging
import math
from types import SimpleNamespace
import jwt
from PIL import Image, ImageOps, UnidentifiedImageError
from pwdlib import PasswordHash
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.security import HTTPBearer
from fastapi.responses import Response, JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from .config import settings
from .database import make_engine
from .models import Base, User, Wardrobe, Cloth, Outfit, RevokedToken, SavedLook, Suggestion, SuggestionEvent
from .embeddings import EmbeddingClient, EmbeddingUnavailable
from .text_cache import TextEmbeddingStore
from . import explore, improve, learning, meaning
from . import persona as taste
from .matching import SHAPES, is_outfit, rank, score_combo
from . import attributes
from .storage import ImageStorage, StorageUnavailable
from .limits import BodySizeLimit, client_ip, limiter
from .run import api_options
from . import weather

Image.MAX_IMAGE_PIXELS = 16_000_000
# The photo formats the app accepts. Pillow can read many more (TIFF, PSD, ICO...); each one is
# more parsing code an attacker could aim at, so the rest are refused. Phone JPEGs holding
# several pictures (MPO) are opened by the JPEG reader, so they're covered.
PHOTO_FORMATS = ["JPEG", "PNG", "WEBP"]
s = settings()
engine = make_engine(s.database_url)
passwords = PasswordHash.recommended()
# Checked against when the email is unknown, so a wrong email takes as long as a wrong password
# and response times don't reveal which emails have an account.
UNKNOWN_USER_HASH = passwords.hash("no account has this password")
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
        conn.execute(text("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS persona JSON"))
        conn.execute(text("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS styles JSON"))
        conn.execute(text("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS seen JSON"))
        conn.execute(text("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS session_version INTEGER"))
    with engine.begin() as conn:
        # Supabase's Data API roles; absent on plain PostgreSQL (CI, local Docker).
        api_roles = conn.scalars(
            text("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
        ).all()
        for table in Base.metadata.sorted_tables:
            # Browser access must pass through FastAPI authorization. No Data API policies.
            conn.execute(
                text(f'ALTER TABLE public."{table.name}" ENABLE ROW LEVEL SECURITY')
            )
            # RLS without policies already hides the rows, but Supabase grants these roles every
            # privilege on new tables, and TRUNCATE is not covered by RLS. The app never uses them.
            for role in api_roles:
                conn.execute(text(f'REVOKE ALL ON TABLE public."{table.name}" FROM "{role}"'))
    yield


app = FastAPI(title="Outfitly API", lifespan=lifespan, **api_options(s))
# Added first, so it runs inside CORS: a refused upload still carries CORS headers and the
# browser can show its message.
app.add_middleware(BodySizeLimit)
app.add_middleware(
    CORSMiddleware,
    allow_origins=s.cors_origins,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
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
# Text typed by users: no control characters (PostgreSQL can't store NUL, and the others only
# hide things in a name).
PLAIN_TEXT = r"^[^\x00-\x1f\x7f]+$"

# Validation errors by field: what to tell a user who typed something we can't accept.
FIELD_MESSAGES = {
    "email": "Enter a valid email address.",
    "password": "Passwords are 10 to 128 characters.",
    "current_password": "Enter your current password.",
    "new_password": "Your new password must be 10 to 128 characters.",
    "username": "Usernames are 2 to 30 letters, numbers, spaces, dots, dashes or underscores.",
    "name": "Names can be 1 to 80 characters, without special characters like line breaks.",
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
        # It quotes the bad input back; NaN or Infinity can't be written as JSON, so those are
        # quoted as text.
        errors = [
            {**e, "input": str(e["input"])} if isinstance(e.get("input"), float) and not math.isfinite(e["input"]) else e
            for e in exc.errors()
        ]
        return await request_validation_exception_handler(request, RequestValidationError(errors, body=exc.body))
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


def read_token(credentials):
    """The claims of a sign-in token we issued: our secret, HS256, and an expiry and user that
    must be there (a token without "exp" would otherwise never expire)."""
    return jwt.decode(credentials, s.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})


def user(auth=Depends(bearer), session=Depends(db)):
    try:
        data = read_token(auth.credentials)
        found = session.get(User, data["sub"])
        # A token from before the last password change (or "sign out of all devices") no longer
        # signs anyone in, nor one that was signed out.
        if (
            found
            and data.get("v", 0) == (getattr(found, "session_version", None) or 0)
            and not (data.get("jti") and session.get(RevokedToken, data["jti"]))
        ):
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
        min_length=3, max_length=254, pattern=r"^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$"
    )
    password: str = Field(min_length=10, max_length=128)
    # Asked at sign-up; only used on registration and optional.
    wear: Literal["women", "men", "both"] | None = None
    # "Remember me": a 30-day sign-in instead of 12 hours (the browser keeps it across restarts).
    remember: bool = False


SESSION_HOURS = 12
REMEMBER_DAYS = 30


def token(u, remember=False):
    lifetime = timedelta(days=REMEMBER_DAYS) if remember else timedelta(hours=SESSION_HOURS)
    return {
        "token": jwt.encode(
            {
                "sub": u.id,
                "exp": datetime.now(timezone.utc) + lifetime,
                # Identifies this token, so signing out can cancel it on the server.
                "jti": uuid4().hex,
                # Which sign-in generation this is (password changes start a new one), and whether
                # to remember it, so a renewed token keeps the same lifetime.
                "v": getattr(u, "session_version", None) or 0,
                "r": remember,
            },
            s.jwt_secret,
            algorithm="HS256",
        ),
        "remember": remember,
    }


@app.post("/auth/register")
def register(body: Credentials, request: Request, session=Depends(db)):
    ip = client_ip(request, s.trusted_proxy_hops)
    limiter.take("auth", ip)
    limiter.take("register", ip)
    u = User(
        email=body.email.strip().lower(), password_hash=passwords.hash(body.password), wear=body.wear
    )
    session.add(u)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Email already registered")
    return token(u, body.remember)


@app.post("/auth/login")
def login(body: Credentials, request: Request, session=Depends(db)):
    ip = client_ip(request, s.trusted_proxy_hops)
    email = body.email.strip().lower()
    # Refused before the password is hashed, so floods cost nothing.
    limiter.take("auth", ip)
    limiter.check("login-fail", (email, ip))
    limiter.check("email-fail", email)
    u = session.scalar(select(User).where(User.email == email))
    if not passwords.verify(body.password, u.password_hash if u else UNKNOWN_USER_HASH) or not u:
        limiter.hit("login-fail", (email, ip))
        limiter.hit("email-fail", email)
        raise HTTPException(401, "Email or password incorrect")
    limiter.clear("login-fail", (email, ip))
    return token(u, body.remember)


@app.post("/auth/logout")
def logout(auth=Depends(bearer), session=Depends(db)):
    """Cancels this sign-in on the server, so a copied token stops working too."""
    try:
        data = read_token(auth.credentials)
    except jwt.PyJWTError:
        return {"ok": True}  # expired or invalid: already unusable
    jti = data.get("jti")
    if jti and not session.get(RevokedToken, jti):
        session.add(RevokedToken(jti=jti, user_id=str(data.get("sub", "")), expires_at=datetime.fromtimestamp(data["exp"], timezone.utc)))
        # Tokens past their expiry need no entry any more.
        session.execute(delete(RevokedToken).where(RevokedToken.expires_at < datetime.now(timezone.utc)))
        session.commit()
    return {"ok": True}


@app.post("/me/sign-out-everywhere")
def sign_out_everywhere(u=Depends(user), session=Depends(db)):
    """Every device, this one included, has to sign in again."""
    u.session_version = (getattr(u, "session_version", None) or 0) + 1
    session.commit()
    return {"ok": True}


# ── Account: profile, password, photo, deletion ─────────────────────────────
def me_json(u):
    return {
        "email": u.email, "username": u.username, "avatar": bool(u.avatar), "wear": getattr(u, "wear", None),
        "styles": getattr(u, "styles", None), "seen": getattr(u, "seen", None) or [],
    }


class Profile(BaseModel):
    # Letters (any language), digits, spaces and . _ - ; trimmed before checking.
    username: str | None = Field(None, min_length=2, max_length=30, pattern=r"^[\w .-]+$")
    wear: Literal["women", "men", "both"] | None = None
    # The styles they like, from first sign-in or the profile; [] when they skipped.
    styles: list[Literal["Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"]] | None = Field(None, max_length=5)
    # Features just introduced; added to the ones already seen (never removed).
    seen: list[Literal["next-buys"]] | None = Field(None, max_length=10)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class Confirm(BaseModel):
    password: str = Field(min_length=1, max_length=128)


def check_password(u, password):
    """The current password, for changing it or deleting the account: a stolen session alone
    can't guess it, because wrong answers are limited per account."""
    limiter.check("password-fail", u.id)
    if not passwords.verify(password, u.password_hash):
        limiter.hit("password-fail", u.id)
        raise HTTPException(403, "Current password is incorrect")


@app.get("/me")
def me(u=Depends(user)):
    return me_json(u)


@app.patch("/me")
def update_me(body: Profile, u=Depends(user), session=Depends(db)):
    if body.username is None and body.wear is None and body.styles is None and body.seen is None:
        raise HTTPException(422, "Nothing to update")
    if body.username is not None:
        name = " ".join(body.username.split())
        if len(name) < 2:
            raise HTTPException(422, "Username must be at least 2 characters")
        u.username = name
    if body.wear is not None:
        u.wear = body.wear
    if body.styles is not None:
        u.styles = list(dict.fromkeys(body.styles))  # in the order picked, once each
    if body.seen:
        u.seen = list(dict.fromkeys([*(getattr(u, "seen", None) or []), *body.seen]))
    session.commit()
    return me_json(u)


@app.post("/me/password")
def change_password(body: PasswordChange, auth=Depends(bearer), u=Depends(user), session=Depends(db)):
    """Changes the password and signs out every other device: their tokens carry the old
    session_version. This device gets a new token, with the same "remember me" choice."""
    check_password(u, body.current_password)
    if body.new_password == body.current_password:
        raise HTTPException(422, "Choose a password different from the current one")
    remember = bool(read_token(auth.credentials).get("r"))
    u.password_hash = passwords.hash(body.new_password)
    u.session_version = (getattr(u, "session_version", None) or 0) + 1
    session.commit()
    return {"ok": True, **token(u, remember)}


@app.put("/me/avatar")
def set_avatar(image: UploadFile = File(), u=Depends(user), session=Depends(db)):
    limiter.take("avatar", u.id)
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
    if ids:
        for row in session.scalars(select(Suggestion).where(Suggestion.wardrobe_id.in_(ids))):
            session.delete(row)
    for row in session.scalars(select(SuggestionEvent).where(SuggestionEvent.user_id == u.id)):
        session.delete(row)
    for row in session.scalars(select(RevokedToken).where(RevokedToken.user_id == u.id)):
        session.delete(row)
    for row in session.scalars(select(SavedLook).where(SavedLook.user_id == u.id)):
        session.delete(row)
    # The models have no relationships, so the ORM doesn't know rows depend on each other and may
    # delete a user before its wardrobes. Flushing level by level keeps the foreign keys satisfied.
    session.flush()
    for w in wardrobes:
        session.delete(w)
    session.flush()
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
    name: str = Field(min_length=1, max_length=80, pattern=PLAIN_TEXT)


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
            im = Image.open(BytesIO(raw), formats=PHOTO_FORMATS)
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
    # Each photo analysed costs ML credits: a daily allowance per account, shared with uploads.
    limiter.take("photos", u.id)
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
    name: str = Form(min_length=1, max_length=80, pattern=PLAIN_TEXT),
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
    limiter.take("photos", u.id)
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
    followed(u, c, session)
    return {**cloth_json(c), "completed": complete_looks(u, c, session)}


def followed(u, c, session):
    """Records an "added" reaction when a new piece matches one we suggested to this user.
    Best effort: learning never gets in the way of an upload."""
    try:
        key = improve.piece_key(c)
        suggested = session.scalar(
            select(SuggestionEvent)
            .where(SuggestionEvent.user_id == u.id, SuggestionEvent.key == key, SuggestionEvent.action != "added")
            .order_by(SuggestionEvent.created_at.desc())
            .limit(1)
        )
        if suggested is None:
            return
        session.add(SuggestionEvent(
            user_id=u.id, wardrobe_id=c.wardrobe_id, action="added", key=key, spec=suggested.spec,
            context={"source": "upload", "cloth_id": c.id},
        ))
        session.commit()
    except Exception:
        session.rollback()
        logger.warning("Couldn't record a followed suggestion", exc_info=True)


def complete_looks(u, c, session):
    """Saved suggested outfits this new piece completes become real saved outfits.

    Best effort, like followed(): returns the outfits made, for the app to say so."""
    try:
        pieces = list(session.scalars(select(Cloth).where(Cloth.wardrobe_id == c.wardrobe_id)))
        by_key = {}
        for p in pieces:
            by_key.setdefault(improve.piece_key(p), p.id)
        if improve.piece_key(c) not in by_key:
            return []
        made = []
        for look in session.scalars(select(SavedLook).where(SavedLook.user_id == u.id, SavedLook.wardrobe_id == c.wardrobe_id)):
            data = look.data
            needed = [p["key"] for p in data["pieces"]]
            if improve.piece_key(c) not in needed or not all(k in by_key for k in needed):
                continue
            cloth_ids = [*data["cloth_ids"], *(by_key[k] for k in needed)]
            items = [p for p in pieces if p.id in cloth_ids]
            if len(items) != len(cloth_ids) or not is_outfit(i.category for i in items):
                continue
            name = data.get("name") or f"{data['style']} look"
            scored = saved_score(items, data["style"])
            o = Outfit(
                wardrobe_id=c.wardrobe_id, name=name, style=data["style"], cloth_ids=cloth_ids,
                score=scored.get("score"), breakdown=scored.get("breakdown"),
                score_version=meaning.SCORE_VERSION if scored else None,
            )
            session.add(o)
            session.delete(look)
            made.append({"id": o.id, "name": name, "style": data["style"]})
        session.commit()
        return made
    except Exception:
        session.rollback()
        logger.warning("Couldn't complete saved looks", exc_info=True)
        return []


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
    looks = [
        look
        for look in session.scalars(select(SavedLook).where(SavedLook.user_id == u.id, SavedLook.wardrobe_id == wid))
        if cid in look.data.get("cloth_ids", [])
    ]
    for look in looks:
        session.delete(look)
    filename = c.image
    session.delete(c)
    session.commit()
    try:
        image_storage.delete(filename)
    except Exception:
        # The piece is already gone; an orphaned private photo is harmless.
        logger.error("Image cleanup failed after removing a piece")
    return {"ok": True, "removed_outfits": len(outfits), "removed_looks": len(looks)}


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
    # Checked before any ML call, so an incomplete wardrobe always gets this clear answer,
    # even while the ML service is unavailable.
    present = set(session.scalars(select(Cloth.category).where(Cloth.wardrobe_id == wid).distinct()))
    if not any(set(shape) <= present for shape in SHAPES):
        raise HTTPException(400, "Add a top, bottoms and shoes, or a dress and shoes")
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


# An outfit is 2 to 4 pieces: a dress and shoes, or a top, bottoms and shoes, each with an
# optional layer. Which combinations are valid is checked by outfit_pieces (matching.is_outfit).
OutfitIds = Field(min_length=2, max_length=4)


Style = Literal["Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"]


class Save(Name):
    style: Style
    cloth_ids: list[str] = OutfitIds


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
    outfits = list(session.scalars(select(Outfit).where(Outfit.wardrobe_id == wid)))
    # Every outfit's pieces in one query, not one per piece.
    wanted = {cid for o in outfits for cid in o.cloth_ids}
    pieces = {
        c.id: c for c in session.scalars(select(Cloth).where(Cloth.wardrobe_id == wid, Cloth.id.in_(wanted)))
    } if wanted else {}
    for o in outfits:
        items = [pieces.get(cid) for cid in o.cloth_ids]
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
WEIGHT_OF_WEATHER = 0.35


STYLES = ["Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"]


class Rate(BaseModel):
    cloth_ids: list[str] = OutfitIds
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
    # NaN and Infinity aren't places (JSON parsers accept them; the weather code would crash).
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
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
        w = weather.fetch_forecast(
            place.latitude, place.longitude, url=s.weather_api_url, fallback_url=s.weather_fallback_url,
            api_key=s.weather_api_key.get_secret_value(),
        )
    except weather.WeatherUnavailable as exc:
        # The providers and their errors for developers; a plain message for users.
        raise HTTPException(503, f"Weather unavailable: {exc}" if s.is_dev else "Weather is unavailable right now. Try again shortly.") from None
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
    limiter.take("weather", u.id)
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
def today_sample(place: SamplePlace, request: Request):
    """The same weather pick for the signed-out sample wardrobe (no photos, no embeddings).
    Open to anyone, so limited per address: each call can reach the weather and place services."""
    limiter.take("weather-public", client_ip(request, s.trusted_proxy_hops))
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


# ── Persona and suggestions ─────────────────────────────────────────────────
def optional_style_vectors():
    """Style vectors, or None while the ML service is down (Meaning then uses the tags alone)."""
    try:
        return style_vectors()
    except EmbeddingUnavailable:
        return None


def piece_row(c):
    return (c.id, c.category, c.garment or "", c.color, c.texture, c.style)


def reactions(uid, session):
    """Every reaction to a suggestion (all but "shown"), with the suggested outfit it's about if
    any, and how often each piece was shown."""
    rows = session.execute(
        select(SuggestionEvent.action, SuggestionEvent.key, SuggestionEvent.spec, SuggestionEvent.created_at, SuggestionEvent.context)
        .where(SuggestionEvent.user_id == uid, SuggestionEvent.action != "shown")
        .order_by(SuggestionEvent.created_at)
    ).all()
    events = [
        (action, key, spec, at, context.get("look") if isinstance(context, dict) else None)
        for action, key, spec, at, context in rows
    ]
    shown = session.execute(
        select(SuggestionEvent.key, func.count())
        .where(SuggestionEvent.user_id == uid, SuggestionEvent.action == "shown")
        .group_by(SuggestionEvent.key)
    ).all()
    return events, {key: n for key, n in shown}


def look_reactions(uid, session):
    """The latest reaction to each suggested outfit: {look key: action}."""
    latest = {}
    rows = session.execute(
        select(SuggestionEvent.action, SuggestionEvent.context)
        .where(SuggestionEvent.user_id == uid, SuggestionEvent.action.startswith("look_", autoescape=True))
        .order_by(SuggestionEvent.created_at)
    )
    for action, context in rows:
        if isinstance(context, dict) and context.get("look"):
            latest[context["look"]] = action
    return latest


def dismissed(uid, session):
    return frozenset(
        session.scalars(
            select(SuggestionEvent.key)
            .where(SuggestionEvent.user_id == uid, SuggestionEvent.action.in_(("dismissed", "owned")))
            .distinct()
        )
    )


def current_persona(u, session, vectors):
    """The user's persona, recomputed only when something it is derived from has changed."""
    mine = select(Wardrobe.id).where(Wardrobe.user_id == u.id)
    pieces = list(session.scalars(select(Cloth).where(Cloth.wardrobe_id.in_(mine))))
    outfits = list(session.scalars(select(Outfit).where(Outfit.wardrobe_id.in_(mine))))
    events, shown = reactions(u.id, session)
    feedback = {}
    for action, *_ in events:
        if not action.startswith("look_"):
            feedback[action] = feedback.get(action, 0) + 1
    # Outfits are counted once each, not once per new piece in them.
    for action in look_reactions(u.id, session).values():
        name = "outfits_" + action.removeprefix("look_")
        feedback[name] = feedback.get(name, 0) + 1
    learned = learning.learn(events, shown)
    # "Shown" events and time only move the weights a little: coarse() keeps those from
    # recomputing everything on every visit, while real reactions do.
    fp = taste.fingerprint(
        taste.VERSION, sorted(piece_row(c) for c in pieces), sorted((o.id, o.style) for o in outfits),
        u.wear, getattr(u, "styles", None), feedback, learning.coarse(learned), vectors is not None,
    )
    stored = getattr(u, "persona", None)
    if stored and stored.get("fingerprint") == fp:
        return stored
    u.persona = {
        **taste.derive(pieces, outfits, u.wear, vectors, feedback, learned, chosen=getattr(u, "styles", None)),
        "fingerprint": fp,
    }
    session.commit()
    return u.persona


def outfits_to_improve(pieces, saved_outfits, persona, vectors, rules, limit=24):
    """The outfits suggestions are measured on: the saved ones, then the best the wardrobe makes
    in each style the user wears most."""
    by_id = {c.id: c for c in pieces}
    found, seen = [], set()

    def add(outfit, items):
        signature = frozenset(c.id for c in items)
        if signature not in seen and len(found) < limit:
            seen.add(signature)
            found.append((outfit, items))

    for o in saved_outfits:
        items = [by_id.get(cid) for cid in o.cloth_ids]
        if all(items) and is_outfit(c.category for c in items) and o.style in meaning.AFFINITY:
            add({"cloth_ids": list(o.cloth_ids), "style": o.style, "source": "saved", "name": o.name}, items)
    for style in taste.top_styles(persona):
        semantic = meaning.piece_scores(pieces, style, vectors)
        pools = {}
        for category in ("tops", "pants", "dresses", "shoes", "jackets"):
            ranked = sorted((c for c in pieces if c.category == category), key=lambda c: semantic[c.id], reverse=True)
            if ranked:
                pools[category] = ranked[: rules["max_candidates"]]
        for r in rank(pools, semantic, rules, limit=4):
            add({"cloth_ids": [c.id for c in r["items"]], "style": style, "source": "generated", "name": None}, r["items"])
    return found


def stored_suggestions(wid, session):
    return list(session.scalars(
        select(Suggestion)
        .where(Suggestion.wardrobe_id == wid)
        .order_by(Suggestion.rank)
        .execution_options(populate_existing=True)  # as stored now, not as first loaded
    ))


def lock_wardrobe(wid, session):
    """Holds a PostgreSQL lock for this wardrobe until the transaction ends (any instance, any
    worker). Other databases (the SQLite tests) run one request at a time and skip it."""
    if session.get_bind().dialect.name == "postgresql":
        session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"suggestions:{wid}"})


def suggestion_context(w, u, session):
    """Everything both kinds of suggestions need, with the wardrobe-wide list kept up to date."""
    vectors = optional_style_vectors()
    persona = current_persona(u, session, vectors)
    pieces = list(session.scalars(select(Cloth).where(Cloth.wardrobe_id == w.id)))
    saved_outfits = list(session.scalars(select(Outfit).where(Outfit.wardrobe_id == w.id)))
    rules = s.rules
    exclude = dismissed(u.id, session) | {improve.piece_key(c) for c in pieces}
    calib = improve.calibration(pieces, vectors)

    def persona_fit(spec):
        return taste.fit(persona, spec, rules)

    def fit_for(style):
        return improve.virtual_fit(style, calib)

    fp = taste.fingerprint(
        improve.VERSION, meaning.SCORE_VERSION, persona["fingerprint"], sorted(piece_row(c) for c in pieces),
        sorted((o.id, o.style, list(o.cloth_ids)) for o in saved_outfits), sorted(exclude), rules,
    )
    rows = stored_suggestions(w.id, session)
    if not rows or any(r.fingerprint != fp for r in rows):
        # Two requests may find the list out of date at once (Next buys loading while an outfit's
        # details open). One recomputes while the other waits, then uses its result.
        lock_wardrobe(w.id, session)
        rows = stored_suggestions(w.id, session)
    if not rows or any(r.fingerprint != fp for r in rows):
        per_outfit, measured = [], []
        for outfit, items in outfits_to_improve(pieces, saved_outfits, persona, vectors, rules):
            semantic = meaning.piece_scores(items, outfit["style"], vectors)
            found = improve.improvements(
                items, outfit["style"], semantic, rules, fit_for(outfit["style"]), persona["wear"], exclude,
            )
            per_outfit.append((outfit, found))
            measured.append((outfit, items, semantic, found))
        ranked = improve.group(per_outfit, persona_fit, rules)
        suggested_looks = improve.looks(measured, persona_fit, rules, fit_for, persona["wear"], exclude)
        # One statement for whatever rows exist now, so a row already gone can't fail it.
        session.execute(delete(Suggestion).where(Suggestion.wardrobe_id == w.id))
        rows = [
            Suggestion(
                wardrobe_id=w.id, fingerprint=fp, rank=-1, key=improve.REACH_KEY, value=0,
                data={"reach": improve.reach(per_outfit), "considered": len(per_outfit)},
            ),
            Suggestion(
                wardrobe_id=w.id, fingerprint=fp, rank=-2, key=improve.LOOKS_KEY, value=0,
                data={"looks": suggested_looks},
            ),
            *(
                Suggestion(wardrobe_id=w.id, fingerprint=fp, rank=i, key=r["key"], value=r["value"], data=r)
                for i, r in enumerate(ranked)
            ),
        ]
        session.add_all(rows)
        session.commit()
    meta = next((r.data for r in rows if r.key == improve.REACH_KEY), {})
    stored_looks = next((r.data for r in rows if r.key == improve.LOOKS_KEY), {})
    return SimpleNamespace(
        vectors=vectors, persona=persona, rules=rules, exclude=exclude,
        persona_fit=persona_fit, fit_for=fit_for,
        ranked=[r.data for r in rows if r.key not in (improve.REACH_KEY, improve.LOOKS_KEY)],
        looks=stored_looks.get("looks", []),
        **{k: meta.get(k, d) for k, d in (("reach", {}), ("considered", 0))},
    )


def persona_json(p):
    return {k: v for k, v in p.items() if k != "fingerprint"}


@app.get("/me/persona")
def my_persona(u=Depends(user), session=Depends(db)):
    """The taste profile shown on the profile page."""
    return persona_json(current_persona(u, session, optional_style_vectors()))


@app.get("/wardrobes/{wid}/suggestions")
def wardrobe_suggestions(wid: str, u=Depends(user), session=Depends(db)):
    """Pieces worth buying for this wardrobe, ranked by what they add across its outfits."""
    w = owned(wid, u, session)
    ctx = suggestion_context(w, u, session)
    complete = any(set(shape) <= {c.category for c in session.scalars(select(Cloth).where(Cloth.wardrobe_id == wid))} for shape in SHAPES)
    # A few pieces to learn the user's taste from, mixed into the deck by the app: not ones already
    # suggested, owned, or reacted to.
    events, _ = reactions(u.id, session)
    seen = ctx.exclude | {r["key"] for r in ctx.ranked} | {key for _, key, *_ in events}
    seed = f"{u.id}|{wid}|{datetime.now(timezone.utc).date().isoformat()}"
    return {
        "persona": persona_json(ctx.persona),
        "suggestions": ctx.ranked,
        "explore": explore.picks(ctx.persona, seen, seed) if complete else [],
        # Whole outfits to swipe on, except those already saved or turned down.
        "looks": [look for look in ctx.looks if look["key"] not in look_reactions(u.id, session)],
        # How many outfits were measured (saved + best generated), and whether any can be made.
        "considered": ctx.considered,
        "complete": complete,
        "estimated": ctx.vectors is None,
    }


class Improve(BaseModel):
    cloth_ids: list[str] = Field(min_length=2, max_length=4)
    style: Style


@app.post("/wardrobes/{wid}/improve")
def improve_outfit(wid: str, body: Improve, u=Depends(user), session=Depends(db)):
    """The best pieces to swap in or add to this outfit, each with how many other outfits it helps."""
    w = owned(wid, u, session)
    items = outfit_pieces(wid, body.cloth_ids, session)
    ctx = suggestion_context(w, u, session)
    semantic = meaning.piece_scores(items, body.style, ctx.vectors)
    found = improve.improvements(
        items, body.style, semantic, ctx.rules, ctx.fit_for(body.style), ctx.persona["wear"], ctx.exclude,
    )
    best = improve.best_for_outfit(found, ctx.persona_fit, ctx.rules)
    return {
        "suggestions": [{**b, "outfits": ctx.reach.get(b["key"])} for b in best],
        "estimated": ctx.vectors is None,
    }


class EventSpec(BaseModel):
    category: Literal["tops", "pants", "shoes", "jackets", "dresses"]
    garment: str = Field(min_length=1, max_length=40)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    color_name: str = Field(min_length=1, max_length=30)
    texture: Literal["cotton", "denim", "knit", "leather", "linen", "silk", "other"]
    style: Style


class Event(BaseModel):
    action: Literal[
        "shown", "saved", "unsaved", "dismissed", "owned", "clicked", "bought",
        "look_saved", "look_unsaved", "look_dismissed", "look_owned",
    ]
    key: str = Field(max_length=120)
    spec: EventSpec
    source: Literal["outfit", "lab", "next-buys"]
    wardrobe_id: str | None = Field(None, max_length=40)
    gain: int | None = Field(None, ge=-100, le=100)
    position: int | None = Field(None, ge=0, le=50)
    cloth_ids: list[str] = Field(default_factory=list, max_length=4)
    # Shown to learn the user's taste (explore.py) rather than to improve an outfit.
    explore: bool = False
    # For a suggested outfit's events: the outfit (improve.look_key); one event per new piece.
    look: str | None = Field(None, max_length=600)


class Events(BaseModel):
    events: list[Event] = Field(min_length=1, max_length=50)


@app.post("/me/suggestion-events")
def record_events(body: Events, u=Depends(user), session=Depends(db)):
    """What the user did with suggestions; the persona learns from this history."""
    for e in body.events:
        if e.key != improve.key_of(e.spec.category, e.spec.garment, e.spec.color_name):
            raise HTTPException(422, "This suggestion doesn’t match its description")
        if e.action.startswith("look_") != bool(e.look):
            raise HTTPException(422, "Outfit reactions need the outfit they’re about")
        if e.wardrobe_id:
            owned(e.wardrobe_id, u, session)
        session.add(SuggestionEvent(
            user_id=u.id, wardrobe_id=e.wardrobe_id, action=e.action, key=e.key, spec=e.spec.model_dump(),
            context={"source": e.source, "gain": e.gain, "position": e.position, "cloth_ids": e.cloth_ids, "explore": e.explore, "look": e.look},
        ))
    session.commit()
    return {"ok": True, "recorded": len(body.events)}


@app.get("/me/wishlist")
def wishlist(u=Depends(user), session=Depends(db)):
    """Pieces the user saved from suggestions and hasn't taken off the list or said they own."""
    latest = {}
    rows = session.scalars(
        select(SuggestionEvent)
        .where(SuggestionEvent.user_id == u.id, SuggestionEvent.action.in_(("saved", "unsaved", "owned", "dismissed")))
        .order_by(SuggestionEvent.created_at)
    )
    for e in rows:
        latest[e.key] = e
    return [
        {
            "key": e.key,
            **improve.spec_of(e.spec["garment"], e.spec["color_name"], e.spec["style"]),
            "saved_at": e.created_at.isoformat(timespec="seconds") if e.created_at else None,
        }
        for e in sorted(latest.values(), key=lambda e: e.created_at or 0, reverse=True)
        if e.action == "saved" and e.spec.get("garment") in improve.TYPES and e.spec.get("color_name") in improve.COLOR_NAMES
    ]


class LookPiece(BaseModel):
    key: str = Field(max_length=120)
    spec: EventSpec
    replaces: str | None = Field(None, max_length=40)


class LookIn(BaseModel):
    kind: Literal["improved", "new"]
    style: Style
    source: Literal["saved", "generated"]
    name: str | None = Field(None, max_length=80, pattern=PLAIN_TEXT)
    cloth_ids: list[str] = Field(min_length=1, max_length=4)
    pieces: list[LookPiece] = Field(min_length=1, max_length=2)
    before: int = Field(ge=0, le=100)
    after: int = Field(ge=0, le=100)
    reason: str = Field("", max_length=300, pattern=r"^[^\x00-\x1f\x7f]*$")


class SaveLook(BaseModel):
    wardrobe_id: str = Field(max_length=40)
    look: LookIn


def saved_look_json(row, wardrobe, by_id):
    return {
        "id": row.id, "key": row.key, "wardrobe_id": wardrobe.id, "wardrobe": wardrobe.name,
        **row.data, "items": [cloth_json(by_id[cid]) for cid in row.data["cloth_ids"]],
    }


@app.get("/me/looks")
def saved_looks(u=Depends(user), session=Depends(db)):
    """Suggested outfits the user saved, with the pieces they own in each."""
    wardrobes = {w.id: w for w in session.scalars(select(Wardrobe).where(Wardrobe.user_id == u.id))}
    rows = list(session.scalars(select(SavedLook).where(SavedLook.user_id == u.id).order_by(SavedLook.created_at.desc())))
    ids = {cid for r in rows for cid in r.data["cloth_ids"]}
    by_id = {c.id: c for c in session.scalars(select(Cloth).where(Cloth.id.in_(ids)))} if ids else {}
    out, gone = [], []
    for r in rows:
        if r.wardrobe_id in wardrobes and all(cid in by_id for cid in r.data["cloth_ids"]):
            out.append(saved_look_json(r, wardrobes[r.wardrobe_id], by_id))
        else:
            # A piece it was built on was removed before removal took its outfits with it.
            gone.append(r)
    if gone:
        for r in gone:
            session.delete(r)
        session.commit()
    return out


@app.post("/me/looks")
def save_look(body: SaveLook, u=Depends(user), session=Depends(db)):
    """Saves a suggested outfit (from Next buys) to the Saved page."""
    w = owned(body.wardrobe_id, u, session)
    look = body.look
    for p in look.pieces:
        if p.key != improve.key_of(p.spec.category, p.spec.garment, p.spec.color_name) or p.spec.garment not in improve.TYPES:
            raise HTTPException(422, "This suggestion doesn’t match its description")
    kept = list(session.scalars(select(Cloth).where(Cloth.wardrobe_id == w.id, Cloth.id.in_(look.cloth_ids))))
    categories = [c.category for c in kept] + [p.spec.category for p in look.pieces]
    if len(kept) != len(set(look.cloth_ids)) or not is_outfit(categories):
        raise HTTPException(400, "This outfit isn’t made from this wardrobe’s pieces")
    pieces = [{"key": p.key, **improve.spec_of(p.spec.garment, p.spec.color_name, p.spec.style), "replaces": p.replaces} for p in look.pieces]
    key = improve.look_key(look.cloth_ids, pieces)
    row = session.scalar(select(SavedLook).where(SavedLook.user_id == u.id, SavedLook.key == key))
    if row is None:
        row = SavedLook(
            user_id=u.id, wardrobe_id=w.id, key=key,
            data={**look.model_dump(exclude={"pieces"}), "key": key, "pieces": pieces, "gain": look.after - look.before},
        )
        session.add(row)
        session.commit()
    return saved_look_json(row, w, {c.id: c for c in kept})


@app.delete("/me/looks/{look_id}")
def unsave_look(look_id: str, u=Depends(user), session=Depends(db)):
    row = session.get(SavedLook, look_id)
    if not row or row.user_id != u.id:
        raise HTTPException(404, "Saved outfit not found")
    session.delete(row)
    session.commit()
    return {"ok": True}


@app.delete("/me/suggestion-events")
def reset_taste(u=Depends(user), session=Depends(db)):
    """Forgets every reaction to suggestions; the persona goes back to the wardrobe alone."""
    rows = list(session.scalars(select(SuggestionEvent).where(SuggestionEvent.user_id == u.id)))
    for row in rows:
        session.delete(row)
    session.commit()
    return {"ok": True, "removed": len(rows)}


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
