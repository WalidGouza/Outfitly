import { useEffect, useMemo, useState } from "react";
import { verdict } from "./colors";
import { describeOutfit } from "./describe";
import type { App } from "./screens";
import type { Look, Piece } from "./store";
import { fetchSuggestions, recordSuggestions, suggestFor, type Suggestion, type SuggestionSource } from "./suggest";
import { Dialog, DialogHead, Facets, Icon, Palette, Pieces, Ring, ordered } from "./ui";

/** "Make it better": pieces the user doesn't own that would raise this outfit's score.
 *  Signed in, they come from the backend (real scores, ranked with the persona); the sample
 *  wardrobe, or a backend that can't answer, gets the in-browser estimate. */
export function Suggestions({ app, items, style, source }: { app: App; items: Piece[]; style: string; source: SuggestionSource }) {
  const { demo, wid, call } = app.store;
  const local = useMemo(() => suggestFor(items, style, app.store.pieces, app.wear), [items, style, app.store.pieces, app.wear]);
  const [remote, setRemote] = useState<Suggestion[] | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const ids = items.map((i) => i.id).join(",");
  useEffect(() => {
    setRemote(null);
    if (demo || !wid) return;
    const control = new AbortController();
    // Short pause so quick changes in the lab don't each ask the backend.
    const timer = setTimeout(() => {
      fetchSuggestions(call, wid, items, style, control.signal)
        .then(setRemote)
        .catch(() => !control.signal.aborted && setRemote(local));
    }, 250);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ids` stands for `items`
  }, [ids, style, demo, wid, call]);
  const list = (demo ? local : remote)?.filter((s) => !hidden.includes(s.key)) ?? null;
  useEffect(() => {
    if (!demo && remote?.length) recordSuggestions(call, "shown", remote, { source, wid, items });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per answer
  }, [remote]);
  const dismiss = (s: Suggestion, button: HTMLElement) => {
    // Hand focus on before the button disappears, or it falls back to the dialog and scrolls it.
    const item = button.closest("li");
    const next = (item?.nextElementSibling ?? item?.previousElementSibling)?.querySelector("button");
    (next ?? item?.closest("section")?.querySelector<HTMLElement>("h3"))?.focus({ preventScroll: true });
    setHidden((h) => [...h, s.key]);
    if (!demo) recordSuggestions(call, "dismissed", [s], { source, wid, items });
    app.toast({ kind: "Hidden", text: demo ? "Hidden for this outfit" : "We won’t suggest it again", tone: "plain" });
  };
  return (
    <section className="suggestions" aria-labelledby="suggest-t">
      <div className="suggestions__head">
        <h3 className="t-head" id="suggest-t" tabIndex={-1}>
          Make it better
        </h3>
        <span className="t-cap muted">Pieces you don’t own yet</span>
      </div>
      {list === null ? (
        <p className="t-foot muted" aria-live="polite">
          Looking for pieces that would help…
        </p>
      ) : list.length ? (
        <ul className="suggestions__list">
          {list.map((s) => (
            <li key={`${s.spec.category}-${s.query}`} className="suggestion">
              <span className="suggestion__swatch" style={{ background: s.spec.color }} aria-hidden="true" />
              <span className="suggestion__text">
                <span className="suggestion__title">
                  {s.title}
                  <span className="suggestion__gain num">+{s.gain}</span>
                </span>
                <span className="t-cap muted">{s.replaces ? `Instead of your ${s.replaces.name.toLowerCase()}` : "Add it as a layer"}</span>
                <span className="suggestion__reason">{s.reason}</span>
                {s.outfits && s.outfits > 1 ? <span className="suggestion__reach">Improves {s.outfits} of your outfits</span> : null}
              </span>
              <button className="btn btn--plain btn--sm suggestion__dismiss" onClick={(e) => dismiss(s, e.currentTarget)} aria-label={`Not for me: ${s.title}`}>
                Not for me
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-foot muted">Nothing would clearly improve this one. It already works well with what you have.</p>
      )}
    </section>
  );
}

/** Opened from an outfit card: the outfit, why it scores as it does, and how to raise it. */
export function OutfitDetails({ app, look, onClose }: { app: App; look: Look | null; onClose: () => void }) {
  const items = look ? ordered(look.items) : [];
  const about = look?.score !== undefined && look.breakdown ? describeOutfit(items, look.score, look.breakdown, look.style, app.store.pieces) : null;
  return (
    <Dialog open={!!look} onClose={onClose} labelledBy="outfit-t" width="min(640px, 100%)" top={48}>
      {look && (
        <>
          <DialogHead id="outfit-t" title={look.score !== undefined ? verdict(look.score) : look.style} onClose={onClose} />
          <div className="dialog__body outfit-details">
            <div className="score">
              {look.score !== undefined && <Ring pct={look.score} />}
              <div>
                <div className="score__label">{look.style}</div>
                {look.score !== undefined && <div className="score__sub num">{look.score}% match</div>}
              </div>
            </div>
            <Palette items={items} style={{ margin: "14px 0 0" }} />
            <div className="outfit-details__pieces">
              <Pieces
                items={items}
                open={(p) => {
                  onClose();
                  app.go({ name: "piece", id: p.id });
                }}
              />
            </div>
            <Facets look={look} />
            {about && (
              <div className="lab__about" style={{ padding: "4px 0 0" }}>
                <p className="t-head">{about.headline}</p>
                <ul className="lab__notes">
                  {about.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            <Suggestions app={app} items={items} style={look.style} source="outfit" />
          </div>
          <div className="dialog__foot">
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button
              className="btn btn--primary"
              onClick={() => {
                onClose();
                app.openLookInLab(look);
              }}
            >
              <Icon name="lab" />
              Open in the lab
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
