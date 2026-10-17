from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from app import learning, main, persona
from app.config import settings

RULES = settings().rules
NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)
SNEAKERS = {"category": "shoes", "garment": "sneakers", "color_name": "White", "texture": "leather", "style": "Streetwear", "color": "#F5F5F5"}
HEELS = {"category": "shoes", "garment": "heels", "color_name": "Red", "texture": "leather", "style": "Evening", "color": "#C8232D"}


def event(action, spec, days_ago=0):
    key = f"{spec['category']}|{spec['garment']}|{spec['color_name']}"
    return (action, key, spec, NOW - timedelta(days=days_ago))


def base_persona(learned=None):
    p = persona.derive([], [], "both")
    p["styles"] = [{"name": "Streetwear", "share": 0.5}, {"name": "Evening", "share": 0.5}]
    if learned is not None:
        p["learned"] = learned
    return p


def test_one_save_is_a_small_nudge_not_a_verdict():
    learned = learning.learn([event("saved", SNEAKERS)], now=NOW)
    assert learned["weights"]["garment"]["sneakers"] == round(1 / (learning.PRIOR + 1), 3)
    assert learned["signals"] == 1
    # One reaction moves the ranking a little but isn't shown on the profile as a taste yet.
    assert learned["likes"] == []
    twice = learning.learn([event("saved", SNEAKERS), event("saved", SNEAKERS)], now=NOW)
    assert {"trait": "garment", "value": "sneakers", "weight": 0.4} in twice["likes"]


def test_reactions_move_the_persona_fit_both_ways():
    neutral = base_persona()
    learned = learning.learn([event("saved", SNEAKERS), event("added", SNEAKERS), event("dismissed", HEELS)], now=NOW)
    taught = base_persona(learned)
    assert persona.fit(taught, SNEAKERS, RULES) > persona.fit(neutral, SNEAKERS, RULES)
    assert persona.fit(taught, HEELS, RULES) < persona.fit(neutral, HEELS, RULES)
    assert learned["weights"]["garment"]["heels"] < 0 and learned["dislikes"] == []
    assert {"sneakers", "White"} <= {l["value"] for l in learned["likes"]}  # saved, then added: two reactions
    # A piece sharing only some traits moves less than the exact one.
    black_sneakers = {**SNEAKERS, "color_name": "Black", "color": "#191919"}
    gain_exact = persona.fit(taught, SNEAKERS, RULES) - persona.fit(neutral, SNEAKERS, RULES)
    gain_similar = persona.fit(taught, black_sneakers, RULES) - persona.fit(neutral, black_sneakers, RULES)
    assert 0 < gain_similar < gain_exact


def test_old_reactions_fade():
    fresh = learning.learn([event("saved", SNEAKERS)], now=NOW)["weights"]["garment"]["sneakers"]
    old = learning.learn([event("saved", SNEAKERS, days_ago=learning.HALF_LIFE_DAYS)], now=NOW)["weights"]["garment"]["sneakers"]
    assert old == round(0.5 / (learning.PRIOR + 0.5), 3) and old < fresh


def test_pieces_shown_again_and_again_without_a_reaction_count_as_ignored():
    assert learning.learn([], {"shoes|heels|Red": 4}, now=NOW)["weights"] == {}
    ignored = learning.learn([], {"shoes|heels|Red": 5}, now=NOW)["weights"]
    assert ignored["garment"]["heels"] < 0 and ignored["texture"]["leather"] < 0
    # Once the user reacted to it, showing it more says nothing new.
    reacted = learning.learn([event("saved", HEELS)], {"shoes|heels|Red": 50}, now=NOW)["weights"]
    assert reacted["garment"]["heels"] > 0


def test_fingerprints_ignore_tiny_changes_but_not_real_ones():
    base = learning.learn([event("saved", SNEAKERS)], {"shoes|heels|Red": 5}, now=NOW)
    one_more_view = learning.learn([event("saved", SNEAKERS)], {"shoes|heels|Red": 6}, now=NOW)
    a_day_later = learning.learn([event("saved", SNEAKERS)], {"shoes|heels|Red": 5}, now=NOW + timedelta(days=1))
    assert learning.coarse(base) == learning.coarse(one_more_view) == learning.coarse(a_day_later)
    dismissed = learning.learn([event("saved", SNEAKERS), event("dismissed", SNEAKERS)], now=NOW)
    assert learning.coarse(dismissed) != learning.coarse(base)


def test_learning_never_pushes_the_fit_outside_0_to_1():
    loved = learning.learn([event("added", SNEAKERS)] * 40, now=NOW)
    hated = learning.learn([event("dismissed", HEELS)] * 40, now=NOW)
    assert persona.fit(base_persona(loved), SNEAKERS, RULES) <= 1
    assert persona.fit(base_persona(hated), HEELS, RULES) >= 0


class UploadSession:
    def __init__(self, earlier):
        self.earlier, self.added, self.commits = earlier, [], 0

    def scalar(self, stmt):
        return self.earlier

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


def test_uploading_a_piece_we_suggested_is_recorded_as_followed():
    u = SimpleNamespace(id="u1")
    piece = SimpleNamespace(id="c9", wardrobe_id="w1", category="shoes", garment="sneakers", color="#F5F5F5")
    session = UploadSession(SimpleNamespace(spec=SNEAKERS))
    main.followed(u, piece, session)
    row = session.added[0]
    assert (row.action, row.key, row.context["source"]) == ("added", "shoes|sneakers|White", "upload")
    nothing = UploadSession(None)
    main.followed(u, piece, nothing)
    assert nothing.added == []
