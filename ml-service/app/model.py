"""CLIP image/text embeddings. This is the only module that imports PyTorch."""
from functools import lru_cache
from .config import settings

DIMENSIONS = 512


@lru_cache
def model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(settings().embedding_model)


def embed(value):
    return embed_many([value])[0]


def embed_many(values):
    vectors = model().encode(values, normalize_embeddings=True).tolist()
    if any(len(v) != DIMENSIONS for v in vectors):
        raise ValueError(f"Configured model must output {DIMENSIONS} dimensions")
    return vectors
