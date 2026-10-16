import { useEffect, useRef, useState, type ReactNode } from "react";
import { colorName, ringDash, verdict } from "./colors";
import { apiBase, categories, TOKEN_KEY, type Look, type Piece } from "./store";

// ── Icons (24px grid, stroke 1.75 — see .ic in ow.css) ─────────────────────
const paths = {
  home: ["M4 11l8-7 8 7v9h-5v-6h-6v6H4z"],
  today: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  wardrobe: ["M5 3h14v18H5z", "M12 3v18", "M9.5 11v2", "M14.5 11v2"],
  studio: ["M12 3 3 8l9 5 9-5-9-5z", "M3 13l9 5 9-5"],
  saved: ["M6 3h12v18l-6-4-6 4z"],
  plus: ["M12 5v14", "M5 12h14"],
  camera: ["M4 8h3l2-3h6l2 3h3v11H4z", "M12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"],
  chevron: ["M9 6l6 6-6 6"],
  back: ["M15 6l-6 6 6 6"],
  down: ["M6 9l6 6 6-6"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M20 20l-4-4"],
  shuffle: ["M4 7h3c4 0 6 10 10 10h3", "M4 17h3c1.6 0 2.8-1.6 3.9-3.6", "M13.1 9.6C14.2 7.6 15.4 7 17 7h3", "M17 4l3 3-3 3", "M17 14l3 3-3 3"],
  sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v2", "M12 20v2", "M2 12h2", "M20 12h2"],
  moon: ["M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"],
  out: ["M15 4h4v16h-4", "M10 8l-4 4 4 4", "M6 12h10"],
  play: ["M8 5.5v13l10-6.5z"],
  pin: ["M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z", "M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"],
  pause: ["M8 5h2.5v14H8z", "M13.5 5H16v14h-2.5z"],
  lab: ["M9 3h6", "M10 3v6l-5.2 9.1A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-2.9L14 9V3", "M7.5 15h9"],
};
export type IconName = keyof typeof paths;
export function Icon({ name, filled, style }: { name: IconName; filled?: boolean; style?: React.CSSProperties }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" style={filled ? { ...style, fill: "currentColor" } : style}>
      {paths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The coral "you are here" marker: the only coral outside the logo. */
export const Collar = ({ className = "nav__collar" }: { className?: string }) =>
  className === "nav__collar" ? (
    <svg className={className} viewBox="0 0 6 12" aria-hidden="true">
      <path d="M0 0 6 6 0 12Z" fill="#E8644A" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 10 5" aria-hidden="true">
      <path d="M0 0H10L5 5Z" fill="#E8644A" />
    </svg>
  );

// ── Colour: every swatch carries its name ──────────────────────────────────
export function ColorLabel({ hex, text, className = "", large }: { hex: string; text?: string; className?: string; large?: boolean }) {
  return (
    <span className={`color-label ${className}`}>
      <span className={large ? "swatch swatch--lg" : "swatch"} style={{ background: hex }} />
      <span className="color-label__name" data-tip={hex.toUpperCase()}>
        {text ?? colorName(hex)}
      </span>
    </span>
  );
}

export function Dots({ colors }: { colors: string[] }) {
  const list = colors.length ? colors : ["var(--fill-strong)"];
  return (
    <span className="dots" aria-hidden="true">
      {list.map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

// ── Segmented control with a sliding thumb ─────────────────────────────────
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  radio,
  className = "",
  style,
  optStyle,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  radio?: boolean;
  className?: string;
  style?: React.CSSProperties;
  optStyle?: React.CSSProperties;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`seg ${className}`} role={radio ? "radiogroup" : "group"} aria-label={label} style={style}>
      <span
        className="seg__thumb"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="seg__opt"
          style={optStyle}
          {...(radio ? { role: "radio", "aria-checked": o.value === value } : { "aria-pressed": o.value === value })}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, labelledBy }: { checked: boolean; onChange: (v: boolean) => void; labelledBy: string }) {
  return (
    <button type="button" className="switch" role="switch" aria-checked={checked} aria-labelledby={labelledBy} onClick={() => onChange(!checked)}>
      <span className="switch__knob" />
    </button>
  );
}

// ── Piece art: the photo when there is one, otherwise a flat illustration ──
const G = {
  knit: "M32 18 L43 14 Q50 22 57 14 L68 18 Q78 24 82 40 L86 80 L76 81 L70 46 L70 86 L30 86 L30 46 L24 81 L14 80 L18 40 Q22 24 32 18 Z",
  shirt: "M34 16 L44 12 L50 20 L56 12 L66 16 L82 30 L76 40 L68 34 L68 88 L32 88 L32 34 L24 40 L18 30 Z",
  tee: "M33 20 L43 15 Q50 23 57 15 L67 20 L84 33 L76 43 L68 38 L68 86 L32 86 L32 38 L24 43 L16 33 Z",
  pants: "M32 12 L68 12 L72 88 L56 88 L50 38 L44 88 L28 88 Z",
  jacket: "M34 14 L44 11 L50 32 L56 11 L66 14 L82 22 L88 80 L77 82 L71 44 L71 88 L29 88 L29 44 L23 82 L12 80 L18 22 Z",
  sneaker: "M10 56 L14 38 Q22 41 31 38 L46 49 Q62 53 80 55 Q91 57 91 66 L91 72 L10 72 Z",
  loafer: "M10 60 Q12 48 26 46 Q44 46 60 50 Q84 54 90 62 L90 70 L10 70 Z",
};
function shape(p: Piece) {
  const n = p.name.toLowerCase();
  if (p.category === "pants") return G.pants;
  if (p.category === "jackets") return G.jacket;
  if (p.category === "shoes") return /loafer|boot|derby|oxford|suede/.test(n) ? G.loafer : G.sneaker;
  if (/shirt|oxford|blouse/.test(n) && !/t-shirt|tee|sweat/.test(n)) return G.shirt;
  if (/knit|crew|sweater|jumper|cardigan|merino|hoodie|sweat/.test(n) || p.texture === "knit") return G.knit;
  return G.tee;
}

// Photos are private: fetched with the session token, cached as object URLs for the visit.
const photos = new Map<string, Promise<string>>();
function photoUrl(image: string) {
  const token = sessionStorage.getItem(TOKEN_KEY) ?? "";
  const key = `${token}:${image}`;
  let pending = photos.get(key);
  if (!pending) {
    pending = fetch(`${apiBase()}/images/${image}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? "Photo missing" : "Photo unavailable");
      return r.blob().then((b) => URL.createObjectURL(b));
    });
    pending.catch(() => photos.delete(key));
    photos.set(key, pending);
  }
  return pending;
}

export function PieceArt({ piece, label }: { piece: Piece; label?: boolean }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl("");
    setFailed(false);
    if (!piece.image) return;
    let active = true;
    photoUrl(piece.image)
      .then((u) => active && setUrl(u))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [piece.image]);
  if (piece.image && url) return <img src={url} alt={label ? piece.name : ""} />;
  if (piece.image && !failed) return <span className="skeleton" style={{ width: "40%" }} aria-hidden="true" />;
  return (
    <svg viewBox="0 0 100 100" {...(label ? { role: "img", "aria-label": piece.name } : { "aria-hidden": true })}>
      <path className="g" d={shape(piece)} fill={piece.color} />
    </svg>
  );
}

export const roleOf = (p: Piece) => categories.find((c) => c.key === p.category)?.role ?? p.category;
// Outfits read top to bottom: layer, top, pants, shoes.
const order = { jackets: 0, tops: 1, pants: 2, shoes: 3 } as const;
export const ordered = (items: Piece[]) => [...items].sort((a, b) => order[a.category] - order[b.category]);

// ── Score ───────────────────────────────────────────────────────────────────
export function Ring({ pct }: { pct: number }) {
  return (
    <div className="ring">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="ring__trk" cx="32" cy="32" r="27" />
        <circle className="ring__arc" cx="32" cy="32" r="27" transform="rotate(-90 32 32)" style={{ strokeDasharray: ringDash(pct) }} />
        <path className="ring__cut" d="M23 0 L32 10.5 L41 0 Z" />
      </svg>
      <span className="ring__val">{pct}</span>
    </div>
  );
}

export function Facets({ look, column }: { look: Look; column?: boolean }) {
  if (!look.breakdown) return null;
  const list: [string, number][] = [
    ["Meaning", look.breakdown.semantic],
    ["Colour", look.breakdown.color],
    ["Fabric", look.breakdown.texture],
    ...(look.breakdown.weather !== undefined ? ([["Weather", look.breakdown.weather]] as [string, number][]) : []),
  ];
  const facets = list.map(([label, v]) => (
    <div className="facet" key={label}>
      <div className="facet__top">
        <span>{label}</span>
        <b>{v}</b>
      </div>
      <div className="facet__bar">
        <i style={{ width: `${v}%` }} />
      </div>
    </div>
  ));
  return column ? <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>{facets}</div> : <div className="facets">{facets}</div>;
}

export function Palette({ items, style }: { items: Piece[]; style?: React.CSSProperties }) {
  return (
    <div className="palette" aria-hidden="true" style={style}>
      {items.map((p) => (
        <span key={p.id} style={{ background: p.color }} />
      ))}
    </div>
  );
}

export function Pieces({ items, open }: { items: Piece[]; open: (p: Piece) => void }) {
  return (
    <div className="pieces">
      {items.map((p) => (
        <button type="button" className="piece" key={p.id} onClick={() => open(p)} aria-label={`${p.name}, ${roleOf(p)}`} style={{ border: 0, padding: 0, background: "none", textAlign: "left" }}>
          <span className="piece__media">
            <PieceArt piece={p} />
          </span>
          <span className="piece__text">
            <span className="piece__role">{roleOf(p)}</span>
            <ColorLabel hex={p.color} className="piece__color" />
          </span>
        </button>
      ))}
    </div>
  );
}

/** Outfit card: score ring + verdict, palette, pieces, meaning/colour/fabric, footer. */
export function OutfitCard({
  look,
  open,
  label,
  sub,
  tag,
  facets = true,
  children,
}: {
  look: Look;
  open: (p: Piece) => void;
  label?: string;
  sub?: string;
  tag?: ReactNode;
  facets?: boolean;
  children?: ReactNode;
}) {
  const items = ordered(look.items);
  const pct = look.score;
  return (
    <article className="outfit" aria-label={pct === undefined ? look.style : `${label ?? verdict(pct)}, ${pct}% match`}>
      <header className="outfit__head">
        <div className="score">
          {pct !== undefined && <Ring pct={pct} />}
          <div>
            <div className="score__label">{label ?? (pct === undefined ? look.style : verdict(pct))}</div>
            <div className="score__sub num">{sub ?? (pct === undefined ? "" : `${pct}% match`)}</div>
          </div>
        </div>
        {tag}
      </header>
      <Palette items={items} />
      <Pieces items={items} open={open} />
      {facets && <Facets look={look} />}
      {children}
    </article>
  );
}

/** Runs after the closed state has painted, so an enter transition plays. Falls back to a
 *  timer because animation frames pause in background tabs. Returns a cancel function. */
function afterPaint(run: () => void) {
  let done = false;
  const once = () => {
    if (!done) {
      done = true;
      run();
    }
  };
  const frame = requestAnimationFrame(() => requestAnimationFrame(once));
  const timer = window.setTimeout(once, 60);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

// ── Toast: drops in from the top ────────────────────────────────────────────
export type ToastData = { kind: string; text: string; action?: { label: string; run: () => void }; tone?: "success" | "plain" };
export function Toast({ toast, onClose }: { toast: ToastData | null; onClose: () => void }) {
  const [shown, setShown] = useState<ToastData | null>(toast);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!toast) {
      setOpen(false);
      return;
    }
    setShown(toast);
    // Mount closed, then open once painted so the drop-in transition runs.
    const cancel = afterPaint(() => setOpen(true));
    const timer = window.setTimeout(onClose, 4200);
    return () => {
      cancel();
      clearTimeout(timer);
    };
  }, [toast, onClose]);
  if (!shown) return null;
  return (
    <div className={`toast${open ? " is-open" : ""}`} role="status" aria-live="polite">
      {shown.tone !== "plain" && (
        <span className="toast__icon">
          <Icon name="check" />
        </span>
      )}
      <span className="toast__text">
        <span className="toast__kind">{shown.kind}</span>
        {shown.text}
      </span>
      {shown.action && (
        <button type="button" className="btn btn--plain btn--sm" onClick={() => { shown.action!.run(); onClose(); }}>
          {shown.action.label}
        </button>
      )}
    </div>
  );
}

// ── Dialog: scales from 0.96, focus trapped, Escape closes ─────────────────
export function Dialog({
  open,
  onClose,
  labelledBy,
  describedBy,
  alert,
  width,
  top = 64,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  alert?: boolean;
  width?: number | string;
  top?: number;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const prior = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      prior.current = document.activeElement as HTMLElement;
      setMounted(true);
      return afterPaint(() => setVisible(true));
    }
    setVisible(false);
    // Exit is faster than entry (150-180ms in ow.css); unmount after it.
    const timer = window.setTimeout(() => setMounted(false), 200);
    prior.current?.focus?.();
    return () => clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!visible) return;
    const node = ref.current;
    const focusable = () =>
      Array.from(node?.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex='-1'])") ?? []);
    (node?.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()[0])?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab") return;
      const list = focusable();
      if (!list.length) return;
      const [first, last] = [list[0], list[list.length - 1]];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [visible, onClose]);
  if (!mounted) return null;
  return (
    <>
      <div className={`scrim${visible ? " is-open" : ""}`} onClick={onClose} aria-hidden="true" />
      <div className="dialog-wrap" style={{ ["--top" as string]: `${top}px` }}>
        <section
          ref={ref}
          className={`dialog${visible ? " is-open" : ""}`}
          role={alert ? "alertdialog" : "dialog"}
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          style={{ width }}
        >
          {children}
        </section>
      </div>
    </>
  );
}

export function DialogHead({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return (
    <div className="dialog__head">
      <h2 className="t-title2" id={id}>
        {title}
      </h2>
      <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
