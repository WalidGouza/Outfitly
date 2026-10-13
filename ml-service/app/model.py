"""CLIP image/text embeddings. This is the only module that imports PyTorch."""
from functools import lru_cache
from .config import settings

DIMENSIONS = 512


@lru_cache
def model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(settings().embedding_model)


def embed(value):
    vector = model().encode(value, normalize_embeddings=True).tolist()
    if len(vector) != DIMENSIONS:
        raise ValueError(f"Configured model must output {DIMENSIONS} dimensions")
    return vector
