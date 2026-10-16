"""Persistent store for text embeddings (see models.TextEmbedding).

The phrases the app embeds are few and fixed, but the in-memory cache is lost whenever the
backend restarts (Render's free tier sleeps when idle), and every miss wakes the ML service
on Modal. Keeping them in PostgreSQL makes them a one-time cost per model.
A database problem never blocks a request: the client then simply asks the ML service.
"""
import logging
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from .models import TextEmbedding

logger = logging.getLogger(__name__)


class TextEmbeddingStore:
    def __init__(self, engine, model: str):
        self.engine = engine
        self.model = model

    def get(self, texts):
        """Stored vectors for the texts that have one."""
        try:
            with Session(self.engine) as session:
                rows = session.execute(
                    select(TextEmbedding.text, TextEmbedding.embedding).where(
                        TextEmbedding.model == self.model, TextEmbedding.text.in_(list(texts))
                    )
                ).all()
            return {text: [float(x) for x in vector] for text, vector in rows}
        except SQLAlchemyError:
            logger.warning("Text embedding cache unavailable; asking the ML service instead")
            return {}

    def put(self, vectors):
        if not vectors:
            return
        try:
            with Session(self.engine) as session:
                session.execute(
                    insert(TextEmbedding)
                    .values([{"model": self.model, "text": t, "embedding": v} for t, v in vectors.items()])
                    .on_conflict_do_nothing()
                )
                session.commit()
        except SQLAlchemyError:
            logger.warning("Could not store text embeddings; they will be requested again later")
