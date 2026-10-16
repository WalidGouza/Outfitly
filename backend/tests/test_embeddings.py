import json
from types import SimpleNamespace
import httpx
import pytest
from pydantic import SecretStr
from app.embeddings import EmbeddingClient, EmbeddingUnavailable

TOKEN = "t" * 40


def client(handler, url="https://ml.example.com"):
    config = SimpleNamespace(ml_service_url=url, ml_service_token=SecretStr(TOKEN), ml_service_timeout=5)
    return EmbeddingClient(config, transport=httpx.MockTransport(handler))


def test_sends_token_and_returns_vector():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"embedding": [0.1] * 512})

    c = client(handler)
    assert c.image(b"\xff\xd8jpeg") == [0.1] * 512
    assert calls[0].url == "https://ml.example.com/embed/image"
    assert calls[0].headers["authorization"] == f"Bearer {TOKEN}"
    assert calls[0].headers["content-type"] == "image/jpeg"
    c.text("A Minimal outfit")
    c.text("A Minimal outfit")
    assert json.loads(calls[1].content) == {"text": "A Minimal outfit"}
    assert len(calls) == 2, "repeated style prompts are cached"


def test_unconfigured_service_is_unavailable_without_network():
    c = client(lambda request: pytest.fail("no request expected"), url="")
    with pytest.raises(EmbeddingUnavailable, match="not configured"):
        c.image(b"jpeg")


@pytest.mark.parametrize("response", [
    httpx.Response(502),
    httpx.Response(200, json={"embedding": [0.1] * 10}),
    httpx.Response(200, json={"embedding": ["nan"] * 512}),
    httpx.Response(200, text="not json"),
])
def test_bad_upstream_responses_are_unavailable(response):
    with pytest.raises(EmbeddingUnavailable):
        client(lambda request: response).text("x")


def test_unreachable_service_is_unavailable():
    def handler(request):
        raise httpx.ConnectError("down")

    with pytest.raises(EmbeddingUnavailable, match="Cannot reach"):
        client(handler).image(b"jpeg")


def test_rejected_image_is_a_client_error():
    with pytest.raises(ValueError):
        client(lambda request: httpx.Response(400)).image(b"jpeg")


def test_label_batches_and_images_are_cached():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/embed/texts":
            return httpx.Response(200, json={"embeddings": [[0.1] * 512] * len(json.loads(request.content)["texts"])})
        return httpx.Response(200, json={"embedding": [0.1] * 512})

    c = client(handler)
    assert len(c.texts(("a", "b"))) == 2
    c.texts(("a", "b"))
    c.image(b"same-jpeg")
    c.image(b"same-jpeg")
    assert calls == ["/embed/texts", "/embed/image"]


def test_mismatched_batch_is_unavailable():
    c = client(lambda request: httpx.Response(200, json={"embeddings": [[0.1] * 512]}))
    with pytest.raises(EmbeddingUnavailable):
        c.texts(("a", "b"))


class Store:
    """In-memory stand-in for text_cache.TextEmbeddingStore."""

    def __init__(self, saved=None):
        self.saved = dict(saved or {})
        self.puts = 0

    def get(self, texts):
        return {t: self.saved[t] for t in texts if t in self.saved}

    def put(self, vectors):
        self.puts += 1
        self.saved.update(vectors)


def stored_client(handler, store):
    config = SimpleNamespace(ml_service_url="https://ml.example.com", ml_service_token=SecretStr(TOKEN), ml_service_timeout=5)
    return EmbeddingClient(config, transport=httpx.MockTransport(handler), store=store)


def test_stored_texts_survive_a_restart_without_new_requests():
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        if request.url.path == "/embed/texts":
            return httpx.Response(200, json={"embeddings": [[0.2] * 512 for _ in calls[-1]["texts"]]})
        return httpx.Response(200, json={"embedding": [0.1] * 512})

    store = Store()
    first = stored_client(handler, store)
    first.text("A Minimal outfit")
    first.texts(("label a", "label b"))
    assert len(calls) == 2 and store.puts == 2
    # A new client is what a backend restart looks like: empty memory, same database.
    restarted = stored_client(handler, store)
    assert restarted.text("A Minimal outfit") == [0.1] * 512
    assert restarted.texts(("label a", "label b")) == [[0.2] * 512] * 2
    assert len(calls) == 2, "nothing is requested again after a restart"


def test_only_missing_labels_are_requested():
    calls = []

    def handler(request):
        calls.append(json.loads(request.content)["texts"])
        return httpx.Response(200, json={"embeddings": [[0.3] * 512 for _ in calls[-1]]})

    c = stored_client(handler, Store({"known": [0.9] * 512}))
    assert c.texts(("known", "new")) == [[0.9] * 512, [0.3] * 512]
    assert calls == [["new"]]
