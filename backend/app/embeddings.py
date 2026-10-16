"""Client for the separately hosted ML service (ml-service/), which runs CLIP.

The core API never imports PyTorch, so it fits on small hosts such as Render's
free tier. Both sides authenticate with a shared ML_SERVICE_TOKEN.
"""
import math
from functools import lru_cache
import httpx

DIMENSIONS = 512


class EmbeddingUnavailable(Exception):
    pass


class EmbeddingClient:
    def __init__(self, settings, transport=None, store=None):
        self.url = settings.ml_service_url
        self.token = settings.ml_service_token.get_secret_value()
        self.timeout = settings.ml_service_timeout
        self.transport = transport
        # Optional persistent store for text embeddings (text_cache.TextEmbeddingStore),
        # checked before the ML service so restarts don't trigger new paid requests.
        self.store = store
        # Generation queries come from a handful of fixed style prompts.
        self.text = lru_cache(maxsize=64)(self._text)
        # Attribute labels are fixed, so they are embedded once per process.
        self.texts = lru_cache(maxsize=8)(self._texts)
        # Analyse-then-save sends the same normalised JPEG twice; embed it once.
        self.image = lru_cache(maxsize=8)(self._image)

    @property
    def configured(self):
        return bool(self.url and self.token)

    def _image(self, jpeg: bytes):
        data = self._request("/embed/image", content=jpeg, headers={"Content-Type": "image/jpeg"})
        return self._vector(data.get("embedding"))

    def _text(self, value: str):
        stored = self.store.get([value]).get(value) if self.store else None
        if stored is not None:
            return self._vector(stored)
        vector = self._vector(self._request("/embed/text", json={"text": value}).get("embedding"))
        if self.store:
            self.store.put({value: vector})
        return vector

    def _texts(self, values: tuple[str, ...]):
        found = self.store.get(values) if self.store else {}
        missing = [v for v in dict.fromkeys(values) if v not in found]
        if missing:
            vectors = self._request("/embed/texts", json={"texts": missing}).get("embeddings")
            if not isinstance(vectors, list) or len(vectors) != len(missing):
                raise EmbeddingUnavailable("Image analysis service returned an invalid response")
            fresh = {text: self._vector(v) for text, v in zip(missing, vectors)}
            if self.store:
                self.store.put(fresh)
            found = {**found, **fresh}
        return [self._vector(found[v]) for v in values]

    def _request(self, path, headers=None, **body):
        if not self.configured:
            raise EmbeddingUnavailable(
                "Image analysis is not available yet: the ML service is not configured on the backend."
            )
        try:
            with httpx.Client(transport=self.transport, timeout=self.timeout, follow_redirects=False) as client:
                response = client.post(
                    self.url + path,
                    headers={"Authorization": f"Bearer {self.token}", **(headers or {})},
                    **body,
                )
        except httpx.HTTPError:
            raise EmbeddingUnavailable("Cannot reach the image analysis service. Try again shortly.") from None
        if response.status_code == 400:
            raise ValueError("Image could not be analysed")
        if not response.is_success:
            # Never echo upstream bodies; they may contain internal details.
            raise EmbeddingUnavailable(f"Image analysis service returned HTTP {response.status_code}")
        try:
            data = response.json()
        except ValueError:
            raise EmbeddingUnavailable("Image analysis service returned an invalid response") from None
        if not isinstance(data, dict):
            raise EmbeddingUnavailable("Image analysis service returned an invalid response")
        return data

    @staticmethod
    def _vector(value):
        try:
            vector = [float(x) for x in value]
        except (ValueError, TypeError):
            raise EmbeddingUnavailable("Image analysis service returned an invalid response") from None
        if len(vector) != DIMENSIONS or not all(math.isfinite(x) for x in vector):
            raise EmbeddingUnavailable("Image analysis service returned an invalid embedding")
        return vector
