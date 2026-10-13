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
