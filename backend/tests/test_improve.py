from types import SimpleNamespace
from fastapi.testclient import TestClient
from app import improve, main, persona
from app.config import settings
from app.matching import score_combo

RULES = settings().rules


def piece(id, category, color, texture, style, garment, embedding=None):
    return SimpleNamespace(id=id, name=f"{garment} {id}", category=category, color=color, texture=texture,
                           style=style, garment=garment, embedding=embedding)


HOODIE = piece("h", "tops", "#191919", "cotton", "Streetwear", "hoodie")
JOGGERS = piece("j", "pants", "#808080", "cotton", "Streetwear", "joggers")
HEELS = piece("x", "shoes", "#C8232D", "silk", "Evening", "heels")  # the odd one out
OUTFIT = [HOODIE, JOGGERS, HEELS]
SEMANTIC = {c.id: 0.5 * 0.5 + 0.5 * (1 if c.style == "Streetwear" else 0.2) for c in OUTFIT}


def found(items=OUTFIT, wear="both", exclude=frozenset()):
    return improve.improvements(items, "Streetwear", SEMANTIC, RULES, improve.virtual_fit("Streetwear", None), wear, exclude)


def test_every_improvement_is_a_real_score_gain():
    results = found()
    assert results and all(r["gain"] >= improve.MIN_GAIN for r in results)
    r = next(r for r in results if r["replaces"] == "x")
    swapped = [HOODIE, JOGGERS, SimpleNamespace(id="suggested", **{k: r["spec"][k] for k in ("category", "garment", "color", "texture", "style")})]
    fit = improve.meaning.with_garment(improve.virtual_fit("Streetwear", None), r["spec"]["garment"], "Streetwear")
    after = score_combo(swapped, {**SEMANTIC, "suggested": fit}, RULES)
    assert r["gain"] == after["score"] - score_combo(OUTFIT, SEMANTIC, RULES)["score"]


def test_the_odd_piece_is_the_one_to_replace_first():
    best = improve.best_for_outfit(found(), lambda spec: 0.5, RULES)
    assert best[0]["replaces"] == "x" and best[0]["spec"]["category"] == "shoes"
    assert best[0]["reason"] and best[0]["title"][0].isupper()


def test_owned_and_dismissed_pieces_are_never_suggested():
    key = improve.best_for_outfit(found(), lambda spec: 0.5, RULES)[0]["key"]
    assert all(r["key"] != key for r in found(exclude=frozenset({key})))


def test_mens_wardrobes_get_no_womens_pieces():
    assert not any(improve.TYPES[r["spec"]["garment"]].women for r in found(wear="men"))
    assert any(improve.TYPES[r["spec"]["garment"]].women for r in found(wear="women"))


def test_a_suggested_piece_reads_its_meaning_from_the_users_own_photos():
    assert improve.virtual_fit("Minimal", None) == 1.0  # no photos: tags only, like every piece
    calib = {"Minimal": {"_all": 0.4, "Minimal": 0.8}}
    assert improve.virtual_fit("Minimal", calib) == 0.5 * 0.8 + 0.5 * 1.0
    assert improve.virtual_fit("Minimal", {"Minimal": {"_all": 0.4}}) == 0.5 * 0.4 + 0.5 * 1.0


def test_a_piece_that_helps_more_outfits_ranks_higher():
    second = [HOODIE, piece("j2", "pants", "#3C4046", "denim", "Streetwear", "jeans"), HEELS]
    sem = {**SEMANTIC, "j2": SEMANTIC["j"]}
    per_outfit = [
        ({"cloth_ids": [c.id for c in o], "style": "Streetwear", "source": "generated", "name": None},
         improve.improvements(o, "Streetwear", sem, RULES, 1.0, "both"))
        for o in (OUTFIT, second)
    ]
    ranked = improve.group(per_outfit, lambda spec: 0.5, RULES)
    top = ranked[0]
    assert top["outfits"] == 2 and len(top["examples"]) == 2
    # One garment per colour and fabric: beige loafers and beige flats score the same.
    looks = [(r["spec"]["category"], r["spec"]["color_name"], r["spec"]["texture"]) for r in ranked]
    assert len(looks) == len(set(looks))


def test_the_persona_reads_the_wardrobe_and_the_saved_outfits():
    p = persona.derive(OUTFIT, [SimpleNamespace(style="Streetwear")], "men")
    assert abs(sum(s["share"] for s in p["styles"]) - 1) < 0.01
    assert p["styles"][0]["name"] == "Streetwear" and p["wear"] == "men"
    assert p["summary"].startswith("Mostly streetwear")
    assert p["based_on"] == {"pieces": 3, "outfits": 1}
    street = {"style": "Streetwear", "color": "#191919", "texture": "cotton"}
    evening = {"style": "Evening", "color": "#191919", "texture": "cotton"}
    assert persona.fit(p, street, RULES) > persona.fit(p, evening, RULES)


def test_an_empty_wardrobe_has_a_friendly_persona():
    p = persona.derive([], [], None)
    assert p["styles"] == [] and p["wear"] == "both" and "Add a few pieces" in p["summary"]
    assert persona.top_styles(p) == ["Everyday"]


class EventSession:
    def __init__(self):
        self.added, self.commits = [], 0

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1


def test_suggestion_events_are_recorded_and_checked():
    session = EventSession()
    main.app.dependency_overrides[main.db] = lambda: session
    main.app.dependency_overrides[main.user] = lambda: SimpleNamespace(id="u1")
    try:
        client = TestClient(main.app)
        spec = {"category": "shoes", "garment": "sneakers", "color": "#F5F5F5", "color_name": "White",
                "texture": "leather", "style": "Streetwear"}
        ok = client.post("/me/suggestion-events", json={"events": [
            {"action": "dismissed", "key": "shoes|sneakers|White", "spec": spec, "source": "outfit", "gain": 4, "position": 0},
        ]})
        assert ok.status_code == 200 and ok.json()["recorded"] == 1
        row = session.added[0]
        assert (row.user_id, row.action, row.key) == ("u1", "dismissed", "shoes|sneakers|White")
        assert row.context["source"] == "outfit" and row.context["gain"] == 4
        wrong = client.post("/me/suggestion-events", json={"events": [
            {"action": "saved", "key": "shoes|heels|Red", "spec": spec, "source": "lab"},
        ]})
        assert wrong.status_code == 422
    finally:
        main.app.dependency_overrides.clear()


def test_reach_counts_every_piece_even_the_ones_the_list_leaves_out():
    other = [HOODIE, JOGGERS, piece("x2", "shoes", "#C8232D", "silk", "Evening", "heels")]
    first = found()
    second = improve.improvements(other, "Streetwear", {**SEMANTIC, "x2": SEMANTIC["x"]}, RULES, 1.0, "both")
    counts = improve.reach([({}, first), ({}, second), ({}, [])])
    assert counts and all(1 <= n <= 2 for n in counts.values())
    shared = {s["key"] for s in first} & {s["key"] for s in second}
    assert shared and all(counts[k] == 2 for k in shared)


def test_the_garment_type_counts_not_only_colour_and_fabric():
    # Same colour, fabric and tag: only the type differs, and the score now sees it.
    def shoes(garment):
        return piece("s", "shoes", "#F5F5F5", "leather", "Streetwear", garment)

    def outfit_score(garment):
        items = [HOODIE, JOGGERS, shoes(garment)]
        semantic = improve.meaning.piece_scores(items, "Streetwear")
        return score_combo(items, semantic, RULES)["score"]

    assert outfit_score("sneakers") > outfit_score("loafers") > outfit_score("heels")
    best = {r["spec"]["garment"] for r in found() if r["replaces"] == "x" and r["spec"]["color_name"] == "White"}
    gains = {r["spec"]["garment"]: r["gain"] for r in found() if r["replaces"] == "x" and r["spec"]["color_name"] == "White"}
    assert best and gains["sneakers"] > gains.get("flats", 0)


def test_garments_that_clash_lower_cohesion():
    from app import garments, meaning
    assert garments.pair("jeans", "sneakers", meaning.affinity) > 0.9
    assert garments.pair("hoodie", "dress shoes", meaning.affinity) < 0.4
    assert garments.pair("blazer", "jeans", meaning.affinity) == 0.85  # a classic, set explicitly
    assert garments.pair("hoodie", None, meaning.affinity) is None
    clash = [HOODIE, JOGGERS, piece("d", "shoes", "#191919", "leather", "Streetwear", "dress shoes")]
    fine = [HOODIE, JOGGERS, piece("k", "shoes", "#191919", "leather", "Streetwear", "sneakers")]
    assert meaning.cohesion(fine) > meaning.cohesion(clash)


def test_reasons_name_the_garments_in_plain_english():
    assert improve.plural("t-shirt") == "t-shirts" and improve.plural("jeans") == "jeans"
    assert improve.plural("midi dress") == "midi dresses" and improve.is_plural("sneakers")
    reasons = {b["spec"]["garment"]: b["reason"] for b in improve.best_for_outfit(found(), lambda spec: 0.5, RULES)}
    assert reasons["sneakers"] == "Sneakers suit streetwear better than heels, and go well with your hoodie."
    assert reasons["cropped jacket"] == "A cropped jacket suits streetwear, and goes well with your hoodie."
