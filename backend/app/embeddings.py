from functools import lru_cache
from .config import settings


@lru_cache
def model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(settings().embedding_model)


def embed(value):
    vector = model().encode(value, normalize_embeddings=True).tolist()
    if len(vector) != 512:
        raise ValueError("Configured model must output 512 dimensions")
    return vector
