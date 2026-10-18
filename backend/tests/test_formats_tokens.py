from io import BytesIO
from types import SimpleNamespace
import jwt
import pytest
from fastapi import HTTPException
from PIL import Image
from app import main


def photo(fmt, **save):
    out = BytesIO()
    Image.new("RGB", (40, 40), "blue").save(out, format=fmt, **save)
    return out.getvalue()


def upload(raw):
    return SimpleNamespace(file=BytesIO(raw))


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_jpeg_png_and_webp_photos_are_accepted(fmt):
    im, jpeg = main.load_image(upload(photo(fmt)))
    assert im.size == (40, 40) and jpeg[:2] == b"\xff\xd8"


def test_phone_jpegs_with_several_pictures_are_accepted():
    # Many phones save MPO: a JPEG with extra pictures inside. The JPEG reader opens it.
    second = Image.new("RGB", (40, 40), "red")
    raw = photo("MPO", save_all=True, append_images=[second])
    im, _ = main.load_image(upload(raw))
    assert im.size == (40, 40)


@pytest.mark.parametrize("fmt", ["GIF", "TIFF", "BMP", "ICO"])
def test_other_image_formats_are_refused(fmt):
    with pytest.raises(HTTPException) as refused:
        main.load_image(upload(photo(fmt)))
    assert refused.value.status_code == 400


def test_a_token_without_an_expiry_or_a_user_is_refused():
    secret = main.s.jwt_secret
    for claims in ({"sub": "u1"}, {"exp": 4102444800}):  # no expiry; no user
        token = jwt.encode(claims, secret, algorithm="HS256")
        with pytest.raises(jwt.MissingRequiredClaimError):
            main.read_token(token)
    assert main.read_token(main.token(SimpleNamespace(id="u1", session_version=0))["token"])["sub"] == "u1"
