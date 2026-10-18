import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./ow.css";
import "./app.css";
import { emptyLab, Lab, type LabState } from "./lab";
import { AccountPage, Avatar, displayName, useAvatarUrl, type Me } from "./account";
import { OutfitDetails } from "./outfit";
import { KEEP_OOTD_UNSEEN_FOR_TESTING } from "./testing";
import { Logo, LogoSymbol } from "./brand";
import { resolvedTheme, validTheme, type Theme } from "./theme";
import { styles, TOKEN_KEY, useWardrobeStore, type Coords, type Look, type Piece } from "./store";
import { Collar, Dialog, DialogHead, Dots, Icon, Seg, Toast, tick, type IconName, type ToastData } from "./ui";
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
  Wardrobes,
  type App as AppApi,
  type AddPrefill,
  type Route,
  type StudioState,
  type TodayState,
} from "./screens";
import { NextBuys, useNextBuys } from "./nextbuys";
import { StylePicker } from "./onboarding";

// ── Routing: #/, #/today, #/wardrobes, #/wardrobe, #/studio, #/lab, #/saved, #/next, #/account, #/piece/<id> ──────
function parse(hash: string): Route {
  const [, name, id] = hash.replace(/^#/, "").split("/");
  if (name === "piece" && id) return { name: "piece", id: decodeURIComponent(id) };
  if (["today", "wardrobes", "wardrobe", "studio", "saved", "next", "lab", "account"].includes(name)) return { name } as Route;
  return { name: "home" };
}
const href = (r: Route) => (r.name === "piece" ? `#/piece/${encodeURIComponent(r.id)}` : r.name === "home" ? "#/" : `#/${r.name}`);

const nav: { route: Route["name"]; label: string; short: string; icon: IconName; tab: boolean }[] = [
  { route: "home", label: "Home", short: "Home", icon: "home", tab: true },
  { route: "today", label: "Today", short: "Today", icon: "today", tab: false },
  { route: "wardrobes", label: "Wardrobes", short: "Wardrobe", icon: "wardrobe", tab: true },
  { route: "studio", label: "Outfit studio", short: "Studio", icon: "studio", tab: true },
  { route: "lab", label: "Outfit lab", short: "Lab", icon: "lab", tab: false },
  { route: "saved", label: "Saved", short: "Saved", icon: "saved", tab: true },
  { route: "next", label: "Next buys", short: "Buys", icon: "bag", tab: false },
];
const tabs = nav.filter((n) => n.tab);
const SEEN_KEY = "outfitly-ootd-seen";
// The sample wardrobe has no account to remember it on: Next buys was introduced in this browser.
const DEMO_BUYS_SEEN_KEY = "outfitly-buys-seen";
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

  // The signed-in profile (username, photo) for the sidebar and the Account page.
  const [me, setMe] = useState<Me | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const avatarUrl = useAvatarUrl(store.demo ? null : me, avatarVersion);
  useEffect(() => {
    setMe(null);
    if (!token) return;
    store.call<Me>("/me").then(setMe).catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [dialog, setDialog] = useState<"" | "add" | "auth" | "wardrobe">("");
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
      if (!has("shoes") || !(has("dresses") || (has("tops") && has("pants")))) return active && setToday((t) => ({ ...emptyToday, geo: t.geo, error }));
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

  const [addPrefill, setAddPrefill] = useState<AddPrefill | null>(null);
  const openAdd = useCallback(() => {
    setAddPrefill(null);
    if (store.demo) setDialog("auth");
    else if (!store.wid) setDialog("wardrobe");
    else setDialog("add");
  }, [store.demo, store.wid]);
  const addSuggested = useCallback(
    (prefill: AddPrefill) => {
      openAdd();
      if (!store.demo && store.wid) setAddPrefill(prefill);
    },
    [openAdd, store.demo, store.wid],
  );

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

  // Next buys: loaded for the app so Home can announce it. Announced once per user: the card
  // animates until Next buys is first opened, then never again (remembered on the account; in this
  // browser for the sample wardrobe). Only once there are ideas to show.
  const nextBuys = useNextBuys(store, store.demo ? "both" : (me?.wear ?? "both"));
  const [demoBuysSeen, setDemoBuysSeen] = useState(() => {
    try {
      return localStorage.getItem(DEMO_BUYS_SEEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const buysSeen = store.demo ? demoBuysSeen : !me || !!me.seen?.includes("next-buys");
  useEffect(() => {
    if (route.name !== "next" || buysSeen) return;
    if (store.demo) {
      setDemoBuysSeen(true);
      try {
        localStorage.setItem(DEMO_BUYS_SEEN_KEY, "1");
      } catch {
        // Private windows can refuse storage; it still counts as seen for this visit.
      }
    } else {
      setMe((m) => (m ? { ...m, seen: [...(m.seen ?? []), "next-buys"] } : m));
      store.call<Me>("/me", "PATCH", { seen: ["next-buys"] }).then(setMe).catch(() => {});
    }
  }, [route.name, buysSeen, store.demo]); // eslint-disable-line react-hooks/exhaustive-deps
  const buysUnseen = !buysSeen && !!nextBuys.result?.suggestions.length;

  // "What's your style?": asked once after the first sign-in (styles null = never answered), so the
  // persona has something before any clothes. Closing it just asks again next visit; Skip doesn't.
  const [picker, setPicker] = useState<"first" | "edit" | null>(null);
  useEffect(() => {
    if (!store.demo && me && me.styles === null) setPicker((p) => p ?? "first");
  }, [me, store.demo]);
  // The first style picked is where the studio starts, until the user chooses there.
  useEffect(() => {
    const first = me?.styles?.[0];
    if (first) setStudioState((s) => (s.looks === null && s.style === "Everyday" ? { ...s, style: first } : s));
  }, [me?.styles]);
  const saveStyles = async (picked: string[]) => {
    const wasFirst = picker === "first";
    setMe(await store.call<Me>("/me", "PATCH", { styles: picked }));
    setPicker(null);
    setToastData(
      wasFirst
        ? { kind: "Saved", text: "Now add your first piece", action: { label: "Add a piece", run: openAdd } }
        : { kind: "Saved", text: "Styles updated" },
    );
  };
  const skipStyles = () => {
    setPicker(null);
    store.call<Me>("/me", "PATCH", { styles: [] }).then(setMe).catch(() => {});
  };

  // Outfit lab picks live here so they survive a visit to a piece's page; a new wardrobe starts empty.
  const [lab, setLab] = useState<LabState>(emptyLab);
  useEffect(() => setLab(emptyLab), [store.wid]);

  const leave = () => {
    signOut();
    go({ name: "home" });
  };

  const [details, setDetails] = useState<Look | null>(null);

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
    nextBuys,
    buysUnseen,
    locate,
    pickAnother: () => setToday((t) => ({ ...t, index: (t.index + 1) % Math.max(1, t.looks.length) })),
    saveLook,
    addSuggested,
    newWardrobe: () => setDialog(store.demo ? "auth" : "wardrobe"),
    wear: store.demo ? "both" : (me?.wear ?? "both"),
    openOutfit: setDetails,
    openLookInLab: (look: Look) => {
      setLab((l) => ({ ...l, style: look.style, picks: Object.fromEntries(look.items.map((i) => [i.category, i.id])) }));
      go({ name: "lab" });
    },
    openInLab: (piece: Piece) => {
      setLab((l) => ({ ...l, picks: { ...l.picks, [piece.category]: piece.id } }));
      go({ name: "lab" });
    },
  };

  // A wardrobe and its pieces live under "Wardrobes" in the navigation.
  const current = route.name === "piece" || route.name === "wardrobe" ? "wardrobes" : route.name;
  const screen =
    route.name === "today" ? <Today app={app} />
    : route.name === "wardrobe" ? <Wardrobe app={app} />
    : route.name === "studio" ? <Studio app={app} />
    : route.name === "saved" ? <Saved app={app} />
    : route.name === "next" ? <NextBuys app={app} />
    : route.name === "lab" ? <Lab app={app} lab={lab} setLab={setLab} />
    : route.name === "wardrobes" ? <Wardrobes app={app} />
    : route.name === "account" ? (
      <AccountPage
        store={store}
        me={me}
        setMe={setMe}
        avatarUrl={avatarUrl}
        bumpAvatar={() => setAvatarVersion((v) => v + 1)}
        editStyles={() => setPicker("edit")}
        theme={theme}
        setTheme={setTheme}
        toast={setToastData}
        signIn={() => setDialog("auth")}
        signOut={leave}
      />
    )
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
        <div className="sidebar__footer">
          <button
            className="profile-chip"
            aria-current={route.name === "account" ? "page" : undefined}
            onClick={() => (store.demo ? setDialog("auth") : go({ name: "account" }))}
          >
            <Avatar me={store.demo ? null : me} url={avatarUrl} />
            <span style={{ display: "flex", flexDirection: "column", textAlign: "left", minWidth: 0 }}>
              <span className="t-head nav__text" style={{ fontSize: 14 }}>
                {store.demo ? "Sign in" : me ? displayName(me) : "Account"}
              </span>
              <span className="t-cap muted">{store.demo ? "You’re viewing a sample wardrobe" : "Account settings"}</span>
            </span>
          </button>
          {!store.demo && (
            <button className="nav__link sidebar__signout" onClick={leave}>
              <Icon name="out" />
              Sign out
            </button>
          )}
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
        <button className="glass glass-circle glass-press" aria-label={store.demo ? "Sign in" : "Account"} onClick={() => (store.demo ? setDialog("auth") : go({ name: "account" }))} style={{ overflow: "hidden" }}>
          {store.demo ? <Icon name="out" /> : <Avatar me={me} url={avatarUrl} size={44} />}
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
      <AddPiece app={app} open={dialog === "add"} onClose={close} prefill={addPrefill} />
      <StylePicker
        open={!!picker && !!me}
        first={picker === "first"}
        initial={me?.styles ?? []}
        wear={me?.wear ?? "both"}
        onSave={saveStyles}
        onSkip={skipStyles}
        onClose={() => setPicker(null)}
      />
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
      <OutfitDetails app={app} look={details} onClose={() => setDetails(null)} />
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

  // Drag to dismiss, from the grab bar or the header: the sheet follows the finger, dragging up
  // resists (rubber band), and letting go past a third of its height or with a quick flick closes it.
  // Otherwise it settles back on the drawer curve.
  const sheet = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer can already be gone (very fast taps); dragging still works without capture.
    }
    if (sheet.current) sheet.current.style.transition = "none";
    if (scrim.current) scrim.current.style.transition = "none";
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !sheet.current) return;
    const raw = e.clientY - d.y;
    d.dy = raw < 0 ? raw * 0.2 : raw;
    sheet.current.style.transform = `translateY(${d.dy}px)`;
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 - d.dy / sheet.current.offsetHeight));
  };
  const onDragEnd = (cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !sheet.current) return;
    const height = sheet.current.offsetHeight;
    const speed = d.dy / Math.max(1, performance.now() - d.t); // px per ms
    // Hand back to the CSS transitions: they animate from wherever the finger let go.
    for (const el of [sheet.current, scrim.current]) el?.style.removeProperty("transition");
    sheet.current.style.removeProperty("transform");
    scrim.current?.style.removeProperty("opacity");
    if (!cancelled && (d.dy > height / 3 || (speed > 0.5 && d.dy > 24))) {
      tick();
      onClose();
    }
  };
  return (
    <>
      <div ref={scrim} className={`scrim scrim--sheet${open ? " is-open" : ""}`} onClick={onClose} aria-hidden="true" />
      <section ref={sheet} className={`msheet glass glass--thick${open ? " is-open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="ws-title" aria-hidden={!open} inert={!open}>
        <div
          className="msheet__drag"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={() => onDragEnd(false)}
          onPointerCancel={() => onDragEnd(true)}
        >
        <span className="msheet__grab" aria-hidden="true" />
        <div className="msheet__head">
          <h2 className="t-title" id="ws-title">
            Your wardrobes
          </h2>
          <button className="glass glass-circle glass-press" onClick={onClose} aria-label="Close" style={{ width: 36, height: 36 }}>
            <Icon name="close" />
          </button>
        </div>
        </div>
        <div className="group" role="radiogroup" aria-labelledby="ws-title" style={{ background: "var(--surface-2)" }}>
          {store.wardrobes.map((w) => {
            const s = store.summaries[w.id];
            const on = w.id === store.wid;
            return (
              <button key={w.id} className="row" role="radio" aria-checked={on} onClick={() => {
                  if (!on) tick();
                  pick(w.id);
                }} style={{ width: "100%", border: 0, background: "none", textAlign: "left", minHeight: 62 }}>
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
