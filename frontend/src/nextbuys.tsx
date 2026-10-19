// Next buys: the pieces that would do the most for the whole wardrobe, and whole outfits to try.
//
// Signed in, the list is the backend's (GET /wardrobes/{id}/suggestions): every saved outfit and
// the best outfits in the user's main styles are tried with pieces they don't own, and pieces are
// ranked by what they add across all of them, weighted by the persona. The same outfits, with
// their best swap in (or taken further with a second new piece), come back as outfit cards. The
// sample wardrobe gets the same ideas computed in the browser (suggest.ts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { colorName } from "./colors";
import { categories, styles, type Category, type Piece, type Store, type Wear } from "./store";
import type { App } from "./screens";
import {
  interleave,
  localExplore,
  localLooks,
  localNextBuys,
  recordSuggestions,
  type BuyExample,
  type LookPiece,
  type NextBuy,
  type NextBuysResult,
  type SuggestedLook,
  type SuggestionAction,
  type WishItem,
} from "./suggest";
import { Icon, PieceArt, Seg, ordered } from "./ui";

const DEMO_WISHLIST = "outfitly-demo-wishlist";
const DEMO_LOOKS = "outfitly-demo-looks";
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const LABEL: Record<Category, string> = { tops: "Tops", pants: "Bottoms", dresses: "Dresses", shoes: "Shoes", jackets: "Layers" };

/** A suggested outfit the user saved, with the owned pieces it's made of. */
export type SavedLook = SuggestedLook & { id: string; wardrobe_id: string; wardrobe: string; items: Piece[] };

/** A suggested piece drawn like an owned one (no photo: the garment's shape in its colour). */
export const asPiece = (b: { key: string; title: string; spec: NextBuy["spec"] }): Piece => ({
  id: b.key, name: b.title, category: b.spec.category, color: b.spec.color, texture: b.spec.texture, style: b.spec.style, garment: b.spec.garment, image: null,
});

/** What a suggested outfit is called on its card. */
export const lookTitle = (l: SuggestedLook) =>
  l.name ? `“${l.name}”, upgraded` : l.kind === "new" ? `A new ${l.style.toLowerCase()} look` : `Your ${l.style.toLowerCase()} outfit, upgraded`;

/** "Add an olive cotton t-shirt", "Add 2 pieces: …". */
const toAdd = (pieces: LookPiece[]) =>
  pieces.length === 1 ? `Add: ${pieces[0].title.toLowerCase()}` : `Add ${pieces.length} pieces: ${pieces.map((p) => p.title.toLowerCase()).join(" and ")}`;

function readDemo<T>(name: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(name) || "[]");
  } catch {
    return [];
  }
}
function writeDemo<T>(name: string, list: T[]) {
  try {
    localStorage.setItem(name, JSON.stringify(list));
  } catch {
    // Private windows can refuse storage; the list still works for this visit.
  }
}

/** The wardrobe's Next buys and what's been saved from them, kept up to date as the wardrobe
 *  changes. Owned by the app (main.tsx), so Home can announce new ideas before the page is opened. */
export function useNextBuys(store: Store, wear: Wear) {
  const { demo, wid, call } = store;
  const [result, setResult] = useState<NextBuysResult | null>(null);
  const [error, setError] = useState("");
  const [wishlist, setWishlist] = useState<WishItem[]>([]);
  const [savedLooks, setSavedLooks] = useState<SavedLook[]>([]);
  // Cards decided on this session, kept here so they stay out of the deck when the page is
  // opened again before the suggestions are next fetched.
  const [hidden, setHidden] = useState<string[]>([]);
  const changes = `${store.pieces.map((p) => p.id).join()}|${store.saved.map((l) => l.id).join()}`;

  useEffect(() => {
    let active = true;
    setError("");
    if (demo) {
      // The sample wardrobe: its saved looks plus the best outfits in its three main styles.
      const counts = new Map<string, number>();
      for (const p of store.pieces) counts.set(p.style, (counts.get(p.style) ?? 0) + 1);
      const main = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);
      Promise.all(main.map((style) => store.generate({ style, harmony: "balanced", includeJacket: true, anchorId: "" })))
        .then((lists) => {
          if (!active) return;
          const outfits = [
            ...store.saved.map((l) => ({ items: l.items, style: l.style, source: "saved" as const, name: l.name ?? null })),
            ...lists.flatMap((looks) => looks.slice(0, 4).map((l) => ({ items: l.items, style: l.style, source: "generated" as const, name: null }))),
          ];
          const suggestions = localNextBuys(outfits, store.pieces, wear);
          const known = new Set([...suggestions.map((s) => s.key), ...store.pieces.map((p) => `${p.category}|${p.garment ?? ""}|${colorName(p.color)}`)]);
          const explore = outfits.length ? localExplore(store.pieces, wear, known, new Date().toDateString(), styles) : [];
          const looks = localLooks(outfits, store.pieces, wear);
          setResult({ suggestions, explore, looks, considered: outfits.length, complete: outfits.length > 0, estimated: true });
          setWishlist(readDemo<WishItem>(DEMO_WISHLIST));
          setSavedLooks(readDemo<SavedLook>(DEMO_LOOKS));
        })
        .catch((e) => active && setError((e as Error).message));
    } else if (wid) {
      Promise.all([call<NextBuysResult>(`/wardrobes/${wid}/suggestions`), call<WishItem[]>("/me/wishlist"), call<SavedLook[]>("/me/looks")])
        .then(([r, w, l]) => {
          if (!active) return;
          setResult(r);
          setWishlist(w);
          setSavedLooks(l);
        })
        .catch((e) => active && setError((e as Error).message));
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `changes` stands for the wardrobe's contents
  }, [demo, wid, call, changes, wear]);
  return { result, error, wishlist, setWishlist, savedLooks, setSavedLooks, hidden, setHidden };
}
export type NextBuysState = ReturnType<typeof useNextBuys>;

type Reportable = { key: string; spec: NextBuy["spec"]; best_gain?: number; explore?: boolean };

/** Saving, taking off Saved and "I own this", for suggested pieces and outfits: shared by Next
 *  buys and the Saved page, so both record the same reactions. */
export function useWishActions(app: App) {
  const { demo, wid, call } = app.store;
  const { wishlist, setWishlist, savedLooks, setSavedLooks, setHidden } = app.nextBuys;
  const report = (action: SuggestionAction, item: Reportable) => {
    if (!demo) recordSuggestions(call, action, [{ ...item, gain: item.best_gain }], { source: "next-buys", wid });
  };
  /** An outfit's reaction teaches through each new piece in it (learning.py). */
  const reportLook = (action: SuggestionAction, look: SuggestedLook, wardrobe = wid) => {
    if (!demo) recordSuggestions(call, action, look.pieces.map((p) => ({ key: p.key, spec: p.spec, gain: look.gain, look: look.key })), { source: "next-buys", wid: wardrobe });
  };
  const keep = (next: WishItem[]) => {
    setWishlist(next);
    if (demo) writeDemo(DEMO_WISHLIST, next);
  };
  const keepLooks = (next: SavedLook[]) => {
    setSavedLooks(next);
    if (demo) writeDemo(DEMO_LOOKS, next);
  };
  const save = (item: NextBuy) => {
    keep([{ key: item.key, spec: item.spec, query: item.query, title: item.title }, ...wishlist]);
    report("saved", item);
  };
  const unsave = (item: NextBuy | WishItem) => {
    keep(wishlist.filter((w) => w.key !== item.key));
    report("unsaved", item);
  };
  const addOwned = (item: { title: string; spec: NextBuy["spec"] }) =>
    // Straight to adding it, with what we already know filled in; the photo decides the rest.
    app.addSuggested({ name: item.title, category: item.spec.category, garment: item.spec.garment, texture: item.spec.texture, style: item.spec.style, color: item.spec.color });
  const own = (item: NextBuy | WishItem) => {
    setHidden((h) => [...h, item.key]);
    keep(wishlist.filter((w) => w.key !== item.key));
    report("owned", item);
    addOwned(item);
  };

  const saveLook = async (look: SuggestedLook) => {
    reportLook("look_saved", look);
    const w = app.store.wardrobes.find((x) => x.id === wid);
    if (demo || !wid) {
      const items = look.cloth_ids.map((id) => app.store.pieces.find((p) => p.id === id)).filter(Boolean) as Piece[];
      keepLooks([{ ...look, id: look.key, wardrobe_id: wid ?? "", wardrobe: w?.name ?? "", items }, ...savedLooks.filter((l) => l.key !== look.key)]);
      return;
    }
    const saved = await call<SavedLook>("/me/looks", "POST", { wardrobe_id: wid, look });
    setSavedLooks((list) => [saved, ...list.filter((l) => l.key !== saved.key)]);
  };
  const unsaveLook = async (look: SavedLook) => {
    reportLook("look_unsaved", look, look.wardrobe_id);
    keepLooks(savedLooks.filter((l) => l.key !== look.key));
    if (!demo) await call(`/me/looks/${look.id}`, "DELETE");
  };
  /** Up on an outfit card: the user already has its new piece(s); adding starts with the first. */
  const ownLook = (look: SuggestedLook) => {
    setHidden((h) => [...h, look.key]);
    reportLook("look_owned", look);
    addOwned(look.pieces[0]);
  };
  /** One new piece of a saved outfit is in fact owned: add it (to the outfit's wardrobe), and the
   *  outfit completes itself once all its pieces are in. */
  const ownLookPiece = (look: SavedLook, piece: LookPiece) => {
    if (!demo) recordSuggestions(call, "owned", [{ key: piece.key, spec: piece.spec }], { source: "next-buys", wid: look.wardrobe_id });
    if (look.wardrobe_id && look.wardrobe_id !== wid) app.store.selectWardrobe(look.wardrobe_id);
    addOwned(piece);
  };
  return { report, reportLook, save, unsave, own, saveLook, unsaveLook, ownLook, ownLookPiece };
}

/** A card in the deck: a piece to buy, or a whole outfit. */
type DeckCard = { key: string; title: string; piece?: NextBuy; look?: SuggestedLook };
type Filter = "all" | "outfits" | Category;

export function NextBuys({ app }: { app: App }) {
  const { demo } = app.store;
  const { result, error, wishlist, savedLooks, hidden, setHidden } = app.nextBuys;
  const { report, reportLook, save, unsave, own, saveLook, unsaveLook, ownLook } = useWishActions(app);
  const [filter, setFilter] = useState<Filter>("all");
  const [back, setBack] = useState<{ key: string; dir: Swipe } | null>(null);
  // The deck holds the ideas still to decide on (not hidden or already saved): pieces, a few to
  // learn the user's taste from, and whole outfits made from pieces still in the wardrobe.
  const all = useMemo(() => {
    const decided = new Set([...hidden, ...wishlist.map((w) => w.key), ...savedLooks.map((l) => l.key)]);
    const owned = new Set(app.store.pieces.map((p) => p.id));
    const pieces: DeckCard[] = interleave(result?.suggestions ?? [], result?.explore ?? [], 3).map((p) => ({ key: p.key, title: p.title, piece: p }));
    const looks: DeckCard[] = (result?.looks ?? []).filter((l) => l.cloth_ids.every((id) => owned.has(id))).map((l) => ({ key: l.key, title: lookTitle(l), look: l }));
    return interleave(pieces, looks, 4).filter((c) => !decided.has(c.key));
  }, [result, hidden, wishlist, savedLooks, app.store.pieces]);
  const present = categories.map((c) => c.key).filter((c) => all.some((s) => s.piece?.spec.category === c));
  const hasLooks = all.some((c) => c.look);
  const deck = all.filter((c) => filter === "all" || (filter === "outfits" ? c.look : c.piece?.spec.category === filter));
  const bestKey = result?.suggestions[0]?.key;
  const top = deck[0];

  // Each piece counts as shown once it reaches the top of the deck.
  useEffect(() => {
    if (top?.piece) report("shown", top.piece);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per card on top
  }, [top?.key]);

  // "Not for me" teaches the persona, so it's held back while the toast offers Undo, then sent
  // (or sent at once when another card is swiped, or when the page is left).
  const pending = useRef<{ key: string; send: () => void; timer: number } | null>(null);
  const commit = useRef(() => {});
  commit.current = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    p.send();
  };
  useEffect(() => () => commit.current(), []);

  /** Not for me: out of the deck now, sent once Undo has had its chance. */
  const dismiss = (card: DeckCard, dir: Swipe) => {
    setHidden((h) => [...h, card.key]);
    const send = () => (card.look ? reportLook("look_dismissed", card.look) : report("dismissed", card.piece!));
    pending.current = { key: card.key, send, timer: window.setTimeout(() => commit.current(), 4500) };
    app.toast({
      kind: "Not for me",
      text: demo ? "Hidden for this visit" : card.look ? "Outfitly learns from it" : "We won’t suggest it again",
      tone: "plain",
      action: {
        label: "Undo",
        run: () => {
          if (pending.current?.key !== card.key) return;
          clearTimeout(pending.current.timer);
          pending.current = null;
          setBack({ key: card.key, dir });
          setHidden((h) => h.filter((k) => k !== card.key));
        },
      },
    });
  };
  const decide = (card: DeckCard, dir: Swipe) => {
    commit.current();
    setBack(null);
    if (dir === "left") return dismiss(card, dir);
    if (card.look) {
      const look = card.look;
      if (dir === "up") return ownLook(look);
      saveLook(look).catch((e) => app.toast({ kind: "Not saved", text: (e as Error).message, tone: "plain" }));
      app.toast({
        kind: "Saved",
        text: "The outfit is in Saved",
        action: {
          label: "Undo",
          run: () => {
            const saved = latest.current.savedLooks.find((l) => l.key === look.key);
            if (saved) {
              setBack({ key: look.key, dir });
              latest.current.unsaveLook(saved).catch(() => {});
            }
          },
        },
      });
      return;
    }
    const item = card.piece!;
    if (dir === "up") return own(item);
    save(item);
    app.toast({
      kind: "Saved",
      text: `${item.title} is in Saved`,
      action: { label: "Undo", run: () => { setBack({ key: item.key, dir }); latest.current.unsave(item); } },
    });
  };
  // Undo runs from the toast, after later renders: it reads the lists as they are then.
  const latest = useRef({ unsave, unsaveLook, savedLooks });
  latest.current = { unsave, unsaveLook, savedLooks };

  const summary = !result
    ? "Finding the pieces that would do the most for your outfits…"
    : !all.length
      ? "Pieces you don’t own yet that would make your outfits better."
      : "Swipe right to save, left if it’s not for you, up if you already own it.";

  return (
    <div className="next">
      <div className="page-head__text">
        <h1 className="t-large">Next buys</h1>
        <p className="t-sub">{summary}</p>
      </div>

      {error && (
        <p role="alert" className="note note--error">
          {error}
        </p>
      )}

      {result && !result.complete ? (
        <div className="card card--pad empty">
          <p className="t-foot muted">Add a top, bottoms and shoes (or a dress and shoes) and Outfitly will find the pieces that would help most.</p>
          <button className="btn btn--primary" onClick={app.openAdd}>
            <Icon name="plus" />
            Add a piece
          </button>
        </div>
      ) : (
        result && (
          <>
            {present.length + (hasLooks ? 1 : 0) > 1 && (
              <div className="toolbar">
                <Seg
                  label="Show"
                  value={filter}
                  onChange={(v) => setFilter(v as Filter)}
                  optStyle={{ padding: "0 6px" }}
                  style={{ width: `min(${92 * (present.length + (hasLooks ? 2 : 1))}px, 100%)` }}
                  options={[
                    { value: "all", label: "All" },
                    ...(hasLooks ? [{ value: "outfits", label: "Outfits" }] : []),
                    ...present.map((c) => ({ value: c, label: LABEL[c] })),
                  ]}
                />
                <span className="toolbar__count" aria-live="polite">
                  {deck.length ? `${plural(deck.length, "idea")} left` : ""}
                </span>
              </div>
            )}

            {deck.length ? (
              <Deck app={app} items={deck} bestKey={bestKey} back={back} onDecide={decide} onOpen={(item) => report("clicked", item)} />
            ) : !result.suggestions.length && !result.looks?.length ? (
              <div className="card card--pad empty">
                <p className="t-head">Your wardrobe is well balanced.</p>
                <p className="t-foot muted">Nothing you could add would clearly improve your outfits right now. Add pieces or save outfits and this updates.</p>
              </div>
            ) : (
              <div className="card card--pad empty">
                <p className="t-head">
                  {filter === "all" ? "You’ve seen them all." : `No more ${filter === "outfits" ? "outfits" : LABEL[filter].toLowerCase()}.`}
                </p>
                <p className="t-foot muted">
                  {filter === "all" ? "What you saved is in Saved. New ideas come as your wardrobe changes." : "Other ideas are still waiting."}
                </p>
                {filter !== "all" && all.length > 0 && (
                  <button className="btn" onClick={() => setFilter("all")}>
                    Show all ideas
                  </button>
                )}
              </div>
            )}

            {filter === "all" && app.today.missing.length > 0 && (
              <section aria-labelledby="weather-t">
                <h2 className="next__label" id="weather-t">
                  For today’s weather
                </h2>
                <ul className="next__list">
                  {app.today.missing.map((m) => (
                    <li key={m.key} className="card buy buy--weather">
                      <span className="buy__icon" aria-hidden="true">
                        <Icon name="sun" />
                      </span>
                      <span className="buy__text">
                        <span className="buy__title">{m.item}</span>
                        <span className="buy__reason">{m.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )
      )}

      <button className="card next__saved" onClick={() => app.go({ name: "saved", tab: savedLooks.length && !wishlist.length ? "suggested" : "clothes" })}>
        <span className="next__saved-icon" aria-hidden="true">
          <Icon name="saved" filled={wishlist.length + savedLooks.length > 0} />
        </span>
        <span className="buy__text">
          <span className="buy__title">Saved from Next buys</span>
          <span className="t-cap muted">
            {wishlist.length + savedLooks.length
              ? [wishlist.length && plural(wishlist.length, "piece"), savedLooks.length && plural(savedLooks.length, "outfit")].filter(Boolean).join(" and ") + " waiting in Saved"
              : "What you save waits in Saved until you buy it"}
          </span>
        </span>
        <Icon name="chevron" />
      </button>
    </div>
  );
}

/** The pieces saved from Next buys, waiting until they're bought (Saved page, Clothes). */
export function SavedClothes({ app }: { app: App }) {
  const { wishlist } = app.nextBuys;
  const { unsave, own } = useWishActions(app);
  if (!wishlist.length) {
    return (
      <div className="card card--pad empty">
        <p className="t-foot muted">Nothing saved yet. Swipe right on a piece in Next buys and it waits here until you buy it.</p>
        <button className="btn btn--primary" onClick={() => app.go({ name: "next" })}>
          <Icon name="bag" />
          Open Next buys
        </button>
      </div>
    );
  }
  return (
    <ul className="next__list">
      {wishlist.map((w) => (
        <li key={w.key} className="card buy buy--saved">
          <span className="buy__art" aria-hidden="true">
            <PieceArt piece={asPiece(w)} />
          </span>
          <span className="buy__text">
            <span className="buy__title">{w.title}</span>
            <span className="t-cap muted">{w.spec.style}</span>
          </span>
          <span className="buy__actions">
            <button className="btn btn--sm" onClick={() => own(w)}>
              I own this
            </button>
            <button
              className="btn btn--plain btn--sm"
              onClick={() => {
                unsave(w);
                app.toast({ kind: "Removed", text: `${w.title} is out of Saved`, tone: "plain" });
              }}
              aria-label={`Remove ${w.title} from Saved`}
            >
              Remove
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** An outfit's pieces as small tiles, the new ones marked. */
function LookPieces({ owned, pieces, size }: { owned: Piece[]; pieces: LookPiece[]; size?: "lg" }) {
  const added = pieces.map(asPiece);
  const isNew = new Set(added.map((p) => p.id));
  return (
    <span className={`look__pieces${size ? ` look__pieces--${size}` : ""}`} aria-hidden="true">
      {ordered([...owned, ...added]).map((p) => (
        <span key={p.id} className={`look__piece${isNew.has(p.id) ? " is-new" : ""}`}>
          <PieceArt piece={p} />
          {isNew.has(p.id) && <span className="look__new">New</span>}
        </span>
      ))}
    </span>
  );
}

/** Suggested outfits the user saved (Saved page, Suggested). Each becomes a saved outfit on its
 *  own once the new pieces are in the wardrobe. */
export function SavedLooks({ app }: { app: App }) {
  const { savedLooks } = app.nextBuys;
  const { unsaveLook, ownLookPiece } = useWishActions(app);
  if (!savedLooks.length) {
    return (
      <div className="card card--pad empty">
        <p className="t-foot muted">No suggested outfits saved yet. Swipe right on an outfit in Next buys and it waits here. Once you add its new pieces, it becomes one of your saved outfits.</p>
        <button className="btn btn--primary" onClick={() => app.go({ name: "next" })}>
          <Icon name="bag" />
          Open Next buys
        </button>
      </div>
    );
  }
  return (
    <ul className="next__list">
      {savedLooks.map((l) => (
        <li key={l.key} className="card look">
          <div className="look__head">
            <span className="buy__text">
              <span className="buy__title">{lookTitle(l)}</span>
              <span className="t-cap muted">
                {l.style}
                {l.wardrobe ? ` · ${l.wardrobe}` : ""}
              </span>
            </span>
            <span className="buy__score num" aria-label={`Score ${l.before} to ${l.after}`}>
              {l.before} <Icon name="arrow" /> <b>{l.after}</b>
            </span>
          </div>
          <LookPieces owned={l.items} pieces={l.pieces} />
          <ul className="look__need" aria-label="New pieces">
            {l.pieces.map((p) => (
              <li key={p.key}>
                <span className="look__dot" aria-hidden="true" style={{ background: p.spec.color }} />
                <span className="look__need-title">{p.title}</span>
                <button className="btn btn--sm" onClick={() => ownLookPiece(l, p)} aria-label={`I own this: ${p.title}`}>
                  I own this
                </button>
              </li>
            ))}
          </ul>
          <div className="buy__actions">
            <button
              className="btn btn--plain btn--sm"
              onClick={() => {
                unsaveLook(l).catch(() => {});
                app.toast({ kind: "Removed", text: "The outfit is out of Saved", tone: "plain" });
              }}
              aria-label={`Remove ${lookTitle(l)} from Saved`}
            >
              Remove
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export type Swipe = "left" | "right" | "up";

// A card is decided once dragged past this share of its width, or flicked faster than FLICK.
const THROW = 0.32;
const FLICK = 0.45; // px per ms
const SHOWN = 3; // cards drawn in the stack
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** Keeps the pointer's moves coming to the card; a pointer that's already gone can't be captured. */
const capture = (e: PointerEvent<HTMLDivElement>) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // The drag still works while the pointer stays over the card.
  }
};
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The outfits a suggestion improves, with the owned pieces they're made of (skipping any since removed). */
const examplesFor = (app: App, item: NextBuy) =>
  item.examples
    .map((e) => ({ e, pieces: e.cloth_ids.map((id) => app.store.pieces.find((p) => p.id === id)).filter(Boolean) as Piece[] }))
    .filter((x) => x.pieces.length === x.e.cloth_ids.length);

type DeckProps = {
  app: App;
  items: DeckCard[];
  bestKey?: string;
  /** A card brought back by Undo: it flies back in from the side it left by. */
  back: { key: string; dir: Swipe } | null;
  /** Right: saved. Up: I own this. Left: not for me. */
  onDecide: (card: DeckCard, dir: Swipe) => void;
  onOpen: (item: NextBuy) => void;
};

/** The ideas as a stack of cards: drag the top one right to save it, left if it's not for you,
 *  up if you own it; tap a piece to flip it over to the outfits it improves. The buttons
 *  under the stack (and the arrow keys on the focused card) do the same. The drag writes styles
 *  straight to the card, so nothing re-renders while it moves. */
function Deck({ app, items, bestKey, back, onDecide, onOpen }: DeckProps) {
  const top = items[0];
  const deckRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [flippedKey, setFlippedKey] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const opened = useRef(new Set<string>());
  const refocus = useRef(false);
  const pos = useRef({ dx: 0, dy: 0 });
  // `across`: the drag started on the scrolling list of outfits, so only sideways moves swipe
  // (up and down scroll the list).
  const drag = useRef<{ id: number; x: number; y: number; t: number; vx: number; vy: number; moved: boolean; across: boolean } | null>(null);
  const flipped = flippedKey === top.key;
  const canFlip = !!top.piece && examplesFor(app, top.piece).length > 0;

  /** Moves the top card, tilts it with the drag, and shows the stamp for where it's heading. */
  const place = (dx: number, dy: number, transition = "none") => {
    const el = cardRef.current;
    if (!el) return;
    pos.current = { dx, dy };
    const reach = el.offsetWidth * THROW;
    const across = Math.abs(dx) >= -dy;
    el.style.transition = transition;
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${reducedMotion() ? 0 : Math.max(-16, Math.min(16, (dx / el.offsetWidth) * 20))}deg)`;
    el.style.setProperty("--right", String(across ? clamp01(dx / reach) : 0));
    el.style.setProperty("--left", String(across ? clamp01(-dx / reach) : 0));
    el.style.setProperty("--up", String(across ? 0 : clamp01(-dy / reach)));
    // The cards behind rise as the top one leaves.
    deckRef.current?.style.setProperty("--lift", String(clamp01(Math.hypot(dx, dy) / reach)));
  };

  const fling = (dir: Swipe, vy = 0) => {
    const el = cardRef.current;
    if (!el || leaving) return;
    refocus.current = document.activeElement === el;
    setLeaving(true);
    const { dx, dy } = pos.current;
    const w = el.offsetWidth;
    const far = reducedMotion() ? 0.25 : 1.5;
    const to =
      dir === "up"
        ? { x: dx, y: -el.offsetHeight * far }
        : { x: (dir === "right" ? 1 : -1) * w * far, y: dy + Math.max(-1, Math.min(1, vy)) * 120 };
    const ms = reducedMotion() ? 160 : 300;
    place(to.x, to.y, `transform ${ms}ms var(--ease-out), opacity ${ms}ms ease-in`);
    el.style.opacity = "0";
    window.setTimeout(() => {
      pos.current = { dx: 0, dy: 0 };
      deckRef.current?.style.setProperty("--lift", "0");
      setLeaving(false);
      onDecide(top, dir);
    }, ms);
  };

  const flip = () => {
    if (!canFlip) return;
    if (!flipped && !opened.current.has(top.key)) {
      opened.current.add(top.key);
      if (top.piece) onOpen(top.piece);
    }
    setFlippedKey(flipped ? null : top.key);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (leaving || e.button !== 0 || target.closest("button")) return;
    // No text selection or native drag of a selection or image from here: either would cancel the swipe.
    if (e.pointerType === "mouse") {
      e.preventDefault();
      getSelection()?.removeAllRanges();
    }
    const list = target.closest(".deck__scroll");
    const across = !!list && list.scrollHeight > list.clientHeight;
    // On the list, the pointer is only captured once a sideways swipe is under way, so a
    // vertical drag stays a scroll.
    if (!across) capture(e);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, vx: 0, vy: 0, moved: false, across };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = d.across ? 0 : e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, e.clientY - d.y) < 6) return;
    if (!d.moved && d.across) {
      // Mostly vertical: a scroll of the list, not a swipe.
      if (Math.abs(e.clientY - d.y) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      capture(e);
    }
    d.moved = true;
    // Velocity, smoothed over the last few moves, for flicks.
    const dt = Math.max(1, e.timeStamp - d.t);
    d.vx = 0.8 * ((dx - pos.current.dx) / dt) + 0.2 * d.vx;
    d.vy = 0.8 * ((dy - pos.current.dy) / dt) + 0.2 * d.vy;
    d.t = e.timeStamp;
    place(dx, dy);
  };
  const settle = () => place(0, 0, "transform 460ms var(--ease-spring)");
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return flip();
    const { dx, dy } = pos.current;
    const reach = (cardRef.current?.offsetWidth ?? 320) * THROW;
    if (Math.abs(dx) >= -dy && (Math.abs(dx) > reach || (Math.abs(d.vx) > FLICK && Math.sign(d.vx) === Math.sign(dx) && Math.abs(dx) > 24))) {
      fling(dx > 0 ? "right" : "left", d.vy);
    } else if (-dy > Math.abs(dx) && (-dy > reach * 1.1 || (d.vy < -FLICK && -dy > 24))) {
      fling("up");
    } else {
      settle();
    }
  };
  const onPointerCancel = () => {
    if (!drag.current) return;
    drag.current = null;
    settle();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = ({ ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up" } as const)[e.key as "ArrowRight"];
    if (dir) {
      e.preventDefault();
      fling(dir);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      flip();
    }
  };

  // A card that becomes the top starts unflipped; keyboard users stay on the stack.
  useEffect(() => {
    setFlippedKey(null);
    if (refocus.current) cardRef.current?.focus();
    refocus.current = false;
  }, [top.key]);

  // Undo: the card comes back in from where it went.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !back || back.key !== top.key || reducedMotion()) return;
    el.style.transition = "none";
    el.style.opacity = "0";
    el.style.transform = back.dir === "up" ? `translate3d(0, ${-el.offsetHeight}px, 0)` : `translate3d(${(back.dir === "right" ? 1.4 : -1.4) * el.offsetWidth}px, 0, 0) rotate(${back.dir === "right" ? 14 : -14}deg)`;
    void el.offsetWidth; // apply the start before transitioning from it
    el.style.transition = "transform 480ms var(--ease-spring), opacity 200ms ease-out";
    el.style.transform = "";
    el.style.opacity = "";
  }, [back, top.key]);

  const stack = items.slice(0, SHOWN);
  return (
    <section className="deck-wrap" aria-label="Ideas to decide on">
      <div className="deck" ref={deckRef}>
        {stack
          .map((item, i) => {
            const isTop = i === 0;
            return (
              <div
                key={item.key}
                ref={isTop ? cardRef : undefined}
                className={`deck__card${isTop ? " is-top" : ""}`}
                style={{ "--i": i, zIndex: SHOWN - i } as React.CSSProperties}
                aria-hidden={!isTop}
                inert={!isTop}
                {...(isTop && {
                  tabIndex: 0,
                  role: "group",
                  "aria-roledescription": "card",
                  "aria-label": `${item.title}. ${
                    item.look ? `An outfit, score ${item.look.before} to ${item.look.after}. ${toAdd(item.look.pieces)}` : item.piece?.explore ? "A piece to learn your taste" : `Up to plus ${item.piece?.best_gain}`
                  }. Right arrow saves it, left arrow: not for me, up arrow: I own ${item.look ? "the new pieces" : "this"}${canFlip ? ", Enter shows the outfits it improves" : ""}.`,
                  onPointerDown,
                  onPointerMove,
                  onPointerUp,
                  onPointerCancel,
                  onLostPointerCapture: onPointerCancel,
                  onKeyDown,
                })}
              >
                <div className={`deck__flip${isTop && flipped ? " is-flipped" : ""}`}>
                  {item.piece ? (
                    <CardFront item={item.piece} best={item.key === bestKey} canFlip={isTop && canFlip} />
                  ) : (
                    item.look && <LookFront app={app} look={item.look} />
                  )}
                  {isTop && canFlip && item.piece && <CardBack app={app} item={item.piece} />}
                </div>
                {isTop && (
                  <>
                    <span className="deck__stamp deck__stamp--right" aria-hidden="true">Save</span>
                    <span className="deck__stamp deck__stamp--left" aria-hidden="true">Not for me</span>
                    <span className="deck__stamp deck__stamp--up" aria-hidden="true">I own it</span>
                  </>
                )}
              </div>
            );
          })
          .reverse()}
      </div>
      <div className="deck__actions">
        <button className="deck__btn deck__btn--left" onClick={() => fling("left")} disabled={leaving} aria-label={`Not for me: ${top.title}`}>
          <span className="deck__icon"><Icon name="close" /></span>
          <span className="deck__cap" aria-hidden="true">Not for me</span>
        </button>
        <button className="deck__btn deck__btn--up" onClick={() => fling("up")} disabled={leaving} aria-label={`I own this: ${top.title}`}>
          <span className="deck__icon"><Icon name="check" /></span>
          <span className="deck__cap" aria-hidden="true">I own it</span>
        </button>
        <button className="deck__btn deck__btn--right" onClick={() => fling("right")} disabled={leaving} aria-label={`Save ${top.title}`}>
          <span className="deck__icon"><Icon name="saved" /></span>
          <span className="deck__cap" aria-hidden="true">Save</span>
        </button>
      </div>
    </section>
  );
}

function CardFront({ item, best, canFlip }: { item: NextBuy; best: boolean; canFlip: boolean }) {
  return (
    <article className="card deck__face deck__front">
      <div className="deck__art">
        <span className="deck__badges">
          {item.explore ? (
            <span className="deck__new">Something different</span>
          ) : (
            <>
              {best && <span className="deck__best">Best buy</span>}
              <span className="suggestion__gain num deck__gain">up to +{item.best_gain}</span>
            </>
          )}
        </span>
        <PieceArt piece={asPiece(item)} />
      </div>
      <div className="deck__text">
        <h2 className="deck__title">{item.title}</h2>
        <p className="t-cap muted">
          {item.explore
            ? `${item.spec.style} · about your taste, not your outfits`
            : `Improves ${plural(item.outfits, "outfit")}${item.outfits > 1 ? `, +${item.avg_gain} on average` : ""}`}
        </p>
        <p className="deck__reason">{item.reason}</p>
      </div>
      <div className="deck__foot">
        <span className="deck__hint" aria-hidden="true">
          {item.explore ? "Save it or not? Either way, Outfitly learns your taste." : canFlip ? "Tap to see the outfits it improves" : ""}
        </span>
      </div>
    </article>
  );
}

/** An outfit card: the outfit's pieces with the new ones marked, and the score it gets to. */
function LookFront({ app, look }: { app: App; look: SuggestedLook }) {
  const owned = look.cloth_ids.map((id) => app.store.pieces.find((p) => p.id === id)).filter(Boolean) as Piece[];
  return (
    <article className="card deck__face deck__front">
      <div className="deck__art deck__art--look">
        <span className="deck__badges">
          <span className="deck__new">{look.kind === "new" ? "New look" : "Outfit idea"}</span>
          <span className="suggestion__gain num deck__gain">+{look.gain}</span>
        </span>
        <LookPieces owned={owned} pieces={look.pieces} size="lg" />
      </div>
      <div className="deck__text">
        <h2 className="deck__title">{lookTitle(look)}</h2>
        <p className="t-cap muted num">
          {look.style} · {look.before} → {look.after}
        </p>
        <p className="deck__reason">{look.reason}</p>
      </div>
      <div className="deck__foot">
        <span className="deck__hint" aria-hidden="true">
          {toAdd(look.pieces)}
        </span>
      </div>
    </article>
  );
}

function CardBack({ app, item }: { app: App; item: NextBuy }) {
  const examples = examplesFor(app, item);
  return (
    <article className="card deck__face deck__back">
      <div className="deck__text">
        <p className="next__label">
          {item.outfits > examples.length ? `Best ${examples.length} of the ${item.outfits} outfits it improves` : "Outfits it improves"}
        </p>
        <h2 className="deck__title">{item.title}</h2>
      </div>
      <div className="deck__scroll">
        <div className="buy__examples">
          {examples.map(({ e, pieces }, i) => (
            <Example key={i} e={e} pieces={pieces} item={item} />
          ))}
        </div>
      </div>
      <span className="deck__hint" aria-hidden="true">
        Tap to flip back
      </span>
    </article>
  );
}

/** One outfit the piece improves: its pieces with the swap shown, and the score before → after. */
function Example({ e, pieces, item }: { e: BuyExample; pieces: Piece[]; item: NextBuy }) {
  const next = ordered([...pieces.filter((p) => p.id !== e.replaces), asPiece(item)]);
  const out = pieces.find((p) => p.id === e.replaces);
  return (
    <div className="buy__example">
      <span className="buy__look" aria-hidden="true">
        {next.map((p) => (
          <span key={p.id} className={`buy__mini${p.id === item.key ? " is-new" : ""}`}>
            <PieceArt piece={p} />
          </span>
        ))}
      </span>
      <span className="buy__about">
        <span className="t-cap">
          {e.source === "saved" && e.name ? `“${e.name}”` : `${e.style} outfit`}
          {out ? ` · instead of ${out.name.toLowerCase()}` : " · as a layer"}
        </span>
        <span className="buy__score num" aria-label={`Score ${e.before} to ${e.after}`}>
          {e.before} <Icon name="arrow" /> <b>{e.after}</b>
        </span>
      </span>
    </div>
  );
}
