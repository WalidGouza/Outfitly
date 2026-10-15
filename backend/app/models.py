from uuid import uuid4
from sqlalchemy import String, ForeignKey, JSON, Index
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
