// Next buys: the pieces that would do the most for the whole wardrobe.
//
// Signed in, the list is the backend's (GET /wardrobes/{id}/suggestions): every saved outfit and
// the best outfits in the user's main styles are tried with pieces they don't own, and pieces are
// ranked by what they add across all of them, weighted by the persona. The sample wardrobe gets
// the same idea computed in the browser (suggest.ts localNextBuys).
import { useEffect, useMemo, useState } from "react";
import { categories, type Category, type Piece, type Store, type Wear } from "./store";
import type { App } from "./screens";
import { localNextBuys, recordSuggestions, type BuyExample, type NextBuy, type NextBuysResult, type SuggestionAction, type WishItem } from "./suggest";
import { Icon, PieceArt, Seg, ordered } from "./ui";

const DEMO_WISHLIST = "outfitly-demo-wishlist";
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const LABEL: Record<Category, string> = { tops: "Tops", pants: "Bottoms", dresses: "Dresses", shoes: "Shoes", jackets: "Layers" };

/** A suggested piece drawn like an owned one (no photo: the garment's shape in its colour). */
export const asPiece = (b: { key: string; title: string; spec: NextBuy["spec"] }): Piece => ({
  id: b.key, name: b.title, category: b.spec.category, color: b.spec.color, texture: b.spec.texture, style: b.spec.style, garment: b.spec.garment, image: null,
});

function readDemoWishlist(): WishItem[] {
  try {
    return JSON.parse(localStorage.getItem(DEMO_WISHLIST) || "[]");
  } catch {
    return [];
  }
}
function writeDemoWishlist(list: WishItem[]) {
  try {
    localStorage.setItem(DEMO_WISHLIST, JSON.stringify(list));
  } catch {
    // Private windows can refuse storage; the list still works for this visit.
  }
}

/** The wardrobe's Next buys and the saved list, kept up to date as the wardrobe changes.
 *  Owned by the app (main.tsx), so Home can announce new ideas before the page is opened. */
export function useNextBuys(store: Store, wear: Wear) {
  const { demo, wid, call } = store;
  const [result, setResult] = useState<NextBuysResult | null>(null);
  const [error, setError] = useState("");
  const [wishlist, setWishlist] = useState<WishItem[]>([]);
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
          setResult({ suggestions: localNextBuys(outfits, store.pieces, wear), considered: outfits.length, complete: outfits.length > 0, estimated: true });
          setWishlist(readDemoWishlist());
        })
        .catch((e) => active && setError((e as Error).message));
    } else if (wid) {
      Promise.all([call<NextBuysResult>(`/wardrobes/${wid}/suggestions`), call<WishItem[]>("/me/wishlist")])
        .then(([r, w]) => {
          if (!active) return;
          setResult(r);
          setWishlist(w);
        })
        .catch((e) => active && setError((e as Error).message));
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `changes` stands for the wardrobe's contents
  }, [demo, wid, call, changes, wear]);
  return { result, error, wishlist, setWishlist };
}
export type NextBuysState = ReturnType<typeof useNextBuys>;

export function NextBuys({ app }: { app: App }) {
  const { store } = app;
  const { demo, wid, call } = store;
  const { result, error, wishlist, setWishlist } = app.nextBuys;
  const [hidden, setHidden] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo(() => (result?.suggestions ?? []).filter((s) => !hidden.includes(s.key)), [result, hidden]);
  const present = categories.map((c) => c.key).filter((c) => all.some((s) => s.spec.category === c));
  const list = all.filter((s) => filter === "all" || s.spec.category === filter);
  const [best, ...more] = list;
  const saved = new Set(wishlist.map((w) => w.key));

  useEffect(() => {
    if (!demo && list.length) recordSuggestions(call, "shown", list.map((s) => ({ ...s, gain: s.best_gain })), { source: "next-buys", wid });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per list shown
  }, [result, filter]);

  const report = (action: SuggestionAction, item: { key: string; spec: NextBuy["spec"]; best_gain?: number }) => {
    if (!demo) recordSuggestions(call, action, [{ ...item, gain: item.best_gain }], { source: "next-buys", wid });
  };
  const keep = (next: WishItem[]) => {
    setWishlist(next);
    if (demo) writeDemoWishlist(next);
  };
  const toggleSave = (item: NextBuy | WishItem) => {
    if (saved.has(item.key)) {
      keep(wishlist.filter((w) => w.key !== item.key));
      report("unsaved", item);
      app.toast({ kind: "Removed", text: `${item.title} is off your list`, tone: "plain" });
    } else {
      keep([{ key: item.key, spec: item.spec, query: item.query, title: item.title }, ...wishlist]);
      report("saved", item);
      app.toast({ kind: "Saved", text: `${item.title} is on your list` });
    }
  };
  const dismiss = (item: NextBuy) => {
    setHidden((h) => [...h, item.key]);
    report("dismissed", item);
    app.toast({ kind: "Hidden", text: demo ? "Hidden for this visit" : "We won’t suggest it again", tone: "plain" });
  };
  const own = (item: NextBuy | WishItem) => {
    setHidden((h) => [...h, item.key]);
    keep(wishlist.filter((w) => w.key !== item.key));
    report("owned", item);
    // Straight to adding it, with what we already know filled in; the photo decides the rest.
    app.addSuggested({ name: item.title, category: item.spec.category, garment: item.spec.garment, texture: item.spec.texture, style: item.spec.style, color: item.spec.color });
  };
  const toggleOpen = (item: NextBuy) => {
    if (open !== item.key) report("clicked", item);
    setOpen(open === item.key ? null : item.key);
  };

  const reach = best ? best.outfits : 0;
  const summary = !result
    ? "Finding the pieces that would do the most for your outfits…"
    : !all.length
      ? "Pieces you don’t own yet that would make your outfits better."
      : reach > 1
        ? `${best!.title} alone would improve ${reach} of your outfits.`
        : "Pieces you don’t own yet that would make your outfits better.";

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
            {present.length > 1 && (
              <div className="toolbar">
                <Seg
                  label="Show"
                  value={filter}
                  onChange={(v) => setFilter(v as "all" | Category)}
                  optStyle={{ padding: "0 6px" }}
                  style={{ width: `min(${96 * (present.length + 1)}px, 100%)` }}
                  options={[{ value: "all", label: "All" }, ...present.map((c) => ({ value: c, label: LABEL[c] }))]}
                />
                <span className="toolbar__count" aria-live="polite">
                  {plural(list.length, "idea")}
                </span>
              </div>
            )}

            {best ? (
              <section aria-labelledby="best-t">
                <h2 className="next__label" id="best-t">
                  Best buy
                </h2>
                <BuyCard app={app} item={best} hero saved={saved.has(best.key)} open onSave={toggleSave} onOwn={own} onDismiss={dismiss} />
              </section>
            ) : (
              <div className="card card--pad empty">
                <p className="t-head">Your wardrobe is well balanced.</p>
                <p className="t-foot muted">Nothing you could add would clearly improve your outfits right now. Add pieces or save outfits and this list updates.</p>
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

            {more.length > 0 && (
              <section aria-labelledby="more-t">
                <h2 className="next__label" id="more-t">
                  More ideas
                </h2>
                <ul className="next__list">
                  {more.map((s) => (
                    <li key={s.key}>
                      <BuyCard app={app} item={s} saved={saved.has(s.key)} open={open === s.key} onToggle={() => toggleOpen(s)} onSave={toggleSave} onOwn={own} onDismiss={dismiss} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )
      )}

      <section aria-labelledby="list-t">
        <h2 className="next__label" id="list-t">
          Your list
        </h2>
        {wishlist.length ? (
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
                  <button className="btn btn--plain btn--sm" onClick={() => toggleSave(w)} aria-label={`Remove ${w.title} from your list`}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-foot muted next__hint">Save pieces you like and they wait here until you buy them.</p>
        )}
      </section>
    </div>
  );
}

type CardProps = {
  app: App;
  item: NextBuy;
  saved: boolean;
  open: boolean;
  hero?: boolean;
  onToggle?: () => void;
  onSave: (item: NextBuy) => void;
  onOwn: (item: NextBuy) => void;
  onDismiss: (item: NextBuy) => void;
};

function BuyCard({ app, item, saved, open, hero, onToggle, onSave, onOwn, onDismiss }: CardProps) {
  const examples = item.examples
    .map((e) => ({ e, pieces: e.cloth_ids.map((id) => app.store.pieces.find((p) => p.id === id)).filter(Boolean) as Piece[] }))
    .filter((x) => x.pieces.length === x.e.cloth_ids.length);
  return (
    <article className={`card buy${hero ? " buy--hero" : ""}`}>
      <div className="buy__main">
        <span className="buy__art" aria-hidden="true">
          <PieceArt piece={asPiece(item)} />
        </span>
        <span className="buy__text">
          <span className="buy__title">{item.title}</span>
          <span className="buy__stats">
            <span className="suggestion__gain num">up to +{item.best_gain}</span>
            <span className="t-cap">
              Improves {plural(item.outfits, "outfit")}
              {item.outfits > 1 ? `, +${item.avg_gain} on average` : ""}
            </span>
          </span>
          <span className="buy__reason">{item.reason}</span>
        </span>
      </div>
      {examples.length > 0 &&
        (open ? (
          <div className="buy__examples">
            {examples.map(({ e, pieces }, i) => (
              <Example key={i} e={e} pieces={pieces} item={item} />
            ))}
            {onToggle && (
              <button className="btn btn--plain btn--sm buy__toggle" onClick={onToggle} aria-expanded="true">
                Hide outfits
              </button>
            )}
          </div>
        ) : (
          onToggle && (
            <button className="btn btn--plain btn--sm buy__toggle" onClick={onToggle} aria-expanded="false">
              See the outfits it improves
              <Icon name="down" />
            </button>
          )
        ))}
      <div className="buy__actions">
        <button className={`btn btn--sm${saved ? " btn--primary" : ""}`} aria-pressed={saved} onClick={() => onSave(item)}>
          <Icon name="saved" filled={saved} />
          {saved ? "Saved" : "Save"}
        </button>
        <button className="btn btn--sm" onClick={() => onOwn(item)}>
          I own this
        </button>
        <button className="btn btn--plain btn--sm" onClick={() => onDismiss(item)} aria-label={`Not for me: ${item.title}`}>
          Not for me
        </button>
      </div>
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
