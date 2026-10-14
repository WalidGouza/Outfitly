import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ApiError,
  photoForm,
  request,
  type Category,
  type Look,
  type PhotoFile,
  type Piece,
  type Suggestion,
  type Wardrobe,
} from "./api";
import { useSession } from "./session";

// Same sample wardrobe as the web app's demo mode (frontend/src/main.tsx).
const samplePieces: Piece[] = (
  [
    ["s1", "The everyday tee", "tops", "#e9e5dc", "cotton"],
    ["s2", "Relaxed Oxford", "tops", "#aab6ae", "cotton"],
    ["s3", "Straight-leg denim", "pants", "#506778", "denim"],
    ["s4", "Tailored trousers", "pants", "#817864", "linen"],
    ["s5", "Classic court sneakers", "shoes", "#e8e4dc", "leather"],
    ["s6", "Suede loafers", "shoes", "#886448", "leather"],
    ["s7", "The chore jacket", "jackets", "#8b927a", "cotton"],
    ["s8", "Soft knit cardigan", "jackets", "#b8a18a", "knit"],
  ] as const
).map(([id, name, category, color, texture]) => ({ id, name, category, color, texture, style: "Everyday" }));
const sampleWardrobes: Wardrobe[] = [
  { id: "everyday", name: "Everyday essentials" },
  { id: "travel", name: "Weekend getaway" },
];
// The getaway wardrobe is a smaller capsule.
const sampleFor = (id: string | null) =>
  id === "travel" ? samplePieces.filter((p) => ["s2", "s4", "s6", "s8"].includes(p.id)) : samplePieces;

export type GenerateOptions = {
  style: string;
  harmony: string;
  includeJacket: boolean;
  anchorId: string | null;
};

type Store = {
  loading: boolean;
  wardrobes: Wardrobe[];
  wardrobeId: string | null;
  pieces: Piece[];
  saved: Look[];
  error: string | null;
  refresh: () => Promise<void>;
  selectWardrobe: (id: string) => void;
  createWardrobe: (name: string) => Promise<void>;
  analyze: (photo: PhotoFile) => Promise<Suggestion>;
  addPiece: (photo: PhotoFile, fields: Omit<Piece, "id" | "image">) => Promise<void>;
  removePiece: (piece: Piece) => Promise<number>;
  generate: (options: GenerateOptions) => Promise<Look[]>;
  saveLook: (look: Look) => Promise<void>;
  removeLook: (look: Look) => Promise<void>;
  isSaved: (look: Look) => boolean;
};

const WardrobeContext = createContext<Store | null>(null);
const signature = (look: Look) => look.items.map((i) => i.id).sort().join();

/** Keyed by session in the root layout: signing in, out or exploring starts from a clean slate. */
export function WardrobeProvider({ children }: { children: ReactNode }) {
  const { token, demo, signOut } = useSession();
  const live = Boolean(token) && !demo;
  const [loading, setLoading] = useState(live);
  const [remoteWardrobes, setRemoteWardrobes] = useState<Wardrobe[]>([]);
  const [wardrobeId, setWardrobeId] = useState<string | null>(demo ? sampleWardrobes[0].id : null);
  const [remotePieces, setRemotePieces] = useState<Piece[]>([]);
  const [remoteSaved, setRemoteSaved] = useState<Look[]>([]);
  const [demoSaved, setDemoSaved] = useState<Record<string, Look[]>>({});
  const [error, setError] = useState<string | null>(null);

  // Demo data is derived, not copied into state.
  const wardrobes = demo ? sampleWardrobes : remoteWardrobes;
  const pieces = demo ? sampleFor(wardrobeId) : remotePieces;
  const saved = useMemo(
    () => (demo ? (wardrobeId ? (demoSaved[wardrobeId] ?? []) : []) : remoteSaved),
    [demo, wardrobeId, demoSaved, remoteSaved],
  );

  // Any 401 means the 12-hour session expired: return to sign-in instead of failing everywhere.
  const call = useCallback(
    async <T,>(path: string, options: { method?: string; body?: unknown } = {}) => {
      try {
        return await request<T>(path, { ...options, token: token ?? undefined });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await signOut();
        throw e;
      }
    },
    [token, signOut],
  );

  const fetchWardrobe = useCallback(
    (id: string) => Promise.all([call<Piece[]>(`/wardrobes/${id}/clothes`), call<Look[]>(`/wardrobes/${id}/outfits`)]),
    [call],
  );

  /** Loads the wardrobe list and the selected wardrobe; state is only set once data arrives. */
  const load = useCallback(
    async (preferredId: string | null) => {
      const list = await call<Wardrobe[]>("/wardrobes");
      const id = list.find((w) => w.id === preferredId)?.id ?? list[0]?.id ?? null;
      const [clothes, outfits] = id ? await fetchWardrobe(id) : [[], []];
      return { list, id, clothes, outfits };
    },
    [call, fetchWardrobe],
  );

  const apply = useCallback((data: Awaited<ReturnType<typeof load>>) => {
    setRemoteWardrobes(data.list);
    setWardrobeId(data.id);
    setRemotePieces(data.clothes);
    setRemoteSaved(data.outfits);
    setError(null);
  }, []);

  // Initial load for a signed-in session (the provider remounts per session).
  useEffect(() => {
    if (!live) return;
    let active = true;
    load(null)
      .then((data) => active && apply(data))
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [live, load, apply]);

  /** Pull to refresh. */
  const refresh = useCallback(async () => {
    if (!live) return;
    setLoading(true);
    try {
      apply(await load(wardrobeId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [live, load, apply, wardrobeId]);

  const selectWardrobe = useCallback(
    (id: string) => {
      setWardrobeId(id);
      if (!live) return;
      setLoading(true);
      fetchWardrobe(id)
        .then(([clothes, outfits]) => {
          setRemotePieces(clothes);
          setRemoteSaved(outfits);
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => setLoading(false));
    },
    [live, fetchWardrobe],
  );

  const createWardrobe = useCallback(
    async (name: string) => {
      const w = await call<Wardrobe>("/wardrobes", { method: "POST", body: { name } });
      setRemoteWardrobes((list) => [...list, w]);
      setWardrobeId(w.id);
      setRemotePieces([]);
      setRemoteSaved([]);
    },
    [call],
  );

  const analyze = useCallback(
    (photo: PhotoFile) =>
      call<Suggestion>(`/wardrobes/${wardrobeId}/clothes/analyze`, { method: "POST", body: photoForm(photo) }),
    [call, wardrobeId],
  );

  const addPiece = useCallback(
    async (photo: PhotoFile, fields: Omit<Piece, "id" | "image">) => {
      const piece = await call<Piece>(`/wardrobes/${wardrobeId}/clothes`, {
        method: "POST",
        body: photoForm(photo, fields as Record<string, string>),
      });
      setRemotePieces((list) => [...list, piece]);
    },
    [call, wardrobeId],
  );

  // Optimistic: the piece leaves at once; if the server refuses, it comes back.
  const removePiece = useCallback(
    async (piece: Piece) => {
      const before = { pieces: remotePieces, saved: remoteSaved };
      setRemotePieces((list) => list.filter((p) => p.id !== piece.id));
      setRemoteSaved((list) => list.filter((l) => !l.items.some((i) => i.id === piece.id)));
      try {
        const result = await call<{ removed_outfits: number }>(`/wardrobes/${wardrobeId}/clothes/${piece.id}`, {
          method: "DELETE",
        });
        return result.removed_outfits;
      } catch (e) {
        setRemotePieces(before.pieces);
        setRemoteSaved(before.saved);
        throw e;
      }
    },
    [call, wardrobeId, remotePieces, remoteSaved],
  );

  const generate = useCallback(
    async ({ style, harmony, includeJacket, anchorId }: GenerateOptions) => {
      if (!demo) {
        return call<Look[]>(`/wardrobes/${wardrobeId}/generate`, {
          method: "POST",
          body: { style, harmony, include_jacket: includeJacket, anchor_id: anchorId },
        });
      }
      // Demo: simple local combinations, as on the web.
      const pool = (c: Category) => pieces.filter((p) => p.category === c);
      const jackets = pool("jackets");
      const looks: Look[] = [];
      for (const top of pool("tops"))
        for (const pants of pool("pants"))
          for (const shoes of pool("shoes")) {
            const jacket = includeJacket && jackets.length ? jackets[looks.length % jackets.length] : undefined;
            const items = [top, pants, shoes, ...(jacket ? [jacket] : [])];
            if (!anchorId || items.some((i) => i.id === anchorId)) looks.push({ items, style });
          }
      if (!looks.length) throw new Error("Add at least one top, one pair of pants, and one pair of shoes");
      return looks.slice(0, 6);
    },
    [demo, call, wardrobeId, pieces],
  );

  const isSaved = useCallback((look: Look) => saved.some((l) => signature(l) === signature(look)), [saved]);

  const saveLook = useCallback(
    async (look: Look) => {
      const name = `${look.style} / ${saved.length + 1}`;
      if (demo) {
        if (!wardrobeId) return;
        const entry = { ...look, id: `demo-${Date.now()}`, name };
        setDemoSaved((all) => ({ ...all, [wardrobeId]: [...(all[wardrobeId] ?? []), entry] }));
        return;
      }
      // Optimistic: shown as saved at once under a temporary id, swapped for the real one.
      const pendingId = `pending-${Date.now()}`;
      setRemoteSaved((list) => [...list, { ...look, id: pendingId, name }]);
      try {
        const result = await call<{ id: string }>(`/wardrobes/${wardrobeId}/outfits`, {
          method: "POST",
          body: { name, style: look.style, cloth_ids: look.items.map((i) => i.id) },
        });
        setRemoteSaved((list) => list.map((l) => (l.id === pendingId ? { ...l, id: result.id } : l)));
      } catch (e) {
        setRemoteSaved((list) => list.filter((l) => l.id !== pendingId));
        throw e;
      }
    },
    [demo, call, wardrobeId, saved.length],
  );

  const removeLook = useCallback(
    async (look: Look) => {
      if (demo) {
        if (!wardrobeId) return;
        setDemoSaved((all) => ({ ...all, [wardrobeId]: (all[wardrobeId] ?? []).filter((l) => l.id !== look.id) }));
        return;
      }
      // An outfit still being saved has no server id yet; it can't be removed until it does.
      if (look.id?.startsWith("pending-")) return;
      const before = remoteSaved;
      setRemoteSaved((list) => list.filter((l) => l.id !== look.id));
      try {
        await call(`/wardrobes/${wardrobeId}/outfits/${look.id}`, { method: "DELETE" });
      } catch (e) {
        setRemoteSaved(before);
        throw e;
      }
    },
    [demo, call, wardrobeId, remoteSaved],
  );

  const value = useMemo<Store>(
    () => ({
      loading,
      wardrobes,
      wardrobeId,
      pieces,
      saved,
      error,
      refresh,
      selectWardrobe,
      createWardrobe,
      analyze,
      addPiece,
      removePiece,
      generate,
      saveLook,
      removeLook,
      isSaved,
    }),
    [loading, wardrobes, wardrobeId, pieces, saved, error, refresh, selectWardrobe, createWardrobe, analyze, addPiece, removePiece, generate, saveLook, removeLook, isSaved],
  );
  return <WardrobeContext.Provider value={value}>{children}</WardrobeContext.Provider>;
}

export function useWardrobe() {
  const store = useContext(WardrobeContext);
  if (!store) throw new Error("useWardrobe must be used inside WardrobeProvider");
  return store;
}
