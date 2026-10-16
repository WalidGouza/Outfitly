import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { colorName, verdict } from "./colors";
import { describeOutfit } from "./describe";
import type { App } from "./screens";
import { categories, styles, type Category, type Look, type Piece, type Rating } from "./store";
import { Facets, Icon, Palette, PieceArt, Pieces, Ring, ordered } from "./ui";

/** Outfit lab selection; kept in the app shell so it survives a visit to a piece's page. */
export type LabState = { picks: Partial<Record<Category, string>>; style: string };
export const emptyLab: LabState = { picks: {}, style: "Auto" };

// Jacket first and optional, like an outfit reads top to bottom.
// A dress takes the place of the top and the bottoms.
const SLOTS: { key: Category; label: string; optional?: boolean }[] = [
  { key: "jackets", label: "Layer", optional: true },
  { key: "tops", label: "Top" },
  { key: "pants", label: "Bottoms" },
  { key: "dresses", label: "Or a dress" },
  { key: "shoes", label: "Shoes" },
];
const ONE_PIECE: Category[] = ["dresses"];
const SEPARATES: Category[] = ["tops", "pants"];

export function Lab({ app, lab, setLab }: { app: App; lab: LabState; setLab: Dispatch<SetStateAction<LabState>> }) {
  const { store } = app;
  const [rating, setRating] = useState<Rating | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useRef(0);

  // Drop picks that are no longer in this wardrobe (removed piece, other wardrobe).
  const picked = useMemo(
    () => SLOTS.map((s) => store.pieces.find((p) => p.id === lab.picks[s.key])).filter(Boolean) as Piece[],
    [store.pieces, lab.picks],
  );
  const has = (c: Category) => picked.some((p) => p.category === c);
  const complete = has("shoes") && (has("dresses") || (has("tops") && has("pants")));
  // Hide the dress slot for men's wardrobes that have no dresses.
  const slots = SLOTS.filter((s) => s.key !== "dresses" || app.wear !== "men" || store.pieces.some((p) => p.category === "dresses"));
  const key = picked.map((p) => p.id).join() + "|" + lab.style;

  // Re-rate shortly after each change; a slower answer for an older outfit is ignored.
  useEffect(() => {
    setError("");
    if (!complete) return setRating(null);
    const id = ++run.current;
    setBusy(true);
    const timer = window.setTimeout(() => {
      store
        .rate(picked, lab.style)
        .then((r) => id === run.current && setRating(r))
        .catch((e) => id === run.current && (setRating(null), setError(e.message)))
        .finally(() => id === run.current && setBusy(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Functional updates, so quick successive picks never overwrite each other.
  const pick = (category: Category, id: string) =>
    setLab((l) => {
      const picks = { ...l.picks };
      if (picks[category] === id) delete picks[category];
      else {
        picks[category] = id;
        // Choosing a dress clears the top and bottoms, and the other way round.
        for (const other of ONE_PIECE.includes(category) ? SEPARATES : SEPARATES.includes(category) ? ONE_PIECE : []) delete picks[other];
      }
      return { ...l, picks };
    });
  const look: Look | null = rating && complete ? { items: picked, style: rating.style, score: rating.score, breakdown: rating.breakdown } : null;
  const about = look ? describeOutfit(picked, rating!.score, rating!.breakdown, rating!.style, store.pieces) : null;
  const saved = look ? store.isSaved(look) : false;

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1 className="t-large">Outfit lab</h1>
          <p className="t-sub">Put an outfit together yourself. We rate it and tell you why.</p>
        </div>
        {picked.length > 0 && (
          <div className="page-head__actions">
            <button className="btn" onClick={() => setLab((l) => ({ ...l, picks: {} }))}>
              <Icon name="close" />
              Start over
            </button>
          </div>
        )}
      </div>
      <div className="studio">
        <section className="card studio__settings lab__picker" aria-label="Choose pieces">
          {slots.map((slot) => {
            const options = store.pieces.filter((p) => p.category === slot.key);
            return (
              <fieldset key={slot.key}>
                <legend className="t-head legend-row">
                  {slot.label}
                  <span className="t-foot muted">{slot.optional ? "Optional" : lab.picks[slot.key] ? "" : "Choose one"}</span>
                </legend>
                {options.length ? (
                  <div className="anchors">
                    {options.map((p) => (
                      <button
                        key={p.id}
                        className="anchor"
                        aria-pressed={lab.picks[slot.key] === p.id}
                        aria-label={p.name}
                        title={`${p.name}, ${colorName(p.color)}`}
                        onClick={() => pick(slot.key, p.id)}
                      >
                        <PieceArt piece={p} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="t-foot muted">No {slot.label.toLowerCase()} in this wardrobe yet.</p>
                )}
              </fieldset>
            );
          })}
          <fieldset>
            <legend className="t-head">Rate it as</legend>
            <div className="pills">
              {["Auto", ...styles].map((s) => (
                <button key={s} className="pill" aria-pressed={lab.style === s} onClick={() => setLab((l) => ({ ...l, style: s }))}>
                  {s === "Auto" ? "Best fit" : s}
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="studio__results" aria-live="polite">
          {error && (
            <p role="alert" className="note note--error">
              {error}
            </p>
          )}
          {!look ? (
            <div className="card card--pad lab__empty">
              <div className="lab__slots" aria-hidden="true">
                {slots.map((slot) => {
                  const p = picked.find((x) => x.category === slot.key);
                  return (
                    <span key={slot.key} className={`lab__slot${p ? " is-filled" : ""}`}>
                      {p ? <PieceArt piece={p} /> : <span className="t-foot muted">{slot.label}</span>}
                    </span>
                  );
                })}
              </div>
              <p className="t-foot muted">
                {busy ? "Rating your outfit…" : complete ? "" : "Choose a top and bottoms, or a dress, plus shoes (and a layer if you like) to get a rating."}
              </p>
            </div>
          ) : (
            <article className={`outfit lab__result${busy ? " is-busy" : ""}`} aria-label={`${verdict(look.score!)}, ${look.score}% match`}>
              <header className="outfit__head">
                <div className="score">
                  <Ring pct={look.score!} />
                  <div>
                    <div className="score__label">{verdict(look.score!)}</div>
                    <div className="score__sub num">{look.score}% match</div>
                  </div>
                </div>
                <span className="chip chip--sm chip--style">{lab.style === "Auto" ? `Best as ${look.style}` : look.style}</span>
              </header>
              <Palette items={ordered(picked)} />
              <Pieces items={ordered(picked)} open={(p) => app.go({ name: "piece", id: p.id })} />
              <Facets look={look} />
              {about && (
                <div className="lab__about">
                  <h2 className="t-title2">{about.headline}</h2>
                  <ul className="lab__notes">
                    {about.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                  {about.tip && (
                    <p className="lab__tip">
                      <Icon name="shuffle" />
                      {about.tip}
                    </p>
                  )}
                  {rating?.estimated && <p className="t-cap muted">Meaning is estimated while image analysis is unavailable.</p>}
                </div>
              )}
              <div className="outfit__foot">
                <button className="btn btn--primary btn--block" aria-pressed={saved} onClick={() => app.saveLook(look)}>
                  <Icon name="saved" filled={saved} />
                  {saved ? "Saved" : "Save outfit"}
                </button>
              </div>
            </article>
          )}
        </section>
      </div>
    </>
  );
}
