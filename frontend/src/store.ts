import { useCallback, useEffect, useMemo, useState } from "react";
import { requestJson, resolveApiUrl } from "./api";
import { scoreLook } from "./colors";
import { useWardrobeCatalog, type Wardrobe } from "./useWardrobeCatalog";

export type Category = "tops" | "pants" | "dresses" | "shoes" | "jackets";
/** Which clothes the app offers, from the profile: women's, men's or both (the default). */
export type Wear = "women" | "men" | "both";
export type Piece = {
  id: string;
  name: string;
  category: Category;
  color: string;
  texture: string;
  style: string;
  /** Type within the category ("hoodie", "shorts"); null for pieces added before types existed. */
  garment?: string | null;
  image?: string | null;
};
export type Breakdown = { semantic: number; color: number; texture: number; weather?: number };
export type Weather = {
  temp_max: number;
  temp_min: number;
  temp_now: number;
  feels_like: number;
  rain_chance: number;
  precipitation: number;
  wind: number;
  code: number;
  summary: string;
  /** "Lyon, France", or "Near …" when there's no town there. Only a label: the forecast is for latitude/longitude. */
  place: string | null;
  latitude: number;
  longitude: number;
};
export type MissingPiece = { key: string; category: Category; item: string; reason: string };
export type TodayResult = { weather: Weather; advice: string[]; layer: string; looks: Look[]; missing: MissingPiece[] };
export type Coords = { latitude: number; longitude: number };
export type Look = {
  id?: string;
  name?: string;
  items: Piece[];
  style: string;
  score?: number;
  breakdown?: Breakdown;
};
export type Suggestion = {
  name: string;
  color: string;
  category: Category | null;
  garment: string | null;
  texture: string | null;
  style: string | null;
  detected: boolean;
};
export type Rating = { score: number; breakdown: Breakdown; style: string; estimated?: boolean };
export type GenerateOptions = { style: string; harmony: string; includeJacket: boolean; anchorId: string };
export type Summary = { count: number; colors: string[]; preview: Piece[] };

export const categories: { key: Category; label: string; one: string; role: string }[] = [
  { key: "tops", label: "Tops", one: "Top", role: "Top" },
  { key: "dresses", label: "Dresses", one: "Dress", role: "Dress" },
  { key: "pants", label: "Bottoms", one: "Bottoms", role: "Bottoms" },
  { key: "shoes", label: "Shoes", one: "Shoes", role: "Shoes" },
  { key: "jackets", label: "Jackets", one: "Jacket", role: "Jacket" },
];
// Mirrors GARMENTS in backend/app/attributes.py: what photo detection can recognise.
export const garmentTypes: Record<Category, string[]> = {
  tops: ["t-shirt", "shirt", "blouse", "polo shirt", "sweater", "hoodie", "sweatshirt", "tank top", "crop top", "camisole", "bodysuit", "corset top"],
  pants: ["jeans", "trousers", "chinos", "shorts", "skirt", "mini skirt", "wide-leg trousers", "culottes", "joggers", "leggings"],
  dresses: ["mini dress", "midi dress", "maxi dress", "shirt dress", "jumpsuit"],
  shoes: ["sneakers", "boots", "loafers", "sandals", "heels", "flats", "ballet flats", "mules", "ankle boots", "dress shoes"],
  jackets: ["jacket", "coat", "blazer", "cardigan", "puffer jacket", "trench coat", "cropped jacket"],
};
// Mirrors WOMEN_ONLY in backend/app/attributes.py; everything else is shared.
const WOMEN_ONLY = new Set([
  "blouse", "crop top", "camisole", "bodysuit", "corset top", "skirt", "mini skirt", "culottes", "leggings",
  "heels", "ballet flats", "mules", "cropped jacket", ...garmentTypes.dresses,
]);
/** The types offered for a category; `current` stays listed so an existing piece never loses its type. */
export const typesFor = (category: Category, wear: Wear, current = "") =>
  garmentTypes[category].filter((t) => wear !== "men" || !WOMEN_ONLY.has(t) || t === current);
/** Categories offered; dresses are hidden for men's wardrobes unless some are already in it. */
export const categoriesFor = (wear: Wear, pieces: { category: Category }[] = []) =>
  categories.filter((c) => c.key !== "dresses" || wear !== "men" || pieces.some((p) => p.category === "dresses"));
export const textures = ["cotton", "denim", "knit", "leather", "linen", "silk", "other"];
export const styles = ["Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"];

const env = (import.meta as unknown as { env: Record<string, string> }).env;
export const rawApi = env.VITE_API_URL;
const appEnv = env.VITE_APP_ENV as "dev" | "prod";
/** Configuration is validated per request so an invalid URL cannot crash the UI. */
export const apiBase = () => resolveApiUrl(rawApi, appEnv);
export const TOKEN_KEY = "atelier-token";

// Sample wardrobe for visitors who have not signed in (see useWardrobeCatalog's sampleWardrobes).
const sample: Piece[] = (
  [
    ["s1", "Beige merino crew", "tops", "#D8C7A8", "knit", "Minimal", "sweater"],
    ["s2", "Cream oxford shirt", "tops", "#EEE7D7", "cotton", "Smart casual", "shirt"],
    ["s3", "Sage cotton tee", "tops", "#A9B49B", "cotton", "Everyday", "t-shirt"],
    ["s4", "Navy chinos", "pants", "#1F2A4A", "cotton", "Smart casual", "chinos"],
    ["s5", "Blue denim jeans", "pants", "#3E5C8C", "denim", "Everyday", "jeans"],
    ["s6", "Khaki chinos", "pants", "#AFA277", "cotton", "Minimal", "chinos"],
    ["s7", "White leather sneakers", "shoes", "#FBF9F4", "leather", "Everyday", "sneakers"],
    ["s8", "Brown suede loafers", "shoes", "#7A5235", "leather", "Smart casual", "loafers"],
    ["s9", "Olive overshirt", "jackets", "#6B6A43", "cotton", "Everyday", "jacket"],
    ["s10", "Navy blazer", "jackets", "#27324A", "other", "Smart casual", "blazer"],
    ["s11", "Black midi dress", "dresses", "#232323", "silk", "Evening", "midi dress"],
    ["s12", "Brown ankle boots", "shoes", "#6E4A33", "leather", "Smart casual", "ankle boots"],
  ] as const
).map(([id, name, category, color, texture, style, garment]) => ({ id, name, category, color, texture, style, garment }));
// A women's capsule: dresses, skirts and heels, so visitors see that side of the app too.
const cityCapsule: Piece[] = (
  [
    ["c1", "Cream silk camisole", "tops", "#F0E6CD", "silk", "Evening", "camisole"],
    ["c2", "White crop top", "tops", "#F5F5F5", "cotton", "Streetwear", "crop top"],
    ["c3", "Pink silk blouse", "tops", "#EE96AA", "silk", "Smart casual", "blouse"],
    ["c4", "Black leather mini skirt", "pants", "#191919", "leather", "Evening", "mini skirt"],
    ["c5", "Beige wide-leg trousers", "pants", "#D6C4A3", "linen", "Minimal", "wide-leg trousers"],
    ["c6", "Blue denim skirt", "pants", "#3E5C8C", "denim", "Everyday", "skirt"],
    ["c7", "Sage linen midi dress", "dresses", "#96AA8C", "linen", "Everyday", "midi dress"],
    ["c8", "Burgundy silk mini dress", "dresses", "#781928", "silk", "Evening", "mini dress"],
    ["c9", "Navy shirt dress", "dresses", "#1E284B", "cotton", "Smart casual", "shirt dress"],
    ["c10", "Black heels", "shoes", "#191919", "leather", "Evening", "heels"],
    ["c11", "Beige ballet flats", "shoes", "#D6C4A3", "leather", "Minimal", "ballet flats"],
    ["c12", "White leather sneakers", "shoes", "#F5F5F5", "leather", "Everyday", "sneakers"],
    ["c13", "Camel trench coat", "jackets", "#C19A6B", "cotton", "Smart casual", "trench coat"],
    ["c14", "Blue cropped denim jacket", "jackets", "#3E5C8C", "denim", "Streetwear", "cropped jacket"],
  ] as const
).map(([id, name, category, color, texture, style, garment]) => ({ id, name, category, color, texture, style, garment }));

const sampleFor = (wid: string) =>
  wid === "travel"
    ? sample.filter((p) => ["s1", "s3", "s5", "s7", "s9"].includes(p.id))
    : wid === "city"
      ? cityCapsule
      : sample;

const signature = (look: Look) => look.items.map((i) => i.id).sort().join();
const demoKey = (wid: string) => `atelier-saved-${wid}`;
function readDemoSaved(wid: string): Look[] {
  try {
    return JSON.parse(localStorage.getItem(demoKey(wid)) || "[]");
  } catch {
    return [];
  }
}
function writeDemoSaved(wid: string, looks: Look[]) {
  try {
    localStorage.setItem(demoKey(wid), JSON.stringify(looks));
  } catch {
    // Private windows can refuse storage; the outfit stays saved for this visit.
  }
}

function demoLooks(pieces: Piece[], { style, harmony, includeJacket, anchorId }: GenerateOptions): Look[] {
  const pool = (c: Category) => pieces.filter((p) => p.category === c);
  const jackets = includeJacket ? pool("jackets") : [];
  const looks: Look[] = [];
  // Same two shapes as the backend: separates (top + bottoms) or a dress, then shoes and a layer.
  const bases: Piece[][] = [
    ...pool("tops").flatMap((top) => pool("pants").map((pants) => [top, pants])),
    ...pool("dresses").map((dress) => [dress]),
  ];
  for (const base of bases)
    for (const shoes of pool("shoes"))
      for (const jacket of jackets.length ? jackets : [undefined]) {
        const items = [...(jacket ? [jacket] : []), ...base, shoes];
        if (anchorId && !items.some((i) => i.id === anchorId)) continue;
        looks.push({ items, style, ...scoreLook(items, style, harmony) });
      }
  if (!looks.length) throw new Error("Add a top, bottoms and shoes, or a dress and shoes");
  looks.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  // Same diversity rule as the backend: one look per top/pants/shoes base.
  const seen = new Set<string>();
  return looks
    .filter((l) => {
      const base = l.items.filter((i) => i.category !== "jackets").map((i) => i.id).join();
      if (seen.has(base)) return false;
      seen.add(base);
      return true;
    })
    .slice(0, 6);
}

export function useWardrobeStore(token: string, onExpired: () => void) {
  const demo = !token;
  const call = useCallback(
    async <T = any>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> => {
      try {
        return await requestJson(apiBase() + path, {
          method,
          signal,
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body instanceof FormData || body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        // A 12-hour session ended: go back to the sample wardrobe instead of failing everywhere.
        if (e instanceof Error && e.message.startsWith("Session expired")) onExpired();
        throw e;
      }
    },
    [token, onExpired],
  );
  const loadCatalog = useCallback(
    (t: string, signal: AbortSignal) =>
      requestJson(apiBase() + "/wardrobes", { headers: { Authorization: `Bearer ${t}` }, signal }),
    [],
  );
  const catalog = useWardrobeCatalog(token, loadCatalog);
  const wid = catalog.selected;

  const [pieces, setPieces] = useState<Piece[]>([]);
  const [saved, setSaved] = useState<Look[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [others, setOthers] = useState<Record<string, Summary>>({});

  // The selected wardrobe's pieces and saved outfits.
  useEffect(() => {
    setError("");
    if (demo) {
      setPieces(wid ? sampleFor(wid) : []);
      setSaved(wid ? readDemoSaved(wid) : []);
      setLoading(false);
      return;
    }
    setPieces([]);
    setSaved([]);
    if (!catalog.ready || !wid) return;
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      call<Piece[]>(`/wardrobes/${wid}/clothes`, "GET", undefined, controller.signal),
      call<Look[]>(`/wardrobes/${wid}/outfits`, "GET", undefined, controller.signal),
    ])
      .then(([c, o]) => {
        if (controller.signal.aborted) return;
        setPieces(c);
        setSaved(o);
      })
      .catch((e) => !controller.signal.aborted && setError(e.message))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [demo, wid, catalog.ready, call]);

  // Piece counts and three colour dots for every wardrobe in the sidebar.
  useEffect(() => {
    if (demo) {
      setOthers(Object.fromEntries(catalog.wardrobes.map((w) => [w.id, summarise(sampleFor(w.id))])));
      return;
    }
    if (!catalog.ready) return;
    const controller = new AbortController();
    Promise.all(
      catalog.wardrobes.map((w) =>
        call<Piece[]>(`/wardrobes/${w.id}/clothes`, "GET", undefined, controller.signal)
          .then((list) => [w.id, summarise(list)] as const)
          .catch(() => [w.id, { count: 0, colors: [], preview: [] }] as const),
      ),
    ).then((entries) => !controller.signal.aborted && setOthers(Object.fromEntries(entries)));
    return () => controller.abort();
  }, [demo, catalog.ready, catalog.wardrobes, call]);

  const summaries = useMemo(
    () => ({ ...others, ...(wid ? { [wid]: summarise(pieces) } : {}) }),
    [others, wid, pieces],
  );

  const createWardrobe = useCallback(
    async (name: string) => {
      const w = await call<Wardrobe>("/wardrobes", "POST", { name });
      catalog.add(w);
      return w;
    },
    [call, catalog],
  );

  const analyze = useCallback(
    (file: File) => {
      const body = new FormData();
      body.append("image", file);
      return call<Suggestion>(`/wardrobes/${wid}/clothes/analyze`, "POST", body);
    },
    [call, wid],
  );

  const addPiece = useCallback(
    async (file: File, fields: Omit<Piece, "id" | "image">, target = wid) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.append(k, v ?? "");
      body.append("image", file);
      const piece = await call<Piece>(`/wardrobes/${target}/clothes`, "POST", body);
      if (target === wid) setPieces((list) => [...list, piece]);
      else
        setOthers((all) => {
          const s = all[target] ?? { count: 0, colors: [], preview: [] };
          return {
            ...all,
            [target]: { count: s.count + 1, colors: [...s.colors, piece.color].slice(0, 3), preview: [...s.preview, piece].slice(0, 3) },
          };
        });
      return piece;
    },
    [call, wid],
  );

  /** Removes a piece and every saved outfit that uses it. Resolves to the number of outfits removed. */
  const removePiece = useCallback(
    async (piece: Piece) => {
      const result = await call<{ removed_outfits: number }>(`/wardrobes/${wid}/clothes/${piece.id}`, "DELETE");
      setPieces((list) => list.filter((p) => p.id !== piece.id));
      setSaved((list) => list.filter((l) => !l.items.some((i) => i.id === piece.id)));
      return result.removed_outfits;
    },
    [call, wid],
  );

  const generate = useCallback(
    async (options: GenerateOptions): Promise<Look[]> => {
      if (demo) return demoLooks(pieces, options);
      return call<Look[]>(`/wardrobes/${wid}/generate`, "POST", {
        style: options.style,
        harmony: options.harmony,
        include_jacket: options.includeJacket,
        anchor_id: options.anchorId || null,
      });
    },
    [demo, call, wid, pieces],
  );

  const isSaved = useCallback((look: Look) => saved.some((l) => signature(l) === signature(look)), [saved]);

  const saveLook = useCallback(
    async (look: Look) => {
      if (!wid || isSaved(look)) return;
      const name = `${look.style} / ${saved.length + 1}`;
      if (demo) {
        const next = [...saved, { ...look, id: `demo-${Date.now()}`, name }];
        setSaved(next);
        writeDemoSaved(wid, next);
        return;
      }
      const { id } = await call<{ id: string }>(`/wardrobes/${wid}/outfits`, "POST", {
        name,
        style: look.style,
        cloth_ids: look.items.map((i) => i.id),
      });
      setSaved((list) => [...list, { ...look, id, name }]);
    },
    [demo, call, wid, saved, isSaved],
  );

  /** Outfit of the day from the forecast at these coordinates (rounded to ~1 km before sending). */
  const today = useCallback(
    (coords: Coords, style: string): Promise<TodayResult> => {
      const place = {
        latitude: Math.round(coords.latitude * 100) / 100,
        longitude: Math.round(coords.longitude * 100) / 100,
        style,
      };
      if (demo)
        return call<TodayResult>("/today/sample", "POST", {
          ...place,
          pieces: pieces.map(({ id, name, category, color, texture, style, garment }) => ({ id, name, category, color, texture, style, garment })),
        });
      return call<TodayResult>(`/wardrobes/${wid}/today`, "POST", place);
    },
    [demo, call, wid, pieces],
  );

  /** Outfit lab: rate an outfit the user put together. "Auto" finds the style it fits best. */
  const rate = useCallback(
    async (items: Piece[], style: string): Promise<Rating> => {
      if (!demo)
        return call<Rating>(`/wardrobes/${wid}/rate`, "POST", { cloth_ids: items.map((i) => i.id), style });
      const candidates = style === "Auto" ? styles : [style];
      return candidates
        .map((s) => ({ style: s, ...scoreLook(items, s) }))
        .reduce((best, r) => (r.score > best.score ? r : best));
    },
    [demo, call, wid],
  );

  /** Saved outfits of any wardrobe (the Saved screen shows them all). */
  const loadSaved = useCallback(
    async (target: string, signal?: AbortSignal): Promise<Look[]> => {
      if (target === wid) return saved;
      if (demo) return readDemoSaved(target);
      return call<Look[]>(`/wardrobes/${target}/outfits`, "GET", undefined, signal);
    },
    [demo, call, wid, saved],
  );

  const unsave = useCallback(
    async (look: Look, target = wid) => {
      if (demo) {
        const next = readDemoSaved(target).filter((l) => l.id !== look.id);
        writeDemoSaved(target, next);
        if (target === wid) setSaved(next);
        return;
      }
      await call(`/wardrobes/${target}/outfits/${look.id}`, "DELETE");
      if (target === wid) setSaved((list) => list.filter((l) => l.id !== look.id));
    },
    [demo, call, wid],
  );

  /** Turns a generated look back off by finding its saved copy. */
  const unsaveLook = useCallback(
    async (look: Look) => {
      const copy = saved.find((l) => signature(l) === signature(look));
      if (copy) await unsave(copy);
    },
    [saved, unsave],
  );

  return {
    demo,
    token,
    wardrobes: catalog.wardrobes,
    wardrobe: catalog.wardrobes.find((w) => w.id === wid) ?? null,
    wid,
    selectWardrobe: catalog.select,
    catalogLoading: catalog.loading,
    pieces,
    saved,
    summaries,
    loading: loading || catalog.loading,
    error: error || catalog.error,
    clearError: () => setError(""),
    createWardrobe,
    analyze,
    addPiece,
    removePiece,
    generate,
    today,
    rate,
    saveLook,
    unsaveLook,
    isSaved,
    loadSaved,
    unsave,
    call,
  };
}
export type Store = ReturnType<typeof useWardrobeStore>;

function summarise(list: Piece[]): Summary {
  // One dot per category where possible, so the dots read as a wardrobe, not three tops.
  const firsts = (["tops", "dresses", "pants", "jackets", "shoes"] as const)
    .map((c) => list.find((x) => x.category === c))
    .filter(Boolean) as Piece[];
  return { count: list.length, colors: firsts.slice(0, 3).map((p) => p.color), preview: firsts.slice(0, 3) };
}
