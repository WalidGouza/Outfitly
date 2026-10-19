import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { colorChoices, colorName, verdict } from "./colors";
import { Select } from "./Select";
import { KEEP_OOTD_UNSEEN_FOR_TESTING } from "./testing";
import { describePiece } from "./describe";
import { greeting } from "./greeting";
import { StudioLoopVideo } from "./StudioLoopVideo";
import { asPiece, SavedClothes, SavedLooks, type NextBuysState } from "./nextbuys";
import {
  ColorLabel,
  Dialog,
  DialogHead,
  Facets,
  Icon,
  OutfitCard,
  Palette,
  PieceArt,
  Pieces,
  Seg,
  Switch,
  ordered,
  roleOf,
  type ToastData,
} from "./ui";
import { categories, categoriesFor, garmentTypes, styles, textures, typesFor, type Wear, type Category, type Look, type MissingPiece, type Piece, type Store, type Weather } from "./store";

export type Route =
  | { name: "home" | "today" | "wardrobes" | "wardrobe" | "studio" | "next" | "lab" | "account" }
  | { name: "saved"; tab?: SavedTab }
  | { name: "piece"; id: string };

/** The Saved page's lists: outfits, clothes saved from Next buys, and suggested outfits saved from it. */
export type SavedTab = "outfits" | "clothes" | "suggested";

export type StudioState = {
  style: string;
  harmony: string;
  includeJacket: boolean;
  anchorId: string;
  looks: Look[] | null;
  busy: boolean;
  filter: "all" | "layer" | "none";
  error: string;
};
export type TodayState = {
  looks: Look[];
  index: number;
  busy: boolean;
  error: string;
  weather: Weather | null;
  advice: string[];
  missing: MissingPiece[];
  geo: "idle" | "asking" | "ok" | "denied" | "failed" | "unsupported";
};

export type App = {
  store: Store;
  go: (route: Route) => void;
  toast: (t: ToastData) => void;
  openAdd: () => void;
  askRemove: (piece: Piece) => void;
  requireAccount: () => void;
  /** Today's outfit exists and the user hasn't opened it yet: Home announces it. */
  todayUnseen: boolean;
  /** Next buys: the wardrobe-wide suggestions and saved list (useNextBuys). */
  nextBuys: NextBuysState;
  /** Next buys hasn't been opened yet by this user: Home announces it, once. */
  buysUnseen: boolean;
  studio: StudioState;
  setStudio: (patch: Partial<StudioState>) => void;
  runStudio: (patch?: Partial<StudioState>) => void;
  today: TodayState;
  pickAnother: () => void;
  locate: () => void;
  saveLook: (look: Look) => void;
  /** Which clothes to offer (profile setting); "both" for the sample wardrobe. */
  wear: Wear;
  /** Opens Add piece filled in from a suggestion the user says they own ("I own this"). */
  addSuggested: (prefill: AddPrefill) => void;
  /** Opens the new-wardrobe dialog (sign-in first for the sample wardrobe). */
  newWardrobe: () => void;
  /** Opens an outfit's details: its description and pieces that would raise its score. */
  openOutfit: (look: Look) => void;
  /** Loads an outfit's pieces into the Outfit lab and opens it. */
  openLookInLab: (look: Look) => void;
  /** Puts a piece in its slot in the Outfit lab and opens the lab. */
  openInLab: (piece: Piece) => void;
};

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const today = (now = new Date()) => now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

/** The current time, refreshed on each new minute and when the tab comes back into view. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(new Date());
      // Wake up just after the next minute starts, so the greeting changes right on the hour.
      timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    const onShow = () => document.visibilityState === "visible" && setNow(new Date());
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return now;
}
const layered = (look: Look) => look.items.some((i) => i.category === "jackets");

function ErrorNote({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p role="alert" className="note note--error">
      {text}
    </p>
  );
}

// ── Home ────────────────────────────────────────────────────────────────────
// The outfit-of-the-day card makes an entrance on the first visit of each calendar day only.
const LAST_VISIT_KEY = "outfitly_last_login_date";
const localDay = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the user's own time zone

export function Home({ app }: { app: App }) {
  const { store, go } = app;
  // Decided before the first paint, so the card never flashes in and then restarts its entrance.
  const [entrance] = useState(() => {
    if (KEEP_OOTD_UNSEEN_FOR_TESTING) return true;
    try {
      return localStorage.getItem(LAST_VISIT_KEY) !== localDay();
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LAST_VISIT_KEY, localDay());
    } catch {
      // Storage unavailable (private window): the entrance may simply play again next visit.
    }
  }, []);
  const look = app.today.looks[app.today.index];
  const recent = [...store.pieces].reverse().slice(0, 6);
  const now = useClock();
  const hello = greeting(now);
  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <span className="t-eyebrow">{today(now)}</span>
          <h1 className="t-large">{hello.title}</h1>
          <p className="t-sub">{hello.sub}</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => go({ name: "studio" })}>
            <Icon name="studio" />
            Create outfits
          </button>
          <button className="btn btn--primary" onClick={app.openAdd}>
            <Icon name="plus" />
            Add a piece
          </button>
        </div>
      </div>
      <div className="tiles stagger">
        <button
          className={`tile tile--ink tile--feature${look ? " tile--liquid" : ""}${app.todayUnseen ? " tile--new" : ""}${entrance ? " tile--enter" : ""}`}
          onClick={() => go({ name: "today" })}
        >
          {/* Liquid glass: the outfit's own colours, blurred and drifting, under frosted panes. */}
          {look && (
            <span className="ootd-liquid" aria-hidden="true">
              {ordered(look.items).map((p) => (
                <i key={p.id} style={{ background: p.color }} />
              ))}
            </span>
          )}
          {(entrance || app.todayUnseen) && <span className="ootd-sweep" aria-hidden="true" />}
          <span className="tile-feature__text">
            <span className="tile-feature__top">
              <span className={`tile__icon${look ? " glass" : ""}`}>
                <Icon name="sun" />
              </span>
              {app.todayUnseen && (
                <span className="new-badge">
                  <span className="new-badge__dot" aria-hidden="true" />
                  <span className="new-badge__text">New today</span>
                </span>
              )}
            </span>
            <span className="t-title">Outfit of the day</span>
            {app.today.weather && (
              <span className={`tile-weather${look ? " glass" : ""}`}>
                <Icon name="sun" />
                {app.today.weather.temp_now}°C, {app.today.weather.summary.toLowerCase()}
                {app.today.weather.place ? ` ${app.today.weather.place.startsWith("Near ") ? "near" : "in"} ${app.today.weather.place.replace(/^Near /, "").split(",")[0]}` : ""}
              </span>
            )}
            <p>
              {app.today.weather && look?.score !== undefined
                ? `${app.today.advice[0] ?? "Dressed for the forecast."} ${look.score}% match.`
                : app.today.weather && app.today.missing.length
                  ? `${app.today.advice[0] ?? ""} Missing: ${app.today.missing.map((m) => m.item.toLowerCase()).join(", ")}.`
                  : look?.score !== undefined
                ? `${look.style}, ${look.score}% match. A fresh pick from your wardrobe.`
                : app.today.busy
                  ? "Picking something from your wardrobe…"
                  : "Add a top, bottoms and shoes (or a dress and shoes) and we pick one every morning."}
            </p>
          </span>
          {look && (
            <span className="tile-feature__pieces">
              {ordered(look.items).map((p, i) => (
                <span key={p.id} className="inset-media glass" style={{ ["--i" as string]: i }}>
                  <PieceArt piece={p} />
                </span>
              ))}
            </span>
          )}
          <span className="tile__chev">
            <Icon name="chevron" />
          </span>
        </button>
        <BuysTile app={app} />
        <Tile icon="wardrobe" title="Wardrobe" text={`${plural(store.pieces.length, "piece")}, every colour named.`} onClick={() => go({ name: "wardrobe" })} />
        <Tile icon="studio" title="Outfit studio" text="Pick a style and colour direction." onClick={() => go({ name: "studio" })} />
        <Tile icon="saved" title="Saved" text={`${plural(store.saved.length, "look")} kept for later.`} onClick={() => go({ name: "saved" })} />
        <Tile icon="lab" title="Outfit lab" text="Mix your own outfit and get a rating." onClick={() => go({ name: "lab" })} />
        <Tile icon="camera" title="Add a piece" text="Snap it and we fill in the details." onClick={app.openAdd} />
      </div>
      <section className="section">
        <div className="section__head">
          <h2 className="t-title">Recently added</h2>
          {store.pieces.length > 0 && (
            <button className="section__link" onClick={() => go({ name: "wardrobe" })}>
              See all {store.pieces.length}
              <Icon name="chevron" />
            </button>
          )}
        </div>
        {recent.length ? (
          <div className="grid stagger">
            {recent.map((p) => (
              <ItemCard key={p.id} piece={p} app={app} />
            ))}
          </div>
        ) : (
          <Empty text={store.loading ? "Loading your pieces…" : "Nothing here yet. Add your first piece and it shows up here."} />
        )}
      </section>
    </>
  );
}

/** Next buys on Home: the same feature card as the outfit of the day. The "new" animation (sage
 *  card, ring of light, glass sweep, pieces re-entering, entrance) plays only until the user first
 *  opens Next buys; after that it's a calm card. */
function BuysTile({ app }: { app: App }) {
  const top = (app.nextBuys.result?.suggestions ?? []).slice(0, 3);
  const best = top[0];
  const unseen = app.buysUnseen;
  return (
    <button
      className={`tile tile--ink tile--feature tile--buys${top.length ? " tile--liquid" : ""}${unseen ? " tile--new tile--enter" : ""}`}
      onClick={() => app.go({ name: "next" })}
    >
      {top.length > 0 && (
        <span className="ootd-liquid" aria-hidden="true">
          {top.map((s) => (
            <i key={s.key} style={{ background: s.spec.color }} />
          ))}
        </span>
      )}
      {unseen && <span className="ootd-sweep" aria-hidden="true" />}
      <span className="tile-feature__text">
        <span className="tile-feature__top">
          <span className={`tile__icon${top.length ? " glass" : ""}`}>
            <Icon name="bag" />
          </span>
          {unseen && (
            <span className="new-badge">
              <span className="new-badge__dot" aria-hidden="true" />
              <span className="new-badge__text">New feature</span>
            </span>
          )}
        </span>
        <span className="t-title">Next buys</span>
        <p>
          {best
            ? unseen
              ? `The pieces that would do most for your wardrobe, starting with the ${best.title.toLowerCase()}${best.outfits > 1 ? `: it would improve ${best.outfits} of your outfits.` : "."}`
              : `${best.title}${best.outfits > 1 ? ` would improve ${best.outfits} of your outfits.` : " would lift your outfits."}`
            : app.nextBuys.result
              ? "Your wardrobe is well balanced: nothing would clearly improve it right now."
              : "The pieces that would do most for your outfits."}
        </p>
      </span>
      {top.length > 0 && (
        <span className="tile-feature__pieces">
          {top.map((s, i) => (
            <span key={s.key} className="inset-media glass" style={{ ["--i" as string]: i }}>
              <PieceArt piece={asPiece(s)} />
            </span>
          ))}
        </span>
      )}
      <span className="tile__chev">
        <Icon name="chevron" />
      </span>
    </button>
  );
}

function Tile({ icon, title, text, onClick }: { icon: "wardrobe" | "studio" | "saved" | "camera" | "lab" | "bag"; title: string; text: string; onClick: () => void }) {
  return (
    <button className="tile" onClick={onClick}>
      <span className="tile__icon">
        <Icon name={icon} />
      </span>
      <span className="tile__chev">
        <Icon name="chevron" />
      </span>
      <span className="t-title2">{title}</span>
      <p>{text}</p>
    </button>
  );
}

function Empty({ text, action }: { text: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="card card--pad empty">
      <p className="t-foot muted">{text}</p>
      {action && (
        <button className="btn btn--primary" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function ItemCard({ piece, app, meta = "colour", removable }: { piece: Piece; app: App; meta?: "colour" | "colour+fabric"; removable?: boolean }) {
  return (
    <article className="item">
      <button className="item__link" onClick={() => app.go({ name: "piece", id: piece.id })}>
        <span className="item__media">
          <PieceArt piece={piece} />
        </span>
        <span className="item__body">
          <span className="item__name">{piece.name}</span>
          <ColorLabel
            hex={piece.color}
            className="item__meta"
            text={meta === "colour" ? undefined : `${colorName(piece.color)}, ${piece.texture}`}
          />
        </span>
      </button>
      {removable && (
        <div className="item__action">
          <button className="icon-btn" aria-label={`Remove ${piece.name}`} onClick={() => app.askRemove(piece)}>
            <Icon name="trash" />
          </button>
        </div>
      )}
    </article>
  );
}

// ── Today ───────────────────────────────────────────────────────────────────
export function Today({ app }: { app: App }) {
  const { store, today: t } = app;
  const look = t.looks[t.index];
  const items = look ? ordered(look.items) : [];
  const saved = look ? store.isSaved(look) : false;
  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <span className="t-eyebrow">{today()}</span>
          <h1 className="t-large">Outfit of the day</h1>
          <p className="t-sub">
            {t.weather
              ? `Picked for today’s weather${t.weather.place ? (t.weather.place.startsWith("Near ") ? ` near ${t.weather.place.slice(5)}` : ` in ${t.weather.place}`) : ""} from ${store.wardrobe?.name ?? "your wardrobe"}.`
              : `A new pick from ${store.wardrobe?.name ?? "your wardrobe"} every morning.`}
          </p>
        </div>
        {look && (
          <div className="page-head__actions">
            <button className="btn" onClick={app.pickAnother} disabled={t.looks.length < 2}>
              <Icon name="shuffle" />
              Pick another
            </button>
            <button className="btn btn--primary" aria-pressed={saved} onClick={() => app.saveLook(look)}>
              <Icon name="saved" filled={saved} />
              {saved ? "Saved" : "Save outfit"}
            </button>
          </div>
        )}
      </div>
      {t.weather ? <WeatherCard weather={t.weather} advice={t.advice} /> : <LocationPrompt app={app} />}
      <ErrorNote text={t.error} />
      {t.missing.length > 0 && <WorthAdding app={app} />}
      {!look ? (
        <Empty
          text={
            t.busy || store.loading
              ? "Picking today’s outfit…"
              : "Add a top, bottoms and shoes, or a dress and shoes, and an outfit appears here every morning."
          }
          action={t.busy || store.loading ? undefined : { label: "Add a piece", run: app.openAdd }}
        />
      ) : (
        <div className="today">
          <div className="card outfit today__look" key={items.map((i) => i.id).join()}>
            <Palette items={items} style={{ margin: "20px 20px 0", height: 10, borderRadius: 5 }} />
            <div className="look pieces stagger" style={{ padding: 20, gap: 18, gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
              {items.map((p) => (
                <button key={p.id} className="piece" onClick={() => app.go({ name: "piece", id: p.id })} style={{ border: 0, padding: 0, background: "none", textAlign: "left" }}>
                  <span className="piece__media">
                    <PieceArt piece={p} />
                  </span>
                  <span className="piece__text">
                    <span className="piece__role">{roleOf(p)}</span>
                    <span className="color-label piece__color" style={{ fontSize: 15 }}>
                      <span className="swatch" style={{ background: p.color }} />
                      <span className="color-label__name" data-tip={`${colorName(p.color)}, ${p.color.toUpperCase()}`}>
                        {p.name}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <aside className="today__aside">
            {look.score !== undefined && (
              <div className="card card--pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span className="t-eyebrow">Match score</span>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span className="big-score">
                    {look.score}
                    <small>%</small>
                  </span>
                  <span className="t-head">{verdict(look.score)}</span>
                </div>
                <Facets look={look} column />
              </div>
            )}
            <div className="card card--pad">
              <span className="t-eyebrow">Colours in this look</span>
              <ul className="color-list" style={{ marginTop: 6 }}>
                {items.map((p) => (
                  <li key={p.id}>
                    <span className="color-label">
                      <span className="swatch swatch--lg" style={{ background: p.color }} />
                      <span>
                        <span className="t-head" style={{ display: "block" }}>
                          {colorName(p.color)}
                        </span>
                        <span className="t-cap muted">{roleOf(p)}</span>
                      </span>
                    </span>
                    <span className="t-foot muted">{capital(p.texture)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <button className="btn btn--block" onClick={() => app.go({ name: "studio" })}>
              <Icon name="studio" />
              See all outfits
            </button>
          </aside>
        </div>
      )}
    </>
  );
}

// ── Weather ─────────────────────────────────────────────────────────────────
function WeatherCard({ weather: w, advice }: { weather: Weather; advice: string[] }) {
  return (
    <section className="card weather" aria-label="Today’s weather">
      <div className="weather__now">
        <span className="t-eyebrow weather__place">
          <Icon name="pin" />
          {w.place ?? "Your location"}
        </span>
        <span className="t-cap muted num" title="The forecast is for this exact point">
          {coordinates(w.latitude, w.longitude)}
        </span>
        <span className="big-score">
          {w.temp_now}
          <small>°C</small>
        </span>
        <span className="t-head">{w.summary}</span>
      </div>
      <dl className="weather__facts">
        <div>
          <dt>Feels like</dt>
          <dd className="num">{w.feels_like}°</dd>
        </div>
        <div>
          <dt>High / low</dt>
          <dd className="num">
            {w.temp_max}° / {w.temp_min}°
          </dd>
        </div>
        <div>
          <dt>Rain</dt>
          <dd className="num">{w.rain_chance}%</dd>
        </div>
        <div>
          <dt>Wind</dt>
          <dd className="num">{w.wind} km/h</dd>
        </div>
      </dl>
      {advice.length > 0 && (
        <ul className="weather__advice">
          {advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

const coordinates = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;

function LocationPrompt({ app }: { app: App }) {
  const { geo } = app.today;
  if (geo === "unsupported" || geo === "ok") return null;
  return (
    <section className="card card--pad location">
      <span className="tile__icon">
        <Icon name="sun" />
      </span>
      <div style={{ flex: 1, minWidth: 220 }}>
        <h2 className="t-head">Dress for today’s weather</h2>
        <p className="t-foot muted">
          {geo === "denied"
            ? "Location is turned off for this site. Allow it in your browser’s site settings to get picks for the forecast."
            : geo === "failed"
              ? "We couldn’t find your location. Try again."
              : "Outfitly uses your approximate location (about 1 km) only to get today’s forecast."}
        </p>
      </div>
      {geo !== "denied" && (
        <button className={`btn btn--primary${geo === "asking" ? " btn--busy" : ""}`} onClick={app.locate} disabled={geo === "asking"}>
          {geo === "asking" ? "Locating…" : "Use my location"}
        </button>
      )}
    </section>
  );
}

function WorthAdding({ app }: { app: App }) {
  return (
    <section className="section">
      <div className="section__head">
        <h2 className="t-title">Worth adding for today</h2>
      </div>
      <div className="tiles stagger">
        {app.today.missing.map((m) => (
          <button key={m.key} className="tile" onClick={app.openAdd}>
            <span className="tile__icon">
              <Icon name="plus" />
            </span>
            <span className="tile__chev">
              <Icon name="chevron" />
            </span>
            <span className="t-title2">{m.item}</span>
            <p>{m.reason}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Wardrobes (landing) ─────────────────────────────────────────────────────
// Short lines under the sample wardrobes' names; your own wardrobes show their saved outfits.
const SAMPLE_TAGLINES: Record<string, string> = {
  demo: "Your daily rotation",
  travel: "A lighter kind of packing",
  city: "Dresses, skirts and heels",
};

export function Wardrobes({ app }: { app: App }) {
  const { store } = app;
  const open = (id: string) => {
    store.selectWardrobe(id);
    app.go({ name: "wardrobe" });
  };
  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <span className="t-eyebrow wardrobes__eyebrow">A little more you</span>
          <h1 className="t-large">Your wardrobes</h1>
          <p className="t-sub">Good outfits begin with what you already own.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={app.newWardrobe}>
            <Icon name="plus" />
            New wardrobe
          </button>
        </div>
      </div>
      {store.catalogLoading && !store.wardrobes.length ? (
        <Empty text="Loading your wardrobes…" />
      ) : (
        <div className="wardrobe-cards stagger">
          {store.wardrobes.map((w, i) => {
            const s = store.summaries[w.id];
            const tagline = store.demo
              ? SAMPLE_TAGLINES[w.id]
              : w.id === store.wid && store.saved.length
                ? plural(store.saved.length, "saved outfit")
                : null;
            return (
              <button key={w.id} className="wardrobe-card" onClick={() => open(w.id)} aria-label={`${w.name}, ${plural(s?.count ?? 0, "piece")}`}>
                <span className={`wardrobe-card__media wardrobe-card__media--${i % 2 ? "b" : "a"}`}>
                  {s?.preview.length ? (
                    s.preview.map((p) => (
                      <span key={p.id} className="wardrobe-card__piece">
                        <PieceArt piece={p} />
                      </span>
                    ))
                  ) : (
                    <span className="t-foot muted">Empty for now. Add a first piece.</span>
                  )}
                </span>
                <span className="wardrobe-card__body">
                  <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <span className="t-title2 wardrobe-card__name">{w.name}</span>
                    <span className="t-foot muted">
                      {s ? plural(s.count, "piece") : "…"}
                      {tagline ? ` · ${tagline}` : ""}
                    </span>
                  </span>
                  <span className="wardrobe-card__arrow">
                    <Icon name="arrow" />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <button className="wardrobe-new" onClick={app.newWardrobe}>
        <Icon name="plus" />
        Make room for a new collection
      </button>
      <p className="t-foot muted wardrobes__footnote">Separate by season, occasion, or wherever life takes you.</p>
    </>
  );
}

// ── Wardrobe ────────────────────────────────────────────────────────────────
export function Wardrobe({ app }: { app: App }) {
  const { store } = app;
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<"all" | Category>("all");
  const q = query.trim().toLowerCase();
  const match = (p: Piece) =>
    !q || [p.name, colorName(p.color), p.texture, p.style, p.category].some((v) => v.toLowerCase().includes(q));
  const sections = categories
    .filter((c) => cat === "all" || c.key === cat)
    .map((c) => ({ ...c, items: store.pieces.filter((p) => p.category === c.key && match(p)) }))
    .filter((s) => s.items.length);
  return (
    <>
      <button className="back-link" onClick={() => app.go({ name: "wardrobes" })}>
        <Icon name="back" />
        All wardrobes
      </button>
      <div className="page-head">
        <div className="page-head__text">
          <h1 className="t-large">{store.wardrobe?.name ?? "Wardrobe"}</h1>
          <p className="t-sub">{plural(store.pieces.length, "piece")}, every colour named for you</p>
        </div>
        <div className="page-head__actions">
          <label className="search">
            <Icon name="search" />
            <input type="search" placeholder="Search pieces" aria-label="Search pieces" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button className="btn" onClick={() => app.go({ name: "studio" })}>
            <Icon name="studio" />
            Create outfits
          </button>
          <button className="btn btn--primary" onClick={app.openAdd}>
            <Icon name="plus" />
            Add a piece
          </button>
        </div>
      </div>
      <Seg
        label="Category"
        className="cat-seg"
        value={cat}
        onChange={setCat}
        options={[{ value: "all", label: "All" }, ...categoriesFor(app.wear, store.pieces).map((c) => ({ value: c.key, label: c.label }))]}
      />
      {sections.map((s) => (
        <section className="section" key={s.key}>
          <div className="section__head">
            <h2 className="t-title">
              {s.label}
              <span className="count-pill">{s.items.length}</span>
            </h2>
          </div>
          <div className="grid stagger">
            {s.items.map((p) => (
              <ItemCard key={p.id} piece={p} app={app} meta="colour+fabric" removable={!store.demo} />
            ))}
          </div>
        </section>
      ))}
      {!sections.length && (
        <Empty
          text={
            store.loading
              ? "Loading your pieces…"
              : q
                ? `Nothing matches “${query.trim()}”.`
                : "This wardrobe is empty. Add a photo of a piece and Outfitly fills in the details."
          }
          action={store.loading || q ? undefined : { label: "Add a piece", run: app.openAdd }}
        />
      )}
    </>
  );
}

// ── Piece detail ────────────────────────────────────────────────────────────
export function PieceDetail({ app, id }: { app: App; id: string }) {
  const { store } = app;
  const piece = store.pieces.find((p) => p.id === id);
  const looks = store.saved.filter((l) => l.items.some((i) => i.id === id));
  if (!piece)
    return (
      <>
        <button className="back-link" onClick={() => app.go({ name: "wardrobe" })}>
          <Icon name="back" />
          {store.wardrobe?.name ?? "Wardrobe"}
        </button>
        <Empty text={store.loading ? "Loading…" : "This piece is no longer in this wardrobe."} />
      </>
    );
  const category = categories.find((c) => c.key === piece.category);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <button className="back-link" onClick={() => app.go({ name: "wardrobe" })}>
          <Icon name="back" />
          {store.wardrobe?.name ?? "Wardrobe"}
        </button>
        <section className="detail">
          <div className="hero-media" style={{ flex: "5 1 320px", aspectRatio: "4 / 3" }}>
            <PieceArt piece={piece} label />
          </div>
          <div className="detail__info">
            <span className="chip">
              {category?.one ?? piece.category}
              {piece.garment ? ` · ${capital(piece.garment)}` : ""}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h1 className="t-large">{piece.name}</h1>
              <span className="color-label" style={{ gap: 10 }}>
                <span className="swatch swatch--lg" style={{ background: piece.color }} />
                <span className="t-head" data-tip={piece.color.toUpperCase()}>
                  {colorName(piece.color)}
                </span>
              </span>
            </div>
            <dl className="spec">
              <div>
                <dt>Fabric</dt>
                <dd>{capital(piece.texture)}</dd>
              </div>
              <div>
                <dt>Style</dt>
                <dd>{piece.style}</dd>
              </div>
              <div>
                <dt>In saved outfits</dt>
                <dd className="num">{looks.length}</dd>
              </div>
            </dl>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                className="btn btn--primary"
                onClick={() => {
                  // A jacket can only anchor outfits that include a layer.
                  app.runStudio({ anchorId: piece.id, includeJacket: piece.category === "jackets" ? true : app.studio.includeJacket });
                  app.go({ name: "studio" });
                }}
              >
                <Icon name="studio" />
                Outfits with this
              </button>
              <button className="btn" onClick={() => app.openInLab(piece)}>
                <Icon name="lab" />
                Try in the lab
              </button>
              <button className="btn btn--danger" onClick={() => (store.demo ? app.requireAccount() : app.askRemove(piece))}>
                <Icon name="trash" />
                Remove
              </button>
            </div>
          </div>
        </section>
      </div>
      <AboutPiece app={app} piece={piece} />
      <section className="section" style={{ gap: 16 }}>
        <div className="section__head">
          <h2 className="t-title">
            Saved outfits with this piece<span className="count-pill">{looks.length}</span>
          </h2>
          <button className="section__link" onClick={() => app.go({ name: "saved" })}>
            See all saved
            <Icon name="chevron" />
          </button>
        </div>
        {looks.length ? (
          <div className="outfit-grid stagger">
            {looks.map((l) => (
              <OutfitCard
                key={l.id}
                look={l}
                onOpen={() => app.openOutfit(l)}
                facets={false}
                open={(p) => app.go({ name: "piece", id: p.id })}
                tag={<span className="chip chip--sm">{l.style}</span>}
              />
            ))}
          </div>
        ) : (
          <Empty text="No saved outfit uses this piece yet." />
        )}
      </section>
    </div>
  );
}

/** "About this piece": a written description and the pieces it pairs best with. */
function AboutPiece({ app, piece }: { app: App; piece: Piece }) {
  const about = describePiece(piece, app.store.pieces);
  return (
    <section className="section about" aria-labelledby="about-t">
      <h2 className="t-title" id="about-t">
        About this piece
      </h2>
      <div className="about__grid">
        <div className="card card--pad about__text">
          <p className="t-head">{about.summary}</p>
          {about.paragraphs.map((t) => (
            <p key={t} className="muted">
              {t}
            </p>
          ))}
        </div>
        {about.goesWith.length > 0 && (
          <div className="card card--pad about__pairs">
            <span className="t-eyebrow">Goes well with</span>
            {about.goesWith.map((p) => (
              <button key={p.id} className="about__pair" onClick={() => app.go({ name: "piece", id: p.id })}>
                <span className="about__thumb">
                  <PieceArt piece={p} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span className="t-head">{p.name}</span>
                  <ColorLabel hex={p.color} className="t-foot muted" />
                </span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Remove a piece (and the saved outfits that use it) ─────────────────────
export function RemoveDialog({ app, piece, onClose }: { app: App; piece: Piece | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Frozen when the dialog opens, so the text doesn't change while it fades out.
  const [shown, setShown] = useState(piece);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (piece) {
      setShown(piece);
      setN(app.store.saved.filter((l) => l.items.some((i) => i.id === piece.id)).length);
      setError("");
    }
  }, [piece]); // eslint-disable-line react-hooks/exhaustive-deps
  async function remove() {
    if (!shown) return;
    setBusy(true);
    setError("");
    try {
      const removed = await app.store.removePiece(shown);
      onClose();
      app.toast({ kind: "Removed", text: removed ? `${shown.name} and ${plural(removed, "saved outfit")}` : shown.name });
      app.go({ name: "wardrobe" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!piece} onClose={onClose} labelledBy="rm-t" describedBy="rm-d" alert width={380} top={180}>
      <div className="dialog__body" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 28, textAlign: "center" }}>
        <span className="alert__icon">
          <Icon name="trash" />
        </span>
        <h2 className="t-title2" id="rm-t">
          Remove {shown?.name.toLowerCase()}?
        </h2>
        <p className="muted" id="rm-d" style={{ fontSize: 14.5 }}>
          {n
            ? `${plural(n, "saved outfit")} ${n === 1 ? "uses" : "use"} this piece. ${n === 1 ? "It" : "They"} will be removed with it. This can’t be undone.`
            : "Its photo will be deleted. This can’t be undone."}
        </p>
        <ErrorNote text={error} />
      </div>
      <div className="dialog__foot">
        <button className="btn" onClick={onClose} data-autofocus>
          Keep piece
        </button>
        <button className={`btn btn--danger-solid${busy ? " btn--busy" : ""}`} onClick={remove} disabled={busy} aria-busy={busy}>
          {busy ? "Removing…" : n ? `Remove all ${n + 1}` : "Remove piece"}
        </button>
      </div>
    </Dialog>
  );
}

// ── Outfit studio ───────────────────────────────────────────────────────────
const directions = [
  { value: "balanced", label: "Balanced", hint: "A mix that sits well together", sw: ["#D8C7A8", "#2E3A52", "#6B6A43"] },
  { value: "tonal", label: "Tonal", hint: "Shades of one colour", sw: ["#9AA6BE", "#56637F", "#2E3A52"] },
  { value: "contrast", label: "Contrast", hint: "Light against dark", sw: ["#F3EEE3", "#8C8F88", "#232523"] },
];

export function Studio({ app }: { app: App }) {
  const { store, studio: s } = app;
  const dir = directions.find((d) => d.value === s.harmony) ?? directions[0];
  const anchors = store.pieces.filter((p) => s.includeJacket || p.category !== "jackets");
  const anchor = store.pieces.find((p) => p.id === s.anchorId);
  const looks = (s.looks ?? []).filter((l) => s.filter === "all" || (s.filter === "layer" ? layered(l) : !layered(l)));
  const summary = [s.style, dir.label.toLowerCase(), s.includeJacket ? "with a layer" : "no layer", anchor ? `around your ${anchor.name.toLowerCase()}` : "any piece"].join(", ");
  return (
    <>
      <div className="page-head__text">
        <h1 className="t-large">Outfit studio</h1>
        <p className="t-sub">Every combination in {store.wardrobe?.name ?? "your wardrobe"} that works, best first.</p>
      </div>
      <div className="studio">
        <section className="card studio__settings" aria-label="Outfit settings">
          <fieldset>
            <legend className="t-head legend-row">
              Start from a piece<span className="t-foot muted">Optional</span>
            </legend>
            <div className="anchors">
              {[null, ...anchors].map((p) => {
                const on = (p?.id ?? "") === s.anchorId;
                return (
                  <button
                    key={p?.id ?? "any"}
                    className="anchor"
                    aria-pressed={on}
                    aria-label={p ? p.name : "Any piece"}
                    title={p ? `${p.name}, ${colorName(p.color)}` : "Any piece"}
                    onClick={() => app.setStudio({ anchorId: p?.id ?? "" })}
                  >
                    {p ? <PieceArt piece={p} /> : <span>Any</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="t-head">Style</legend>
            <div className="pills">
              {styles.map((label) => (
                <button key={label} className="pill" aria-pressed={s.style === label} onClick={() => app.setStudio({ style: label })}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <legend className="t-head">Colour direction</legend>
            <Seg label="Colour direction" radio value={s.harmony} onChange={(v) => app.setStudio({ harmony: v })} options={directions} />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="palette" style={{ margin: 0, width: 84, flex: "none" }}>
                {dir.sw.map((c, i) => (
                  <span key={i} style={{ background: c, transition: "background-color 260ms ease" }} />
                ))}
              </span>
              <span className="t-foot muted">{dir.hint}</span>
            </div>
          </fieldset>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span id="lyr" className="t-head">
                Add a layer
              </span>
              <span className="t-foot muted">Include a jacket or overshirt</span>
            </span>
            <Switch
              checked={s.includeJacket}
              labelledBy="lyr"
              onChange={(v) => app.setStudio({ includeJacket: v, ...(!v && anchor?.category === "jackets" ? { anchorId: "" } : {}) })}
            />
          </div>
          <button
            className={`btn btn--primary btn--lg btn--block${s.busy ? " btn--busy" : ""}`}
            onClick={() => app.runStudio()}
            disabled={s.busy || !store.wid}
            aria-busy={s.busy}
          >
            <span style={{ transition: "filter 200ms ease", filter: s.busy ? "blur(0.5px)" : "none" }}>{s.busy ? "Matching…" : "Generate outfits"}</span>
          </button>
        </section>
        <section aria-labelledby="res" className="studio__results">
          <div className="toolbar">
            <div style={{ display: "flex", flexDirection: "column" }}>
              <h2 id="res" className="t-title">
                {s.looks ? plural(looks.length, "outfit") : "Your outfits"}
              </h2>
              <span className="t-foot muted">{s.looks ? summary : "Choose your settings, then generate."}</span>
            </div>
            <Seg
              label="Filter outfits"
              className="filter-seg"
              value={s.filter}
              onChange={(v) => app.setStudio({ filter: v })}
              options={[
                { value: "all", label: "All" },
                { value: "layer", label: "With layer" },
                { value: "none", label: "No layer" },
              ]}
            />
          </div>
          <ErrorNote text={s.error} />
          {s.busy ? (
            <div className="card busy-card">
              <span className="t-foot muted">Matching your pieces…</span>
            </div>
          ) : s.looks === null ? (
            store.demo ? (
              <div className="card video-board" aria-label="Sample pieces combining into outfits">
                <StudioLoopVideo />
              </div>
            ) : (
              <Empty text={store.pieces.length ? "Pick a style and a colour direction, then press Generate outfits." : "Add a top, bottoms and shoes, or a dress and shoes, first."} />
            )
          ) : looks.length ? (
            <div className="outfit-grid stagger">
              {looks.map((l) => {
                const saved = store.isSaved(l);
                return (
                  <OutfitCard
                    key={l.items.map((i) => i.id).join()}
                    look={l}
                    onOpen={() => app.openOutfit(l)}
                    open={(p) => app.go({ name: "piece", id: p.id })}
                    tag={layered(l) ? <span className="chip chip--sm">Layered</span> : undefined}
                  >
                    <div className="outfit__foot">
                      <button className="btn btn--tinted btn--block outfit__save" aria-pressed={saved} onClick={() => app.saveLook(l)}>
                        <Icon name="saved" filled={saved} />
                        {saved ? "Saved" : "Save outfit"}
                      </button>
                    </div>
                  </OutfitCard>
                );
              })}
            </div>
          ) : (
            <Empty text="No outfit matches this filter." />
          )}
        </section>
      </div>
    </>
  );
}

// ── Saved ───────────────────────────────────────────────────────────────────
export function Saved({ app, tab: kind }: { app: App; tab: SavedTab }) {
  const { store } = app;
  const clothes = app.nextBuys.wishlist;
  const suggested = app.nextBuys.savedLooks;
  const [tab, setTab] = useState("all");
  const [all, setAll] = useState<Record<string, Look[]>>({});
  const [error, setError] = useState("");
  // Every wardrobe's saved outfits; the selected wardrobe's come straight from the store.
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(store.wardrobes.map((w) => store.loadSaved(w.id, controller.signal).then((l) => [w.id, l] as const)))
      .then((entries) => !controller.signal.aborted && setAll(Object.fromEntries(entries)))
      .catch((e) => !controller.signal.aborted && setError(e.message));
    return () => controller.abort();
  }, [store.wardrobes, store.loadSaved]);
  const outfitsIn = (w: { id: string }) => (w.id === store.wid ? store.saved : (all[w.id] ?? []));
  const outfitCount = store.wardrobes.reduce((n, w) => n + outfitsIn(w).length, 0);
  const list = store.wardrobes
    .filter((w) => tab === "all" || w.id === tab)
    .flatMap((w) => (w.id === store.wid ? store.saved : (all[w.id] ?? [])).map((look) => ({ look, w })));
  async function unsave(look: Look, wid: string) {
    try {
      await store.unsave(look, wid);
      setAll((a) => ({ ...a, [wid]: (a[wid] ?? []).filter((l) => l.id !== look.id) }));
      app.toast({ kind: "Removed", text: `${look.style} outfit`, tone: "plain" });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-head__text">
        <h1 className="t-large">Saved</h1>
        <p className="t-sub">
          {kind === "clothes"
            ? "Pieces you’d like to buy, kept until you do."
            : kind === "suggested"
              ? "Outfit ideas that need a new piece or two. Add the pieces and they become your saved outfits."
              : "Looks you’ve kept for later."}
        </p>
      </div>
      <Seg
        label="Show"
        className="saved-kind"
        value={kind}
        onChange={(v) => app.go({ name: "saved", tab: v as SavedTab })}
        style={{ width: "min(480px, 100%)" }}
        options={[
          { value: "outfits", label: `Outfits${outfitCount ? ` · ${outfitCount}` : ""}` },
          { value: "clothes", label: `Clothes${clothes.length ? ` · ${clothes.length}` : ""}` },
          { value: "suggested", label: `Suggested${suggested.length ? ` · ${suggested.length}` : ""}` },
        ]}
      />
      {kind === "clothes" ? (
        <SavedClothes app={app} />
      ) : kind === "suggested" ? (
        <SavedLooks app={app} />
      ) : (
      <>
      <div className="toolbar">
        <Seg
          label="Wardrobe"
          className="wardrobe-seg"
          value={tab}
          onChange={setTab}
          optStyle={{ padding: "0 8px" }}
          style={{ width: `min(${170 * (store.wardrobes.length + 1)}px, 100%)` }}
          options={[{ value: "all", label: "All" }, ...store.wardrobes.map((w) => ({ value: w.id, label: w.name }))]}
        />
        <span className="toolbar__count" aria-live="polite">
          {plural(list.length, "outfit")}
        </span>
      </div>
      <ErrorNote text={error} />
      {list.length ? (
        <div className="outfit-grid stagger">
          {list.map(({ look, w }) => (
            <OutfitCard
              key={look.id}
              look={look}
              onOpen={() => app.openOutfit(look)}
              facets={false}
              label={look.style}
              sub={look.score !== undefined ? `${w.name}, ${look.score}% match` : w.name}
              open={(p) => {
                if (w.id !== store.wid) store.selectWardrobe(w.id);
                app.go({ name: "piece", id: p.id });
              }}
            >
              <div className="outfit__foot" style={{ paddingTop: 12 }}>
                <button
                  className="btn btn--tinted outfit__save"
                  style={{ flex: 1 }}
                  onClick={() => {
                    if (w.id !== store.wid) store.selectWardrobe(w.id);
                    app.setStudio({ style: look.style, includeJacket: layered(look), anchorId: "" });
                    app.go({ name: "studio" });
                  }}
                >
                  Open in studio
                </button>
                <button className="icon-btn icon-btn--fill" aria-label={`Unsave ${look.style} outfit`} onClick={() => unsave(look, w.id)}>
                  <Icon name="saved" filled />
                </button>
              </div>
            </OutfitCard>
          ))}
        </div>
      ) : (
        <Empty text="Nothing saved yet. Save an outfit in the studio and it waits for you here." action={{ label: "Open the studio", run: () => app.go({ name: "studio" }) }} />
      )}
      </>
      )}
    </>
  );
}

// ── Add a piece: photo in, details filled in ───────────────────────────────
type Draft = { name: string; category: Category; garment: string; texture: string; style: string; color: string };
const blank: Draft = { name: "", category: "tops", garment: "", texture: "cotton", style: "Everyday", color: "#8b927a" };
/** What a suggestion already knows about a piece the user owns; the photo fills in the rest. */
export type AddPrefill = Partial<Draft>;
// A type only makes sense within its category ("shorts" is never a top).
const fitType = (d: Draft): Draft => (garmentTypes[d.category].includes(d.garment) ? d : { ...d, garment: "" });
const WEAR_OPTIONS: { value: Wear; label: string }[] = [
  { value: "women", label: "Women’s" },
  { value: "men", label: "Men’s" },
  { value: "both", label: "Both" },
];

export function AddPiece({ app, open, onClose, prefill }: { app: App; open: boolean; onClose: () => void; prefill?: AddPrefill | null }) {
  const { store } = app;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [draft, setDraft] = useState<Draft>(blank);
  const [phase, setPhase] = useState<"empty" | "reading" | "done" | "partial">("empty");
  const [target, setTarget] = useState(store.wid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  // Colour chips are built around the detected colour and stay put while the user picks.
  const [detected, setDetected] = useState(blank.color);
  const input = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  // Fields the user changed are never overwritten by a late detection result.
  const edited = useRef(new Set<keyof Draft>());

  useEffect(() => {
    if (!open) return;
    run.current++;
    edited.current.clear();
    // From a suggestion: its name, category, type and style are kept; colour and fabric are
    // left for the photo to confirm, since the user's own piece may differ a little.
    for (const key of ["name", "category", "garment", "style"] as const) if (prefill?.[key]) edited.current.add(key);
    setFile(null);
    setDraft(fitType({ ...blank, ...prefill }));
    setDetected(prefill?.color ?? blank.color);
    setPhase("empty");
    setError("");
    setTarget(store.wid);
  }, [open, store.wid, prefill]);
  useEffect(() => {
    if (!file) return setPreview("");
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    edited.current.add(key);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  async function choose(next?: File | null) {
    if (!next) return;
    if (!/^image\/(jpeg|png|webp)$/.test(next.type)) return setError("Use a JPG, PNG or WebP photo.");
    const id = ++run.current;
    edited.current.clear();
    setFile(next);
    setError("");
    setPhase("reading");
    try {
      const found = await store.analyze(next);
      if (id !== run.current) return;
      setDraft((d) => {
        const merged = { ...d };
        for (const key of Object.keys(d) as (keyof Draft)[]) {
          const value = found[key as keyof typeof found];
          if (typeof value === "string" && value && !edited.current.has(key)) (merged as Record<string, string>)[key] = value;
        }
        return fitType(merged);
      });
      if (found.color && !edited.current.has("color")) setDetected(found.color);
      setPhase(found.detected ? "done" : "partial");
    } catch (e) {
      if (id !== run.current) return;
      setPhase("partial");
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!file || !draft.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const added = await store.addPiece(file, { ...draft, name: draft.name.trim() }, target);
      onClose();
      const w = store.wardrobes.find((x) => x.id === target);
      const done = added.completed ?? [];
      if (done.length) {
        // A saved suggested outfit now has all its pieces: it's a real saved outfit.
        app.toast({
          kind: "Outfit complete",
          text: done.length === 1 ? `“${done[0].name}” is now one of your saved outfits` : `${done.length} suggested outfits are now saved outfits`,
          action: { label: "View", run: () => app.go({ name: "saved" }) },
        });
      } else {
        app.toast({ kind: "Added", text: `${draft.name.trim()} is in ${w?.name ?? "your wardrobe"}` });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const reading = phase === "reading";
  const choices = useMemo(() => colorChoices(detected), [detected]);
  const exact = !choices.some((c) => c.hex === draft.color.toLowerCase());
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    choose(e.dataTransfer.files?.[0]);
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="add-t" width="min(600px, 100%)">
      <DialogHead id="add-t" title="Add a piece" onClose={onClose} />
      <div className="dialog__body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
        {file ? (
          <div className="dropzone dropzone--filled">
            {preview && <img src={preview} alt="Your photo" />}
            {reading && <span className="scanline" aria-hidden="true" />}
            <span className="dropzone__name">{file.name}</span>
            <button className="btn btn--sm dropzone__again" onClick={() => input.current?.click()}>
              Choose another
            </button>
          </div>
        ) : (
          <div
            className={`dropzone${drag ? " is-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={drop}
          >
            <div className="dropzone__empty">
              <span className="tile__icon">
                <Icon name="camera" />
              </span>
              <button className="btn btn--primary" onClick={() => input.current?.click()} data-autofocus>
                Choose a photo
              </button>
              <p className="t-foot muted">
                Outfitly fills in the name, category, fabric, style and main colour. JPG, PNG or WebP, up to 10 MB.
              </p>
            </div>
          </div>
        )}
        <p role="status" className="t-foot status-line">
          {reading && <span className="muted">Reading your photo…</span>}
          {phase === "done" && <span>Filled in from your photo. Change anything before you save.</span>}
          {phase === "partial" && <span className="muted">We named the colour. Choose the rest yourself.</span>}
        </p>
        <ErrorNote text={error} />
        <div className="field">
          <span className="field__label" id="cat-l">
            Category
          </span>
          <Seg
            label="Category"
            radio
            className="seg--lg"
            value={draft.category}
            onChange={(v) => {
              edited.current.add("category");
              setDraft((d) => fitType({ ...d, category: v }));
            }}
            options={categoriesFor(app.wear, store.pieces).map((c) => ({ value: c.key, label: c.one }))}
          />
        </div>
        <div className="fields">
          <label className="field">
            <span className="field__label">Name</span>
            <span className="fill-wrap">
              {reading && <span className="skeleton" style={{ width: "60%" }} />}
              <input className={`input fill-text${reading ? " is-pending" : ""}`} value={draft.name} maxLength={80} placeholder={reading ? "" : "Relaxed linen shirt"} onChange={(e) => edit("name", e.target.value)} />
            </span>
          </label>
          {(
            [
              [
                "Type",
                draft.garment,
                (v: string) => edit("garment", v),
                [{ value: "", label: "Not sure" }, ...typesFor(draft.category, app.wear, draft.garment).map((t) => ({ value: t, label: capital(t) }))],
                "40%",
              ],
              ["Fabric", draft.texture, (v: string) => edit("texture", v), textures.map((t) => ({ value: t, label: capital(t) })), "46%"],
              ["Style", draft.style, (v: string) => edit("style", v), styles.map((t) => ({ value: t, label: t })), "50%"],
              ["Wardrobe", target, setTarget, store.wardrobes.map((w) => ({ value: w.id, label: w.name })), "64%"],
            ] as const
          ).map(([label, value, onChange, options, width], i) => (
            <div
              key={label}
              className={`fill-select${reading && label !== "Wardrobe" ? " is-pending" : ""}`}
              style={{ ["--d" as string]: `${(i + 1) * 70}ms`, ["--sk" as string]: width, ...(label === "Wardrobe" ? { gridColumn: "1 / -1" } : {}) }}
            >
              <Select label={label} className="field" value={value} onChange={onChange} options={[...options]} />
            </div>
          ))}
        </div>
        <fieldset className="plain">
          <legend className="field__label" style={{ padding: 0, marginBottom: 10 }}>
            Main colour
          </legend>
          <div className="colour-chips" role="radiogroup" aria-label="Main colour">
            {choices.map((c) => (
              <button key={c.name} className="chip colour-chip" role="radio" aria-checked={c.hex === draft.color.toLowerCase()} onClick={() => edit("color", c.hex)}>
                <span className="swatch" style={{ background: c.hex }} />
                {c.name}
              </button>
            ))}
            <label className="chip colour-chip colour-chip--custom" aria-checked={exact} role="radio">
              <input type="color" value={draft.color} onChange={(e) => edit("color", e.target.value)} aria-label="Pick an exact colour" />
              {exact ? colorName(draft.color) : "Exact colour"}
            </label>
          </div>
        </fieldset>
      </div>
      <div className="dialog__foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className={`btn btn--primary${reading || busy ? " btn--busy" : ""}`}
          onClick={save}
          disabled={!file || reading || busy || !draft.name.trim() || !target}
          aria-busy={reading || busy}
        >
          <Icon name="plus" />
          {reading ? "Reading photo…" : busy ? "Adding…" : "Add to wardrobe"}
        </button>
      </div>
    </Dialog>
  );
}

// ── Account and wardrobe dialogs ────────────────────────────────────────────
export function AuthDialog({ open, onClose, onSignedIn, call }: { open: boolean; onClose: () => void; onSignedIn: (token: string, remember: boolean) => void; call: Store["call"] }) {
  const [register, setRegister] = useState(false);
  // On by default: most people sign in on their own phone or laptop. Off on a shared computer.
  const [remember, setRemember] = useState(true);
  const [wear, setWear] = useState<Wear | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) setError("");
  }, [open]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await call<{ token: string }>(register ? "/auth/register" : "/auth/login", "POST", {
        email: String(f.get("email") ?? "").trim(),
        password: f.get("password"),
        ...(register && wear ? { wear } : {}),
        remember,
      });
      onSignedIn(result.token, remember);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} labelledBy="auth-t" width="min(440px, 100%)" top={96}>
      <DialogHead id="auth-t" title={register ? "Create your account" : "Sign in"} onClose={onClose} />
      <form onSubmit={submit}>
        <div className="dialog__body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p className="t-foot muted">
            {register ? "Keep your own wardrobes, photos and saved outfits." : "Welcome back. Your wardrobes are waiting."}
          </p>
          <label className="field">
            <span className="field__label">Email</span>
            <input className="input" name="email" type="email" required autoComplete="email" data-autofocus />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input className="input" name="password" type="password" minLength={10} maxLength={128} required autoComplete={register ? "new-password" : "current-password"} />
            <span className="t-cap muted">At least 10 characters</span>
          </label>
          {register && (
            <fieldset className="plain field">
              <legend className="field__label" style={{ padding: 0, marginBottom: 8 }}>
                I mostly wear
              </legend>
              <div className="pills" role="radiogroup" aria-label="I mostly wear">
                {WEAR_OPTIONS.map((o) => (
                  <button key={o.value} type="button" className="pill" role="radio" aria-checked={wear === o.value} aria-pressed={wear === o.value} onClick={() => setWear(o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
              <span className="t-cap muted">Sets which clothes and outfit ideas we suggest. You can change it in your profile.</span>
            </fieldset>
          )}
          <div className="remember">
            <span className="remember__text">
              <span className="remember__label" id="remember-l">
                Remember me
              </span>
              <span className="t-cap muted" id="remember-d">
                {remember ? "Stay signed in on this device for 30 days." : "You’ll be signed out when you close the browser."}
              </span>
            </span>
            <Switch checked={remember} onChange={setRemember} labelledBy="remember-l" />
          </div>
          <ErrorNote text={error} />
        </div>
        <div className="dialog__foot" style={{ flexDirection: "column" }}>
          <button className={`btn btn--primary${busy ? " btn--busy" : ""}`} disabled={busy}>
            {busy ? "One moment…" : register ? "Create account" : "Sign in"}
          </button>
          <button type="button" className="btn btn--plain" onClick={() => setRegister(!register)}>
            {register ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function NewWardrobeDialog({ app, open, onClose }: { app: App; open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) {
      setError("");
      setName("");
    }
  }, [open]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const w = await app.store.createWardrobe(name.trim());
      onClose();
      app.toast({ kind: "Created", text: w.name });
      app.go({ name: "wardrobe" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} labelledBy="nw-t" width="min(440px, 100%)" top={120}>
      <DialogHead id="nw-t" title="New wardrobe" onClose={onClose} />
      <form onSubmit={submit}>
        <div className="dialog__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field">
            <span className="field__label">Name</span>
            <input className="input" required maxLength={80} placeholder="For example, Ski trip" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
          </label>
          <ErrorNote text={error} />
        </div>
        <div className="dialog__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn btn--primary${busy ? " btn--busy" : ""}`} disabled={busy || !name.trim()}>
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}
