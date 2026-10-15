from types import SimpleNamespace
import pytest
import reembed
from app import attributes
from app.embeddings import EmbeddingUnavailable


def piece(id, category="tops", garment=None, image=None):
    return SimpleNamespace(id=id, name=id, category=category, garment=garment, image=image or f"{id}.jpg", embedding=[0.0] * 512)


class Session:
    def __init__(self, pieces):
        self.pieces, self.commits = pieces, 0

    def scalars(self, query):
        return iter(self.pieces)

    def commit(self):
        self.commits += 1


class Storage:
    def __init__(self, missing=()):
        self.missing = set(missing)

    def read(self, filename):
        if filename in self.missing:
            raise FileNotFoundError(filename)
        return filename.encode()


def one_hot(i):
    return [1.0 if j == i else 0.0 for j in range(512)]


class Embeddings:
    """Image vectors point at the "hoodie" label, so type detection has a clear answer."""

    def __init__(self, unreadable=(), down=False):
        self.unreadable, self.down = set(unreadable), down
        garments, prompts = attributes._labels()
        self.hoodie = next(i for i, (c, g, _) in enumerate(garments) if g == "hoodie")
        self.prompts = prompts

    def image(self, jpeg):
        if self.down:
            raise EmbeddingUnavailable("Cannot reach the image analysis service.")
        if jpeg.decode() in self.unreadable:
            raise ValueError("bad image")
        return one_hot(self.hoodie)

    def texts(self, prompts):
        return [one_hot(i) for i in range(len(prompts))]


def test_reembeds_every_piece_and_saves_each_one():
    pieces = [piece("a"), piece("b")]
    session = Session(pieces)
    counts = reembed.reembed(session, Storage(), Embeddings(), log=lambda m: None)
    assert counts == {"updated": 2, "typed": 0, "missing": 0, "failed": 0}
    assert session.commits == 2 and all(p.embedding[0] == 0.0 and sum(p.embedding) == 1.0 for p in pieces)


def test_missing_and_unreadable_photos_are_skipped_not_fatal():
    pieces = [piece("gone"), piece("bad"), piece("ok")]
    counts = reembed.reembed(Session(pieces), Storage(missing={"gone.jpg"}), Embeddings(unreadable={"bad.jpg"}), log=lambda m: None)
    assert counts == {"updated": 1, "typed": 0, "missing": 1, "failed": 1}


def test_fill_types_only_touches_pieces_without_one_and_stays_in_category():
    untyped, typed, shoe = piece("a"), piece("b", garment="shirt"), piece("c", category="shoes")
    counts = reembed.reembed(Session([untyped, typed, shoe]), Storage(), Embeddings(), fill_types=True, log=lambda m: None)
    assert untyped.garment == "hoodie" and typed.garment == "shirt"
    # A shoe is never given a top's type, even when the photo looks like a hoodie.
    assert shoe.garment in attributes.GARMENTS["shoes"]
    assert counts["typed"] == 2


def test_dry_run_writes_nothing():
    p = piece("a")
    session = Session([p])
    counts = reembed.reembed(session, Storage(), Embeddings(), fill_types=True, dry_run=True, log=lambda m: None)
    assert counts["updated"] == 1 and session.commits == 0 and p.garment is None and sum(p.embedding) == 0


def test_ml_outage_stops_the_run():
    with pytest.raises(EmbeddingUnavailable):
        reembed.reembed(Session([piece("a")]), Storage(), Embeddings(down=True), log=lambda m: None)
