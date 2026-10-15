import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Sparkles,
  Plus,
  ArrowUpRight,
  Layers3,
  Bookmark,
  Shirt,
  Check,
  X,
  SlidersHorizontal,
  Search,
  ArrowRight,
  LogOut,
  Menu,
  Sun,
  Moon,
  Monitor,
  Trash2,
} from "lucide-react";
import "./style.css";
import { useWardrobeCatalog } from "./useWardrobeCatalog";
import { motion, AnimatePresence, MotionConfig } from "motion/react";
import { resolveApiUrl, requestJson } from "./api";
import { validTheme, resolvedTheme, type Theme } from "./theme";
import { Logo, LogoSymbol } from "./brand";
import { StudioLoopVideo } from "./StudioLoopVideo";
import { Select } from "./Select";

// Strong ease-out (matches --ease in style.css): fast start, gentle settle.
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
type Category = "tops" | "pants" | "shoes" | "jackets";
type Draft = {
  name: string;
  category: string;
  texture: string;
  style: string;
  color: string;
};
type Analysis = "idle" | "running" | "done" | "partial";
const emptyDraft: Draft = {
  name: "",
  category: "tops",
  texture: "cotton",
  style: "Everyday",
  color: "#8b927a",
};
const textures = ["cotton", "denim", "knit", "leather", "linen", "silk", "other"];
// Below this confidence a detected field is flagged for the user to check.
const uncertainBelow = 0.5;
type Cloth = {
  id: string;
  name: string;
  category: Category;
  color: string;
  texture: string;
  style: string;
  image?: string;
};
type Look = {
  id?: string;
  name?: string;
  items: Cloth[];
  style: string;
  score?: number;
  breakdown?: Record<string, number>;
};
const rawApi = (import.meta as unknown as { env: Record<string, string> }).env
  .VITE_API_URL;
const appEnv = (import.meta as unknown as { env: Record<string, string> }).env
  .VITE_APP_ENV as "dev" | "prod";
// Configuration validation happens per request so an invalid URL cannot crash the UI.
const API = (rawApi?.trim() || "/api").replace(/\/+$/, "");
const loadWardrobes = (token: string, signal: AbortSignal) =>
  requestJson(resolveApiUrl(rawApi, appEnv) + "/wardrobes", {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
const styles = ["Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"];
const seed: Cloth[] = [
  ["1", "The everyday tee", "tops", "#e9e5dc", "cotton"],
  ["2", "Relaxed Oxford", "tops", "#aab6ae", "cotton"],
  ["3", "Straight-leg denim", "pants", "#506778", "denim"],
  ["4", "Tailored trousers", "pants", "#817864", "linen"],
  ["5", "Classic court sneakers", "shoes", "#e8e4dc", "leather"],
  ["6", "Suede loafers", "shoes", "#886448", "leather"],
  ["7", "The chore jacket", "jackets", "#8b927a", "cotton"],
  ["8", "Soft knit cardigan", "jackets", "#b8a18a", "knit"],
].map(([id, name, category, color, texture]) => ({
  id,
  name,
  category: category as Category,
  color,
  texture,
  style: "Everyday",
}));
function Garment({ item }: { item: Cloth }) {
  const [url, setUrl] = useState("");
  const [imageError, setImageError] = useState("");
  useEffect(() => {
    setUrl("");
    setImageError("");
    let active = true,
      object = "";
    if (item.image) {
      fetch(`${API}/images/${item.image}`, {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem("atelier-token")}`,
        },
      })
        .then((r) => {
          if (!r.ok) throw Error(r.status === 404 ? "Photo missing. Upload this piece again." : "Photo unavailable. Try again later.");
          return r.blob();
        })
        .then((b) => {
          object = URL.createObjectURL(b);
          if (active) setUrl(object);
          else URL.revokeObjectURL(object);
        })
        .catch((error) => { if (active) setImageError(error instanceof Error && error.message.startsWith("Photo") ? error.message : "Photo unavailable. Try again later."); });
    }
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [item.image]);
  if (item.image)
    return url ? (
      <img src={url} alt={item.name} onError={() => { setUrl(""); setImageError("Photo unavailable. Try again later."); }} />
    ) : (
      <span role={imageError ? "status" : undefined}>{imageError || "Loading image…"}</span>
    );
  const shape =
    item.category === "tops" ? (
      <>
        <path d="M64 34 88 24 Q110 42 132 24 L156 34 185 73 157 94 145 76 145 180 75 180 75 76 63 94 35 73Z" />
        <path
          d="M88 24Q110 57 132 24"
          fill="none"
          stroke="#666"
          opacity=".25"
        />
      </>
    ) : item.category === "pants" ? (
      <>
        <path d="M72 26H148L158 184H116L110 96 104 184H62Z" />
        <path
          d="M72 42H148M110 42V88M77 44Q78 64 64 68M143 44Q142 64 153 68"
          fill="none"
          stroke="#fff"
          opacity=".25"
        />
      </>
    ) : item.category === "shoes" ? (
      <>
        <path d="M37 91 56 69 77 86 129 94 155 109Q185 110 184 133H40Q23 116 37 91Z" />
        <path d="M47 143H178V154H47Z" fill="#d4d0c7" />
        <path
          d="M85 87 76 106M102 91 94 109M117 95 111 111"
          stroke="#fff"
          strokeWidth="5"
        />
        <path
          d="M54 55 74 37 94 51 145 59 173 75Q198 81 196 97L135 96 77 83Z"
          opacity=".65"
        />
      </>
    ) : (
      <>
        <path d="M77 29 95 23H125L143 29 176 59 185 168 154 174 142 75 145 189H75L78 75 66 174 35 168 44 59Z" />
        <path
          d="M95 23 110 51 125 23M110 51V189M84 92H101V119H84M119 92H136V119H119"
          fill="none"
          stroke="#fff"
          opacity=".35"
        />
        {[66, 91, 116, 141, 166].map((y) => (
          <circle key={y} cx="111" cy={y} r="2" fill="#555" />
        ))}
      </>
    );
  return (
    <svg
      viewBox="0 0 220 210"
      role="img"
      aria-label={`${item.name}, sample illustration`}
    >
      <defs>
        <filter id={`shadow${item.id}`}>
          <feDropShadow dx="0" dy="7" stdDeviation="5" floodOpacity=".13" />
        </filter>
        <linearGradient id={`fabric${item.id}`} x1="0" x2="1">
          <stop stopColor={item.color} />
          <stop offset=".5" stopColor={item.color} />
          <stop offset="1" stopColor="#000" stopOpacity=".25" />
        </linearGradient>
      </defs>
      <g fill={`url(#fabric${item.id})`} filter={`url(#shadow${item.id})`}>
        {shape}
      </g>
    </svg>
  );
}
function App() {
  const [keyboardMode, setKeyboardMode] = useState(false);
  useEffect(() => {
    const keyboard = () => {
      setKeyboardMode(true);
      document.documentElement.dataset.input = "keyboard";
    };
    const pointer = () => {
      setKeyboardMode(false);
      document.documentElement.dataset.input = "pointer";
    };
    window.addEventListener("keydown", keyboard);
    window.addEventListener("pointerdown", pointer);
    return () => {
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("pointerdown", pointer);
    };
  }, []);
  const [theme, setTheme] = useState<Theme>(() =>
    validTheme(localStorage.getItem("atelier-theme")),
  );
  const themeApplied = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const paint = () => {
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          "content",
          // Brand colours: Wardrobe Ink on dark, Linen on light.
          resolvedTheme(theme, media.matches) === "dark"
            ? "#1E221D"
            : "#F6F2EA",
        );
      document.documentElement.dataset.theme = resolvedTheme(
        theme,
        media.matches,
      );
      document.documentElement.style.colorScheme = resolvedTheme(
        theme,
        media.matches,
      );
    };
    // First paint is instant; later light/dark changes crossfade (View Transitions)
    // so the page eases between brightness levels instead of flashing.
    const apply = () => {
      const animated =
        themeApplied.current &&
        // A crossfade is opacity only, so it stays under reduced motion (shortened in CSS).
        "startViewTransition" in document &&
        document.visibilityState === "visible" &&
        document.documentElement.dataset.theme !==
          resolvedTheme(theme, media.matches);
      themeApplied.current = true;
      if (animated) {
        document.startViewTransition(paint);
        // The transition only applies the change once a frame renders; never let
        // a throttled or minimized window hold the theme back. paint() is idempotent.
        window.setTimeout(paint, 250);
      } else paint();
    };
    apply();
    localStorage.setItem("atelier-theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const [token, setToken] = useState(
    sessionStorage.getItem("atelier-token") || "",
  );
  const demo = !token;
  const catalog = useWardrobeCatalog(token, loadWardrobes);
  const wardrobes = catalog.wardrobes;
  const wid = catalog.selected;
  const setWid = catalog.select;
  const [clothes, setClothes] = useState<Cloth[]>(() => (token ? [] : seed));
  const [looks, setLooks] = useState<Look[]>([]);
  const [saved, setSaved] = useState<Look[]>(() =>
    token ? [] : JSON.parse(localStorage.getItem("atelier-saved-demo") || "[]"),
  );
  const [view, setView] = useState("studio");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [style, setStyle] = useState("Everyday");
  const [harmony, setHarmony] = useState("balanced");
  const [jacket, setJacket] = useState(true);
  const [anchor, setAnchor] = useState("");
  const [modal, setModal] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mobile, setMobile] = useState(false);
  const [register, setRegister] = useState(false);
  const [pieceToRemove, setPieceToRemove] = useState<Cloth | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [analysis, setAnalysis] = useState<Analysis>("idle");
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const analysisRun = useRef(0);
  // Fields the user changed themselves are never overwritten by detection.
  const edited = useRef(new Set<keyof Draft>());
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) {
    const base = resolveApiUrl(rawApi, appEnv);
    return requestJson(base + path, {
      method,
      signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  }
  useEffect(() => {
    analysisRun.current++;
    edited.current.clear();
    setDraft(emptyDraft);
    setConfidence({});
    setAnalysis("idle");
  }, [modal]);
  function editDraft(field: keyof Draft, value: string) {
    edited.current.add(field);
    setDraft((d) => ({ ...d, [field]: value }));
  }
  async function analyzePhoto(file?: File) {
    const run = ++analysisRun.current;
    edited.current.clear();
    setConfidence({});
    if (!file) return setAnalysis("idle");
    setAnalysis("running");
    setError("");
    const body = new FormData();
    body.append("image", file);
    try {
      const found = await request(`/wardrobes/${wid}/clothes/analyze`, "POST", body);
      if (run !== analysisRun.current) return;
      setDraft((d) => {
        const next = { ...d };
        for (const key of Object.keys(d) as (keyof Draft)[])
          if (found[key] && !edited.current.has(key)) next[key] = found[key];
        return next;
      });
      setConfidence(found.confidence || {});
      setAnalysis(found.detected ? "done" : "partial");
    } catch (e) {
      if (run !== analysisRun.current) return;
      setAnalysis("idle");
      setError((e as Error).message);
    }
  }
  const uncertain = (field: string) =>
    analysis === "done" && (confidence[field] ?? 1) < uncertainBelow
      ? "uncertain"
      : undefined;
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    setAnchor("");
    setLooks([]);
    setClothes([]);
    setSaved([]);
    setError("");
    if (demo) {
      setSaved(
        JSON.parse(localStorage.getItem(`atelier-saved-${wid}`) || "[]"),
      );
      setClothes(
        wid === "travel"
          ? seed.filter((c) => ["2", "4", "6", "8"].includes(c.id))
          : seed,
      );
      return;
    }
    if (!catalog.ready || !wid) return;
    const controller = new AbortController();
    Promise.all([
      request(`/wardrobes/${wid}/clothes`, "GET", undefined, controller.signal),
      request(`/wardrobes/${wid}/outfits`, "GET", undefined, controller.signal),
    ])
      .then(([c, o]) => {
        if (!controller.signal.aborted) {
          setClothes(c);
          setSaved(o);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [wid, token, catalog.ready]);
  useEffect(() => {
    if (!modal) return;
    const prior = document.activeElement as HTMLElement;
    const dialog = document.querySelector("dialog");
    dialog?.showModal();
    (dialog?.querySelector("input,button,select") as HTMLElement)?.focus();
    return () => {
      dialog?.close();
      prior?.focus();
    };
  }, [modal]);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      if (demo) {
        const pool = (c: Category) => clothes.filter((x) => x.category === c);
        const out: Look[] = [];
        for (const top of pool("tops"))
          for (const pants of pool("pants"))
            for (const shoes of pool("shoes")) {
              const items = [
                top,
                pants,
                shoes,
                ...(jacket
                  ? pool("jackets").slice(out.length % 2, (out.length % 2) + 1)
                  : []),
              ];
              if (!anchor || items.some((x) => x.id === anchor))
                out.push({ items, style });
            }
        setLooks(out.slice(0, 4));
      } else
        setLooks(
          await request(`/wardrobes/${wid}/generate`, "POST", {
            style,
            harmony,
            include_jacket: jacket,
            anchor_id: anchor || null,
          }),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(look: Look) {
    setError("");
    try {
      if (isSaved(look)) {
        setNotice("This outfit is already saved");
        return;
      }
      const name = `${look.style} / ${saved.length + 1}`;
      if (demo) {
        const next = [...saved, { ...look, id: crypto.randomUUID(), name }];
        setSaved(next);
        localStorage.setItem(`atelier-saved-${wid}`, JSON.stringify(next));
      } else {
        await request(`/wardrobes/${wid}/outfits`, "POST", {
          name,
          style: look.style,
          cloth_ids: look.items.map((x) => x.id),
        });
        setSaved(await request(`/wardrobes/${wid}/outfits`));
      }
      setNotice("Outfit saved to your collection");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function isSaved(look: Look) {
    return saved.some(
      (x) =>
        x.items
          .map((c) => c.id)
          .sort()
          .join() ===
        look.items
          .map((c) => c.id)
          .sort()
          .join(),
    );
  }
  async function remove(look: Look) {
    try {
      if (!demo)
        await request(`/wardrobes/${wid}/outfits/${look.id}`, "DELETE");
      const next = saved.filter((x) => x.id !== look.id);
      setSaved(next);
      if (demo)
        localStorage.setItem(`atelier-saved-${wid}`, JSON.stringify(next));
      setNotice("Outfit removed");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const outfitsWith = (piece: Cloth | null) =>
    piece ? saved.filter((l) => l.items.some((c) => c.id === piece.id)) : [];
  async function removePiece(piece: Cloth) {
    const result = await request(
      `/wardrobes/${wid}/clothes/${piece.id}`,
      "DELETE",
    );
    const without = (l: Look) => !l.items.some((c) => c.id === piece.id);
    setClothes((all) => all.filter((c) => c.id !== piece.id));
    setSaved((all) => all.filter(without));
    setLooks((all) => all.filter(without));
    if (anchor === piece.id) setAnchor("");
    setNotice(
      result.removed_outfits
        ? `${piece.name} and ${result.removed_outfits} saved outfit${result.removed_outfits === 1 ? "" : "s"} removed`
        : `${piece.name} removed`,
    );
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (modal === "auth") {
        const result = await request(
          register ? "/auth/register" : "/auth/login",
          "POST",
          { email: f.get("email"), password: f.get("password") },
        );
        sessionStorage.setItem("atelier-token", result.token);
        setClothes([]);
        setSaved([]);
        setLooks([]);
        setError("");
        setToken(result.token);
      } else if (modal === "wardrobe") {
        const w = await request("/wardrobes", "POST", { name: f.get("name") });
        catalog.add(w);
      } else if (modal === "remove") {
        if (pieceToRemove) await removePiece(pieceToRemove);
      } else {
        await request(`/wardrobes/${wid}/clothes`, "POST", f);
        setClothes(await request(`/wardrobes/${wid}/clothes`));
        setNotice("New piece added to your wardrobe");
      }
      setModal("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const displayedError = error || catalog.error;
  const visible = clothes.filter(
    (c) =>
      (category === "all" || category === c.category) &&
      c.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <MotionConfig
      reducedMotion="user"
      transition={
        keyboardMode
          ? { duration: 0 }
          : { type: "spring", bounce: 0, duration: 0.28 }
      }
    >
      <div className="shell">
        {mobile && (
          <button
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className={mobile ? "sidebar open" : "sidebar"}>
          <button
            className="sidebar-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setView("studio");
            }}
          >
            <Logo />
          </a>
          <div className="nav-label">THE PERSONAL STYLE STUDIO</div>
          <nav>
            {[
              ["studio", "Outfit studio", Sparkles],
              ["wardrobe", "My wardrobe", Shirt],
              ["saved", "Saved outfits", Bookmark],
            ].map(([key, label, Icon]) => {
              const I = Icon as typeof Shirt;
              return (
                <button
                  className={view === key ? "nav-item selected" : "nav-item"}
                  key={key as string}
                  onClick={() => {
                    setView(key as string);
                    setMobile(false);
                  }}
                >
                  {view === key && (
                    <motion.span
                      className="nav-indicator"
                      layoutId="navigation"
                      aria-hidden="true"
                    />
                  )}
                  <I size={19} />
                  {/* Wrapped so it sits above the selection indicator. */}
                  <span>{label as string}</span>
                  {key === "saved" && (
                    <span className="count">{saved.length}</span>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="wardrobe-label">
            COLLECTIONS{" "}
            <button
              aria-label="Create wardrobe"
              onClick={() => setModal(demo ? "auth" : "wardrobe")}
            >
              <Plus size={16} />
            </button>
          </div>
          {wardrobes.map((w) => (
            <button
              key={w.id}
              className={`wardrobe-nav ${wid === w.id ? "current" : ""}`}
              onClick={() => {
                setWid(w.id);
                setMobile(false);
              }}
            >
              <span className="tiny-square" />
              {w.name}
              {wid === w.id && <Check size={14} />}
            </button>
          ))}
          <div className="side-tip">
            <div className="tip-icon">
              <Layers3 size={20} />
            </div>
            <h3>
              Less guessing.
              <br />
              More getting dressed.
            </h3>
            <p>A fresh perspective on the pieces you already love.</p>
          </div>
          <button
            className="profile"
            onClick={() => {
              if (demo) setModal("auth");
              else {
                sessionStorage.removeItem("atelier-token");
                setToken("");
                setSaved(
                  JSON.parse(
                    localStorage.getItem("atelier-saved-demo") || "[]",
                  ),
                );
              }
            }}
          >
            <span className="avatar">{demo ? "A" : "You"}</span>
            <span>
              {demo ? "Your styling space" : "My account"}
              <small>{demo ? "Sample wardrobe · Sign in" : "Sign out"}</small>
            </span>
            {demo ? <ArrowUpRight size={16} /> : <LogOut size={16} />}
          </button>
        </aside>
        <main>
          <header>
            <button
              className="mobile-menu"
              aria-label="Open menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu />
            </button>
            <LogoSymbol className="mobile-logo" />
            <span className="breadcrumb">
              <span className="crumb-root">Your space</span>
              <span className="crumb-sep">/</span>
              {view === "studio"
                ? "Outfit studio"
                : view === "saved"
                  ? "Saved outfits"
                  : "My wardrobe"}
            </span>
            <span className="header-right">
              <Select
                className="theme-picker"
                variant="inline"
                ariaLabel="Appearance"
                value={theme}
                onChange={(v) => setTheme(v as Theme)}
                icon={
                  theme === "dark" ? (
                    <Moon size={15} />
                  ) : theme === "light" ? (
                    <Sun size={15} />
                  ) : (
                    <Monitor size={15} />
                  )
                }
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
              <span className="status-dot" />
              {demo ? "Explore sample wardrobe" : "Personal wardrobe"}
              <button
                className="icon-button"
                aria-label="Sign in or manage account"
                onClick={() => setModal("auth")}
              >
                <span className="mini-avatar">A</span>
              </button>
            </span>
          </header>
          <div className="content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR CLOSET HAS MORE TO SAY</div>
                <h1>
                  {view === "studio" ? (
                    <>
                      Your wardrobe.
                      <br />
                      <em>New possibilities.</em>
                    </>
                  ) : view === "wardrobe" ? (
                    <>
                      The pieces.
                      <br />
                      <em>The possibilities.</em>
                    </>
                  ) : (
                    <>
                      Your favorites.
                      <br />
                      <em>Ready to repeat.</em>
                    </>
                  )}
                </h1>
                <p>
                  {view === "studio"
                    ? "Rediscover what you own. Find a combination that feels like you."
                    : view === "wardrobe"
                      ? "A home for every piece, and the possibilities between them."
                      : "Your favorite combinations, ready when you are."}
                </p>
              </div>
              <button
                className="button white"
                onClick={() =>
                  setModal(demo ? "auth" : wid ? "upload" : "wardrobe")
                }
              >
                <Plus size={17} /> Add a piece
              </button>
            </div>
            <div className="workspace-strip">
              <Select
                className="collection-select"
                variant="inline"
                ariaLabel="Current wardrobe"
                value={wid}
                onChange={setWid}
                icon={<Layers3 size={17} />}
                disabled={!wardrobes.length}
                options={
                  wardrobes.length
                    ? wardrobes.map((w) => ({ value: w.id, label: w.name }))
                    : [
                        {
                          value: "",
                          label: catalog.loading
                            ? "Loading wardrobes…"
                            : "No wardrobes yet",
                        },
                      ]
                }
              />
              <div className="workspace-stats">
                <span>
                  <strong>{clothes.length}</strong> pieces
                </span>
                <span>
                  <strong>
                    {new Set(clothes.map((c) => c.category)).size}
                  </strong>{" "}
                  categories
                </span>
                <span>
                  <strong>{saved.length}</strong> saved looks
                </span>
              </div>
            </div>
            {displayedError && (
              <div className="error" role="alert">
                {displayedError}
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  <X size={16} />
                </button>
              </div>
            )}
            {view === "studio" && (
              <section className="studio-panel">
                <div className="studio-intro">
                  <div className="board-heading">
                    <span className="small-label">THE STARTING POINT</span>
                    <span className="board-dot" />
                  </div>
                  <h2>
                    Already yours.
                    <br />
                    <em>Entirely different.</em>
                  </h2>
                  <div
                    className="wardrobe-board"
                    aria-label={
                      demo
                        ? "Sample pieces combining into outfits"
                        : "Pieces from your selected wardrobe"
                    }
                  >
                    {/* Signed-out visitors see the motion piece; members see their own pieces. */}
                    {demo && <StudioLoopVideo />}
                    {!demo && (
                      ["tops", "pants", "shoes", "jackets"] as Category[]
                    ).flatMap((cat) => {
                      const piece =
                        clothes.find(
                          (c) => c.category === cat && c.id === anchor,
                        ) || clothes.find((c) => c.category === cat);
                      return piece
                        ? [
                            <div
                              className={`board-piece board-${cat}`}
                              key={piece.id}
                            >
                              <Garment item={piece} />
                            </div>,
                          ]
                        : [];
                    })}
                    {!demo && clothes.length === 0 && (
                      <div className="board-empty">
                        <Shirt size={40} />
                        <span>Add your first pieces</span>
                      </div>
                    )}
                    {!demo && (
                      <span className="board-label">
                        FROM YOUR WARDROBE <ArrowUpRight size={14} />
                      </span>
                    )}
                  </div>
                  <p>
                    A few familiar pieces. A fresh way to put them together.
                  </p>
                </div>
                <div className="studio-controls">
                  <div className="control-header">
                    <h3>Make it feel like you.</h3>
                    <span>01 — THE DIRECTION</span>
                  </div>
                  <p className="controls-description">
                    Choose a style, then let your wardrobe do the rest.
                  </p>
                  <span className="field-caption">YOUR STYLE</span>
                  <div
                    className="style-buttons"
                    role="group"
                    aria-label="Outfit style"
                  >
                    {styles.map((x) => (
                      <button
                        className={style === x ? "active" : ""}
                        onClick={() => setStyle(x)}
                        key={x}
                        aria-pressed={style === x}
                      >
                        {style === x && (
                          <motion.span
                            layoutId="style-selection"
                            className="selection-pill"
                            aria-hidden="true"
                          />
                        )}
                        <span>{x}</span>
                      </button>
                    ))}
                  </div>
                  <div className="select-row">
                    <Select
                      label="Color direction"
                      value={harmony}
                      onChange={setHarmony}
                      options={[
                        { value: "balanced", label: "A balanced palette" },
                        { value: "tonal", label: "Soft & tonal" },
                        { value: "contrast", label: "A little contrast" },
                      ]}
                    />
                    <Select
                      label="Start with a piece"
                      value={anchor}
                      onChange={setAnchor}
                      options={[
                        { value: "", label: "Surprise me" },
                        ...clothes
                          .filter((c) => jacket || c.category !== "jackets")
                          .map((c) => ({ value: c.id, label: c.name })),
                      ]}
                    />
                  </div>
                  <div className="generate-row">
                    <label className="toggle-label">
                      <input
                        type="checkbox"
                        checked={jacket}
                        onChange={(e) => {
                          setJacket(e.target.checked);
                          if (
                            !e.target.checked &&
                            clothes.find((c) => c.id === anchor)?.category ===
                              "jackets"
                          )
                            setAnchor("");
                        }}
                      />
                      <span className="toggle" />
                      Include a layer
                    </label>
                    <button
                      className="button primary"
                      disabled={busy || !wid || (!demo && !catalog.ready)}
                      aria-busy={busy}
                      onClick={generate}
                    >
                      <Sparkles
                        size={17}
                        className={busy ? "generating-icon" : undefined}
                      />
                      {busy ? "Putting it together…" : "Find my next outfit"}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                </div>
              </section>
            )}
            {view === "studio" && looks.length > 0 && (
              <section className="looks-section">
                <div className="section-heading">
                  <div>
                    <h2>Your next great outfit</h2>
                    <p>
                      {demo
                        ? "Sample combinations · Sign in to match your uploaded pieces"
                        : "Combinations from your wardrobe"}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={generate}
                    disabled={busy}
                  >
                    Refresh looks <Sparkles size={15} />
                  </button>
                </div>
                <div className="look-grid">
                  {looks.map((look, i) => (
                    <motion.article
                      className="look-card"
                      key={look.items.map((c) => c.id).join()}
                      // Full transform strings stay on the compositor; 50 ms stagger.
                      initial={{ opacity: 0, transform: "translateY(8px)" }}
                      animate={{ opacity: 1, transform: "translateY(0px)" }}
                      transition={
                        keyboardMode
                          ? { duration: 0 }
                          : { duration: 0.24, ease: EASE_OUT, delay: i * 0.05 }
                      }
                    >
                      <div className="look-art">
                        {look.items.map((c) => (
                          <div key={c.id}>
                            <Garment item={c} />
                          </div>
                        ))}
                      </div>
                      <div className="look-info">
                        <div>
                          <span className="small-label">
                            {look.style.toUpperCase()}
                          </span>
                          <h3>
                            {
                              [
                                "An easy kind of day",
                                "Quiet confidence",
                                "A fresh perspective",
                                "Your everyday, elevated",
                              ][i]
                            }
                          </h3>
                          {look.score !== undefined && (
                            <p>
                              {look.score} / 100 compatibility · heuristic score
                            </p>
                          )}
                        </div>
                        <button
                          className={`save-button ${isSaved(look) ? "is-saved" : ""}`}
                          aria-label="Save outfit"
                          onClick={() => save(look)}
                        >
                          {isSaved(look) ? (
                            <Check size={18} />
                          ) : (
                            <Bookmark size={18} />
                          )}
                        </button>
                      </div>
                      <div className="look-names">
                        {look.items.map((c) => c.name).join(" · ")}
                      </div>
                    </motion.article>
                  ))}
                </div>
              </section>
            )}
            {view !== "saved" && (
              <section className="wardrobe-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      {view === "studio"
                        ? "Your wardrobe, at a glance"
                        : "All your favorite pieces"}{" "}
                      <span>{clothes.length} pieces</span>
                    </h2>
                    <p>
                      {wardrobes.find((w) => w.id === wid)?.name ||
                        "Create your first wardrobe"}
                      {demo ? " · Illustrated sample pieces" : ""}
                    </p>
                  </div>
                  {view === "studio" ? (
                    <button
                      className="text-button"
                      onClick={() => setView("wardrobe")}
                    >
                      View wardrobe <ArrowUpRight size={17} />
                    </button>
                  ) : (
                    <label className="search">
                      <Search size={15} />
                      <input
                        aria-label="Search clothes"
                        placeholder="Find a piece…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <div className="filter-bar">
                  <div className="category-tabs">
                    {["all", "tops", "pants", "shoes", "jackets"].map((c) => (
                      <button
                        className={category === c ? "active" : ""}
                        key={c}
                        aria-pressed={category === c}
                        onClick={() => setCategory(c)}
                      >
                        {category === c && (
                          <motion.span
                            layoutId="category-selection"
                            className="selection-pill"
                            aria-hidden="true"
                          />
                        )}
                        <span>
                          {c === "all"
                            ? "All pieces"
                            : c[0].toUpperCase() + c.slice(1)}
                        </span>
                      </button>
                    ))}
                  </div>
                  <span className="filter-caption">
                    <SlidersHorizontal size={15} /> Choose a starting piece
                  </span>
                </div>
                <div className="clothes-grid">
                  {visible.map((c) => (
                    <div className="cloth-slot" key={c.id}>
                    <button
                      aria-pressed={anchor === c.id}
                      className={`cloth-card ${anchor === c.id ? "anchored" : ""}`}
                      onClick={() => {
                        setAnchor(anchor === c.id ? "" : c.id);
                        setView("studio");
                        setNotice(
                          anchor === c.id
                            ? "Starting piece cleared"
                            : `${c.name} selected as your starting piece`,
                        );
                      }}
                    >
                      <div className="cloth-art">
                        <Garment item={c} />
                        <span className="cloth-hover">
                          {anchor === c.id ? (
                            <Check size={16} />
                          ) : (
                            <Plus size={16} />
                          )}
                        </span>
                      </div>
                      <div className="cloth-info">
                        <h3>{c.name}</h3>
                        <div>
                          <span>
                            {c.texture[0].toUpperCase() + c.texture.slice(1)} ·{" "}
                            {c.category}
                          </span>
                          <i style={{ background: c.color }} />
                        </div>
                      </div>
                    </button>
                    {!demo && (
                      <button
                        type="button"
                        className="remove-piece"
                        aria-label={`Remove ${c.name}`}
                        title="Remove piece"
                        onClick={() => {
                          setPieceToRemove(c);
                          setError("");
                          setModal("remove");
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    </div>
                  ))}
                  <button
                    className="add-card"
                    onClick={() =>
                      setModal(demo ? "auth" : wid ? "upload" : "wardrobe")
                    }
                  >
                    <span>
                      <Plus size={23} />
                    </span>
                    <h3>Something new?</h3>
                    <p>Give it a place here</p>
                  </button>
                </div>
              </section>
            )}
            {view === "saved" && (
              <section className="saved-section">
                {!saved.length ? (
                  <div className="empty">
                    <Bookmark size={35} />
                    <h2>Your collection starts with a look.</h2>
                    <p>
                      Create an outfit, then save your favorite combinations
                      here.
                    </p>
                    <button
                      className="button primary"
                      onClick={() => setView("studio")}
                    >
                      Explore the studio <ArrowRight size={17} />
                    </button>
                  </div>
                ) : (
                  <div className="look-grid">
                    {saved.map((l) => (
                      <article className="look-card" key={l.id}>
                        <div className="look-art">
                          {l.items.map((c) => (
                            <div key={c.id}>
                              <Garment item={c} />
                            </div>
                          ))}
                        </div>
                        <div className="look-info">
                          <div>
                            <span className="small-label">{l.style}</span>
                            <h3>{l.name}</h3>
                          </div>
                          <button
                            className="save-button"
                            aria-label="Remove saved outfit"
                            onClick={() => remove(l)}
                          >
                            <X size={18} />
                          </button>
                        </div>
                        <div className="look-names">
                          {l.items.map((c) => c.name).join(" · ")}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
            <footer>
              <span className="footer-spark">
                {/* Under 32 px the guidelines require the collar-less small cut. */}
                <LogoSymbol small title="" className="footer-mark" /> A little
                less effort. A little more you.
              </span>
              <span>Made for your everyday.</span>
            </footer>
          </div>
        </main>
        <div className="toast-wrap">
          <AnimatePresence>
            {notice && (
              <motion.div
                className="toast"
                role="status"
                key={notice}
                initial={{
                  opacity: 0,
                  transform: keyboardMode
                    ? "none"
                    : "translateY(12px) scale(0.98)",
                }}
                animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                exit={{
                  opacity: 0,
                  transform: keyboardMode ? "none" : "translateY(8px) scale(1)",
                  transition: { duration: keyboardMode ? 0 : 0.14, ease: EASE_OUT },
                }}
                transition={{ duration: keyboardMode ? 0 : 0.22, ease: EASE_OUT }}
              >
                <span className="toast-check">
                  <Check size={16} />
                </span>
                {notice}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {modal && (
          <dialog
            onCancel={() => {
              setModal("");
              setError("");
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setModal("");
            }}
          >
            <motion.form
              initial={{ opacity: 0, scale: keyboardMode ? 1 : 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              onSubmit={submit}
            >
              <button
                type="button"
                className="close"
                aria-label="Close dialog"
                onClick={() => {
                  setModal("");
                  setError("");
                }}
              >
                <X size={20} />
              </button>
              <LogoSymbol className="dialog-mark" title="" />
              <h2>
                {modal === "auth"
                  ? register
                    ? "Make room for your style."
                    : "Welcome to your wardrobe."
                  : modal === "wardrobe"
                    ? "A wardrobe for every mood."
                    : modal === "remove"
                      ? `Remove ${pieceToRemove?.name ?? "this piece"}?`
                      : "Add something you love."}
              </h2>
              <p>
                {modal === "auth"
                  ? "A home for your clothes, and a fresh perspective on your style."
                  : modal === "wardrobe"
                    ? "Give this collection a name."
                    : modal === "remove"
                      ? (() => {
                          const n = outfitsWith(pieceToRemove).length;
                          return n
                            ? `Its photo will be deleted, along with ${n} saved outfit${n === 1 ? "" : "s"} that use${n === 1 ? "s" : ""} it. This can't be undone.`
                            : "Its photo will be deleted. This can't be undone.";
                        })()
                      : "Use a clear photo of one garment. We fill in the details; change anything that's off."}
              </p>
              {displayedError && (
                <div className="error" role="alert">
                  {displayedError}
                </div>
              )}
              {modal === "auth" ? (
                <>
                  <label>
                    Email
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                    />
                  </label>
                  <label>
                    Password
                    <input
                      name="password"
                      type="password"
                      minLength={10}
                      maxLength={128}
                      required
                      autoComplete={
                        register ? "new-password" : "current-password"
                      }
                    />
                  </label>
                  <small>At least 10 characters</small>
                </>
              ) : modal === "remove" ? null : modal === "wardrobe" ? (
                <label>
                  Wardrobe name
                  <input
                    name="name"
                    required
                    maxLength={80}
                    placeholder="Summer in the city"
                  />
                </label>
              ) : (
                <>
                  <label className="upload-input">
                    Photo
                    <input
                      name="image"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      required
                      onChange={(e) => analyzePhoto(e.currentTarget.files?.[0])}
                    />
                    <small className="analysis-status" aria-live="polite">
                      {analysis === "running"
                        ? "Detecting details…"
                        : analysis === "done"
                          ? "Details detected. Review them and change anything that's off."
                          : analysis === "partial"
                            ? "Color detected. Automatic type detection is unavailable, so please choose the rest."
                            : "JPG, PNG or WebP · up to 10 MB"}
                    </small>
                  </label>
                  <fieldset
                    className="piece-details"
                    disabled={analysis === "running"}
                    aria-busy={analysis === "running"}
                  >
                    <label>
                      Piece name
                      <input
                        name="name"
                        required
                        maxLength={80}
                        placeholder="Relaxed linen shirt"
                        value={draft.name}
                        onChange={(e) => editDraft("name", e.target.value)}
                      />
                    </label>
                    <div className="select-row">
                      <Select
                        className={uncertain("category")}
                        label="Category"
                        name="category"
                        value={draft.category}
                        onChange={(v) => editDraft("category", v)}
                        options={["tops", "pants", "shoes", "jackets"].map(
                          (c) => ({ value: c, label: c }),
                        )}
                      />
                      <Select
                        className={uncertain("texture")}
                        label="Texture"
                        name="texture"
                        value={draft.texture}
                        onChange={(v) => editDraft("texture", v)}
                        options={textures.map((c) => ({ value: c, label: c }))}
                      />
                    </div>
                    <div className="select-row">
                      <Select
                        className={uncertain("style")}
                        label="Style"
                        name="style"
                        value={draft.style}
                        onChange={(v) => editDraft("style", v)}
                        options={styles.map((c) => ({ value: c, label: c }))}
                      />
                      <label>
                        Main garment color
                        <input
                          type="color"
                          name="color"
                          value={draft.color}
                          onChange={(e) => editDraft("color", e.target.value)}
                        />
                      </label>
                    </div>
                  </fieldset>
                </>
              )}
              <button
                className={`button primary wide ${modal === "remove" ? "danger" : ""}`}
                disabled={busy || analysis === "running"}
              >
                {busy
                  ? "Please wait…"
                  : analysis === "running"
                    ? "Detecting details…"
                  : modal === "auth"
                    ? register
                      ? "Create account"
                      : "Sign in"
                    : modal === "wardrobe"
                      ? "Create wardrobe"
                      : modal === "remove"
                        ? "Remove piece"
                        : "Add to wardrobe"}
                <ArrowRight size={17} />
              </button>
              {modal === "auth" && (
                <button
                  className="text-button auth-switch"
                  type="button"
                  onClick={() => setRegister(!register)}
                >
                  {register
                    ? "Already have an account? Sign in"
                    : "New here? Create an account"}
                </button>
              )}
            </motion.form>
          </dialog>
        )}
      </div>
    </MotionConfig>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
