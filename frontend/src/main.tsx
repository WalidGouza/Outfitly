import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./ow.css";
import "./app.css";
import { KEEP_OOTD_UNSEEN_FOR_TESTING } from "./testing";
import { Logo, LogoSymbol } from "./brand";
import { resolvedTheme, validTheme, type Theme } from "./theme";
import { styles, TOKEN_KEY, useWardrobeStore, type Coords, type Look, type Piece } from "./store";
import { Collar, Dialog, DialogHead, Dots, Icon, Seg, Toast, type IconName, type ToastData } from "./ui";
import {
  AddPiece,
  AuthDialog,
  Home,
  NewWardrobeDialog,
  PieceDetail,
  RemoveDialog,
  Saved,
  Studio,
  Today,
  Wardrobe,
  type App as AppApi,
  type Route,
  type StudioState,
  type TodayState,
} from "./screens";

// ── Routing: #/, #/today, #/wardrobe, #/studio, #/saved, #/piece/<id> ──────
function parse(hash: string): Route {
  const [, name, id] = hash.replace(/^#/, "").split("/");
  if (name === "piece" && id) return { name: "piece", id: decodeURIComponent(id) };
  if (name === "today" || name === "wardrobe" || name === "studio" || name === "saved") return { name };
  return { name: "home" };
}
const href = (r: Route) => (r.name === "piece" ? `#/piece/${encodeURIComponent(r.id)}` : r.name === "home" ? "#/" : `#/${r.name}`);

const nav: { route: Route["name"]; label: string; short: string; icon: IconName; tab: boolean }[] = [
  { route: "home", label: "Home", short: "Home", icon: "home", tab: true },
  { route: "today", label: "Today", short: "Today", icon: "today", tab: false },
  { route: "wardrobe", label: "Wardrobe", short: "Wardrobe", icon: "wardrobe", tab: true },
  { route: "studio", label: "Outfit studio", short: "Studio", icon: "studio", tab: true },
  { route: "saved", label: "Saved", short: "Saved", icon: "saved", tab: true },
];
const tabs = nav.filter((n) => n.tab);
const SEEN_KEY = "outfitly-ootd-seen";
const emptyToday: TodayState = { looks: [], index: 0, busy: false, error: "", weather: null, advice: [], missing: [], geo: "idle" };

const dayOfYear = () => {
  const now = new Date();
  return Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000);
};

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return validTheme(localStorage.getItem("atelier-theme"));
    } catch {
      return "system";
    }
  });
  const [dark, setDark] = useState(() => resolvedTheme(theme, matchMedia("(prefers-color-scheme: dark)").matches) === "dark");
  const first = useRef(true);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const paint = () => {
      const next = resolvedTheme(theme, media.matches);
      setDark(next === "dark");
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#121411" : "#F6F2EA");
    };
    // Later changes crossfade (opacity only, so it also runs under reduced motion).
    const apply = () => {
      const animate = !first.current && "startViewTransition" in document && document.visibilityState === "visible";
      first.current = false;
      if (animate) document.startViewTransition(paint);
      else paint();
    };
    apply();
    try {
      localStorage.setItem("atelier-theme", theme);
    } catch {
      // Storage can be unavailable; the choice still applies for this visit.
    }
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return { theme, setTheme, dark };
}

function App() {
  const { theme, setTheme, dark } = useTheme();
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
  }, []);
  const store = useWardrobeStore(token, signOut);

  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  useEffect(() => {
    const sync = () => {
      setRoute(parse(location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const go = useCallback((r: Route) => {
    if (location.hash !== href(r)) location.hash = href(r);
  }, []);

  const [toastData, setToastData] = useState<ToastData | null>(null);
  const closeToast = useCallback(() => setToastData(null), []);
  const [dialog, setDialog] = useState<"" | "add" | "auth" | "wardrobe" | "account">("");
  const [removing, setRemoving] = useState<Piece | null>(null);
  const [sheet, setSheet] = useState(false);
  const close = useCallback(() => setDialog(""), []);

  // ── Studio state lives here so results survive moving between screens ──
  const [studio, setStudioState] = useState<StudioState>({
    style: "Everyday",
    harmony: "balanced",
    includeJacket: true,
    anchorId: "",
    looks: null,
    busy: false,
    filter: "all",
    error: "",
  });
  const setStudio = useCallback((patch: Partial<StudioState>) => setStudioState((s) => ({ ...s, ...patch })), []);
  const studioRef = useRef(studio);
  studioRef.current = studio;
  const runStudio = useCallback(
    async (patch: Partial<StudioState> = {}) => {
      const next = { ...studioRef.current, ...patch };
      setStudioState({ ...next, busy: true, error: "" });
      try {
        const looks = await store.generate(next);
        setStudioState((s) => ({ ...s, looks, busy: false, filter: "all" }));
      } catch (e) {
        setStudioState((s) => ({ ...s, looks: [], busy: false, error: (e as Error).message }));
      }
    },
    [store.generate],
  );
  // A different wardrobe means different pieces: start the studio fresh.
  useEffect(() => setStudio({ looks: null, anchorId: "", error: "" }), [store.wid, setStudio]);

  // ── Outfit of the day: picked for today's weather at the user's location ─
  const [today, setToday] = useState<TodayState>(emptyToday);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [geo, setGeo] = useState<TodayState["geo"]>(() => ("geolocation" in navigator ? "idle" : "unsupported"));
  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) return setGeo("unsupported");
    setGeo("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setGeo("ok");
      },
      (err) => setGeo(err.code === err.PERMISSION_DENIED ? "denied" : "failed"),
      // Approximate is enough for weather; a recent fix is reused instead of waking the GPS.
      { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: 15_000 },
    );
  }, []);
  // Only ask without a click when the browser already has permission: no prompt on page load.
  useEffect(() => {
    // Development only: ?at=59.91,10.75 tries another place's weather (stripped from production builds).
    const at = (import.meta as unknown as { env: { DEV: boolean } }).env.DEV && new URLSearchParams(location.search).get("at");
    if (at) {
      const [latitude, longitude] = at.split(",").map(Number);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        setCoords({ latitude, longitude });
        setGeo("ok");
        return;
      }
    }
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (status.state === "granted") locate();
        else if (status.state === "denied") setGeo("denied");
      })
      .catch(() => {});
  }, [locate]);

  const pieceKey = store.pieces.map((p) => p.id).join();
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    const { pieces, wid } = storeRef.current;
    const has = (c: string) => pieces.some((p) => p.category === c);
    const day = dayOfYear();
    const style = styles[day % styles.length];
    if (!wid) return setToday((t) => ({ ...emptyToday, geo: t.geo }));
    let active = true;
    setToday((t) => ({ ...t, busy: true, error: "" }));
    // Without the weather (no location yet, or the forecast is down): a daily pick from the wardrobe.
    const fallback = (error = "") => {
      if (!has("tops") || !has("pants") || !has("shoes")) return active && setToday((t) => ({ ...emptyToday, geo: t.geo, error }));
      storeRef.current
        .generate({ style, harmony: "balanced", includeJacket: has("jackets"), anchorId: "" })
        .then((looks) => active && setToday((t) => ({ ...emptyToday, geo: t.geo, looks, index: looks.length ? day % looks.length : 0, error })))
        .catch((e) => active && setToday((t) => ({ ...emptyToday, geo: t.geo, error: e.message })));
    };
    if (!coords) fallback();
    else
      storeRef.current
        .today(coords, style)
        .then((r) => active && setToday((t) => ({ ...emptyToday, geo: t.geo, looks: r.looks, weather: r.weather, advice: r.advice, missing: r.missing })))
        .catch((e) => fallback(e.message));
    return () => {
      active = false;
    };
  }, [store.wid, pieceKey, coords]);
  useEffect(() => setToday((t) => ({ ...t, geo })), [geo]);

  const saveLook = useCallback(
    async (look: Look) => {
      try {
        if (store.isSaved(look)) {
          await store.unsaveLook(look);
          setToastData({ kind: "Removed", text: "Taken out of Saved", tone: "plain" });
          return;
        }
        await store.saveLook(look);
        setToastData({
          kind: "Saved",
          text: `Added to ${store.wardrobe?.name ?? "your wardrobe"}`,
          action: { label: "View", run: () => go({ name: "saved" }) },
        });
      } catch (e) {
        setToastData({ kind: "Couldn’t save", text: (e as Error).message, tone: "plain" });
      }
    },
    [store, go],
  );

  const openAdd = useCallback(() => {
    if (store.demo) setDialog("auth");
    else if (!store.wid) setDialog("wardrobe");
    else setDialog("add");
  }, [store.demo, store.wid]);

  // Has the user opened today's outfit yet? Keyed by local date, wardrobe and the outfit itself,
  // so a new day, another wardrobe or a different pick counts as new again.
  const todayLook = today.looks[today.index];
  const todayKey = todayLook && store.wid
    ? `${new Date().toLocaleDateString("en-CA")}|${store.wid}|${todayLook.items.map((i) => i.id).sort().join()}`
    : "";
  const [seenKey, setSeenKey] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (KEEP_OOTD_UNSEEN_FOR_TESTING || route.name !== "today" || !todayKey || todayKey === seenKey) return;
    setSeenKey(todayKey);
    try {
      localStorage.setItem(SEEN_KEY, todayKey);
    } catch {
      // Private windows can refuse storage; it still counts as seen for this visit.
    }
  }, [route.name, todayKey, seenKey]);

  const app: AppApi = {
    store,
    go,
    toast: setToastData,
    openAdd,
    askRemove: setRemoving,
    requireAccount: () => setDialog("auth"),
    studio,
    setStudio,
    runStudio,
    today,
    todayUnseen: !!todayKey && todayKey !== seenKey,
    locate,
    pickAnother: () => setToday((t) => ({ ...t, index: (t.index + 1) % Math.max(1, t.looks.length) })),
    saveLook,
  };

  const current = route.name === "piece" ? "wardrobe" : route.name;
  const screen =
    route.name === "today" ? <Today app={app} />
    : route.name === "wardrobe" ? <Wardrobe app={app} />
    : route.name === "studio" ? <Studio app={app} />
    : route.name === "saved" ? <Saved app={app} />
    : route.name === "piece" ? <PieceDetail app={app} id={route.id} />
    : <Home app={app} />;
  const summary = store.wid ? store.summaries[store.wid] : undefined;
  const pickWardrobe = (id: string) => {
    store.selectWardrobe(id);
    setSheet(false);
    if (route.name === "piece") go({ name: "wardrobe" });
  };

  return (
    <div className={`ow web app${dark ? " dark" : ""}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary">
        <a className="brand" href="#/" aria-label="Outfitly, home">
          <Logo title="" />
        </a>
        <nav className="nav" aria-label="Main">
          {nav.map((n) => (
            <a key={n.route} className="nav__link" href={href({ name: n.route } as Route)} aria-current={current === n.route ? "page" : undefined}>
              {current === n.route && <Collar />}
              <Icon name={n.icon} />
              {n.label}
              {n.route === "saved" && store.saved.length > 0 && <span className="nav__count">{store.saved.length}</span>}
            </a>
          ))}
        </nav>
        <div className="nav">
          <span className="t-eyebrow nav__label">{store.demo ? "Sample wardrobes" : "Wardrobes"}</span>
          {store.wardrobes.map((w) => {
            const s = store.summaries[w.id];
            return (
              <button key={w.id} className="nav__link" aria-pressed={w.id === store.wid} style={w.id === store.wid ? { fontWeight: 600 } : undefined} onClick={() => pickWardrobe(w.id)}>
                <Dots colors={s?.colors ?? []} />
                <span className="nav__text">{w.name}</span>
                <span className="nav__count">{s?.count ?? ""}</span>
              </button>
            );
          })}
          {store.catalogLoading && <span className="t-foot muted nav__label">Loading wardrobes…</span>}
          <button className="nav__link" style={{ color: "var(--label-2)" }} onClick={() => setDialog(store.demo ? "auth" : "wardrobe")}>
            <Icon name="plus" />
            New wardrobe
          </button>
        </div>
        <div className="sidebar__footer">
          <button className="profile-chip" onClick={() => setDialog("account")}>
            <span className="avatar">{store.demo ? <Icon name="out" /> : "Me"}</span>
            <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
              <span className="t-head" style={{ fontSize: 14 }}>
                {store.demo ? "Sign in" : "Account"}
              </span>
              <span className="t-cap muted">{store.demo ? "You’re viewing a sample wardrobe" : "Settings and sign out"}</span>
            </span>
          </button>
        </div>
      </aside>

      {/* Phone chrome: glass top bar, floating tab bar and add button (hidden on wide screens). */}
      <header className="topbar">
        <a href="#/" aria-label="Outfitly, home" className="topbar__logo">
          <LogoSymbol title="" />
        </a>
        <button className="glass glass-press wardrobe-switch" onClick={() => setSheet(true)} aria-haspopup="dialog">
          <Dots colors={summary?.colors ?? []} />
          <span className="wardrobe-switch__name">{store.wardrobe?.name ?? "Wardrobes"}</span>
          <Icon name="down" />
        </button>
        <button className="glass glass-circle glass-press" aria-label={store.demo ? "Sign in" : "Account"} onClick={() => setDialog("account")}>
          {store.demo ? <Icon name="out" /> : <span style={{ fontSize: 13, fontWeight: 650 }}>Me</span>}
        </button>
      </header>

      <main className="main" id="main">
        <div className="main__inner" key={route.name === "piece" ? `piece-${route.id}` : route.name}>
          {store.error && (
            <p role="alert" className="note note--error">
              {store.error}
              <button className="icon-btn" aria-label="Dismiss" onClick={store.clearError}>
                <Icon name="close" />
              </button>
            </p>
          )}
          {screen}
        </div>
      </main>

      <nav className="tabbar glass" aria-label="Main">
        <span className="tabbar__drop" style={{ transform: `translateX(${Math.max(0, tabs.findIndex((t) => t.route === current)) * 100}%)`, opacity: tabs.some((t) => t.route === current) ? 1 : 0 }} />
        {tabs.map((t) => (
          <a key={t.route} className="tabbar__item" href={href({ name: t.route } as Route)} aria-current={current === t.route ? "page" : undefined}>
            {current === t.route && <Collar className="tabbar__collar" />}
            <Icon name={t.icon} />
            {t.short}
          </a>
        ))}
      </nav>
      <button className="tab-accessory glass glass-press" aria-label="Add a piece" onClick={openAdd}>
        <Icon name="plus" />
      </button>

      <WardrobeSheet open={sheet} onClose={() => setSheet(false)} store={store} pick={pickWardrobe} create={() => { setSheet(false); setDialog(store.demo ? "auth" : "wardrobe"); }} />

      <Toast toast={toastData} onClose={closeToast} />
      <AddPiece app={app} open={dialog === "add"} onClose={close} />
      <NewWardrobeDialog app={app} open={dialog === "wardrobe"} onClose={close} />
      <AuthDialog
        open={dialog === "auth"}
        onClose={close}
        call={store.call}
        onSignedIn={(t) => {
          sessionStorage.setItem(TOKEN_KEY, t);
          setToken(t);
          go({ name: "home" });
        }}
      />
      <RemoveDialog app={app} piece={removing} onClose={() => setRemoving(null)} />
      <Dialog open={dialog === "account"} onClose={close} labelledBy="acc-t" width="min(420px, 100%)" top={96}>
        <DialogHead id="acc-t" title={store.demo ? "Welcome" : "Account"} onClose={close} />
        <div className="dialog__body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="field">
            <span className="field__label" id="appearance">
              Appearance
            </span>
            <Seg
              label="Appearance"
              radio
              value={theme}
              onChange={setTheme}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </div>
          <p className="t-foot muted">
            {store.demo
              ? "You’re exploring a sample wardrobe. Sign in to add your own pieces from photos and keep your outfits."
              : "Signed in. Sessions last 12 hours on this browser tab."}
          </p>
        </div>
        <div className="dialog__foot">
          {store.demo ? (
            <button className="btn btn--primary" onClick={() => setDialog("auth")}>
              Sign in or create an account
            </button>
          ) : (
            <button
              className="btn btn--danger"
              onClick={() => {
                close();
                signOut();
                go({ name: "home" });
              }}
            >
              <Icon name="out" />
              Sign out
            </button>
          )}
        </div>
      </Dialog>
    </div>
  );
}

/** Phone wardrobe picker: a floating glass sheet on the drawer curve. */
function WardrobeSheet({ open, onClose, store, pick, create }: { open: boolean; onClose: () => void; store: ReturnType<typeof useWardrobeStore>; pick: (id: string) => void; create: () => void }) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onClose]);
  return (
    <>
      <div className={`scrim scrim--sheet${open ? " is-open" : ""}`} onClick={onClose} aria-hidden="true" />
      <section className={`msheet glass glass--thick${open ? " is-open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="ws-title" aria-hidden={!open} inert={!open}>
        <span className="msheet__grab" aria-hidden="true" />
        <div className="msheet__head">
          <h2 className="t-title" id="ws-title">
            Your wardrobes
          </h2>
          <button className="glass glass-circle glass-press" onClick={onClose} aria-label="Close" style={{ width: 36, height: 36 }}>
            <Icon name="close" />
          </button>
        </div>
        <div className="group" role="radiogroup" aria-labelledby="ws-title" style={{ background: "var(--surface-2)" }}>
          {store.wardrobes.map((w) => {
            const s = store.summaries[w.id];
            const on = w.id === store.wid;
            return (
              <button key={w.id} className="row" role="radio" aria-checked={on} onClick={() => pick(w.id)} style={{ width: "100%", border: 0, background: "none", textAlign: "left", minHeight: 62 }}>
                <Dots colors={s?.colors ?? []} />
                <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <span className="t-head">{w.name}</span>
                  <span className="t-foot muted">{s ? `${s.count} piece${s.count === 1 ? "" : "s"}` : ""}</span>
                </span>
                {on && <Icon name="check" style={{ strokeWidth: 2.4 }} />}
              </button>
            );
          })}
        </div>
        <button className="btn btn--primary" onClick={create}>
          <Icon name="plus" />
          New wardrobe
        </button>
      </section>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
