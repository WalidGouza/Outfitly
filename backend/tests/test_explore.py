from app import explore, persona
from app.garments import TYPES


def wardrobe_persona(learned=None, wear="both"):
    p = persona.derive([], [], wear)
    p["styles"] = [{"name": "Everyday", "share": 0.8}, {"name": "Minimal", "share": 0.2}]
    p["colors"] = [{"name": "Navy", "hex": "#1E284B", "share": 0.6}, {"name": "White", "hex": "#F5F5F5", "share": 0.4}]
    if learned is not None:
        p["learned"] = learned
    return p


def test_picks_are_varied_and_lean_towards_what_the_user_does_not_wear():
    picks = explore.picks(wardrobe_persona(), frozenset(), "seed")
    assert len(picks) == explore.COUNT
    assert all(p["explore"] and p["examples"] == [] and p["best_gain"] == 0 for p in picks)
    for trait in ("style", "category", "color_name"):
        assert len({p["spec"][trait] for p in picks}) == len(picks)
    # Mostly styles outside the user's main one.
    assert sum(p["spec"]["style"] != "Everyday" for p in picks) >= explore.COUNT - 1


def test_picks_are_stable_for_a_seed_and_change_with_it():
    p = wardrobe_persona()
    first = [x["key"] for x in explore.picks(p, frozenset(), "user|day-1")]
    assert first == [x["key"] for x in explore.picks(p, frozenset(), "user|day-1")]
    days = {tuple(x["key"] for x in explore.picks(p, frozenset(), f"user|day-{d}")) for d in range(6)}
    assert len(days) > 1


def test_picks_skip_excluded_pieces_and_turned_down_traits():
    p = wardrobe_persona()
    first = explore.picks(p, frozenset(), "seed")
    again = explore.picks(p, frozenset(x["key"] for x in first), "seed")
    assert not {x["key"] for x in first} & {x["key"] for x in again}

    no_red = {"weights": {"color_name": {"Red": -0.6}}}
    for seed in range(10):
        assert all(x["spec"]["color_name"] != "Red" for x in explore.picks(wardrobe_persona(no_red), frozenset(), seed))


def test_picks_respect_what_the_user_wears():
    for seed in range(10):
        assert not any(TYPES[x["spec"]["garment"]].women for x in explore.picks(wardrobe_persona(wear="men"), frozenset(), seed))

