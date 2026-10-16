import { useCallback, useEffect, useState } from "react";
export type Wardrobe = { id: string; name: string };
export const sampleWardrobes: Wardrobe[] = [
  { id: "demo", name: "Everyday essentials" },
  { id: "travel", name: "Weekend getaway" },
  { id: "city", name: "City capsule" },
];
type Snapshot = {
  ownerToken: string;
  wardrobes: Wardrobe[];
  selected: string;
  loading: boolean;
  error: string;
};
export type LoadCatalog = (
  token: string,
  signal: AbortSignal,
) => Promise<Wardrobe[]>;

export function useWardrobeCatalog(token: string, load: LoadCatalog) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    ownerToken: token ? "" : token,
    wardrobes: token ? [] : sampleWardrobes,
    selected: token ? "" : "demo",
    loading: !!token,
    error: "",
  }));
  // The token and its catalog must match during rendering, before effects run.
  // This also prevents a previous account's IDs from crossing an auth boundary.
  const current: Snapshot =
    snapshot.ownerToken === token
      ? snapshot
      : {
          ownerToken: token,
          wardrobes: token ? [] : sampleWardrobes,
          selected: token ? "" : "demo",
          loading: !!token,
          error: "",
        };
  useEffect(() => {
    if (!token) {
      setSnapshot({
        ownerToken: "",
        wardrobes: sampleWardrobes,
        selected: "demo",
        loading: false,
        error: "",
      });
      return;
    }
    const controller = new AbortController();
    setSnapshot({
      ownerToken: token,
      wardrobes: [],
      selected: "",
      loading: true,
      error: "",
    });
    load(token, controller.signal)
      .then((wardrobes) => {
        if (controller.signal.aborted) return;
        setSnapshot({
          ownerToken: token,
          wardrobes,
          selected: wardrobes[0]?.id || "",
          loading: false,
          error: "",
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSnapshot({
          ownerToken: token,
          wardrobes: [],
          selected: "",
          loading: false,
          error:
            error instanceof Error ? error.message : "Could not load wardrobes",
        });
      });
    return () => controller.abort();
  }, [token, load]);
  const select = useCallback(
    (id: string) =>
      setSnapshot((previous) => {
        if (
          previous.ownerToken !== token ||
          !previous.wardrobes.some((w) => w.id === id)
        )
          return previous;
        return { ...previous, selected: id };
      }),
    [token],
  );
  const add = useCallback(
    (wardrobe: Wardrobe) =>
      setSnapshot((previous) => {
        if (!token || previous.ownerToken !== token) return previous;
        return {
          ...previous,
          wardrobes: [...previous.wardrobes, wardrobe],
          selected: wardrobe.id,
        };
      }),
    [token],
  );
  return {
    wardrobes: current.wardrobes,
    selected: current.selected,
    loading: current.loading,
    error: current.error,
    ready:
      !!token &&
      snapshot.ownerToken === token &&
      !current.loading &&
      !current.error,
    select,
    add,
  };
}
