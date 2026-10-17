from uuid import uuid4
from datetime import datetime, timezone
from sqlalchemy import DateTime, Float, String, ForeignKey, JSON, Index, Integer
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from pgvector.sqlalchemy import Vector


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str] = mapped_column(String)
    # Optional profile: a display name and a profile photo (stored like piece photos).
    username: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar: Mapped[str | None] = mapped_column(String, nullable=True)
    # Which clothes the app offers: "women", "men" or "both" (null is treated as both).
    wear: Mapped[str | None] = mapped_column(String, nullable=True)
    # Styles the user picked when they first signed in: the persona's starting point before the
    # wardrobe says more. Null = never asked (the app asks), [] = skipped.
    styles: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Taste derived from the wardrobe (persona.derive), with the fingerprint it was computed for.
    persona: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Wardrobe(Base):
    __tablename__ = "wardrobes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String)


class Cloth(Base):
    __tablename__ = "clothes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    wardrobe_id: Mapped[str] = mapped_column(ForeignKey("wardrobes.id"), index=True)
    name: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    texture: Mapped[str] = mapped_column(String)
    style: Mapped[str] = mapped_column(String)
    color: Mapped[str] = mapped_column(String)
    # Garment type within the category ("hoodie", "shorts"; see attributes.GARMENTS).
    # Optional: pieces added before types existed have none.
    garment: Mapped[str | None] = mapped_column(String, nullable=True)
    image: Mapped[str] = mapped_column(String)
    embedding: Mapped[list] = mapped_column(Vector(512))
    __table_args__ = (
        Index(
            "clothes_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


class Outfit(Base):
    __tablename__ = "outfits"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    wardrobe_id: Mapped[str] = mapped_column(ForeignKey("wardrobes.id"), index=True)
    name: Mapped[str] = mapped_column(String)
    style: Mapped[str] = mapped_column(String)
    cloth_ids: Mapped[list] = mapped_column(JSON)
    # Match score stored when saved, so listing saved outfits never needs the ML service.
    # Null for outfits saved before scores were stored (filled in on first listing).
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    breakdown: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Which scoring formula produced `score` (meaning.SCORE_VERSION); older ones are rescored.
    score_version: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TextEmbedding(Base):
    """Embeddings of the app's fixed phrases (style prompts, weather queries, detection labels),
    kept across restarts so they are paid for on the ML service only once per model."""

    __tablename__ = "text_embeddings"
    model: Mapped[str] = mapped_column(String, primary_key=True)
    text: Mapped[str] = mapped_column(String, primary_key=True)
    embedding: Mapped[list] = mapped_column(Vector(512))


def now():
    return datetime.now(timezone.utc)


class Suggestion(Base):
    """A piece worth buying for a wardrobe, ranked by what it adds across its outfits (improve.group).

    Recomputed when the wardrobe, its saved outfits or the persona change (`fingerprint`).
    """

    __tablename__ = "suggestions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    wardrobe_id: Mapped[str] = mapped_column(ForeignKey("wardrobes.id"), index=True)
    fingerprint: Mapped[str] = mapped_column(String)
    rank: Mapped[int] = mapped_column(Integer)
    key: Mapped[str] = mapped_column(String)
    value: Mapped[float] = mapped_column(Float)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SuggestionEvent(Base):
    """What a user did with a suggestion: the history the persona will learn from.

    action: shown | saved | dismissed | owned | clicked | bought. `spec` is the suggested piece,
    `context` where it was shown (source, outfit, gain, position).
    """

    __tablename__ = "suggestion_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    wardrobe_id: Mapped[str | None] = mapped_column(String, nullable=True)
    action: Mapped[str] = mapped_column(String)
    key: Mapped[str] = mapped_column(String)
    spec: Mapped[dict] = mapped_column(JSON)
    context: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
