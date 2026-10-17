// Suggestions: pieces the user doesn't own that would raise an outfit's score.
//
// For each slot of the outfit (and an extra layer when there is none) every garment type that
// suits the outfit's style is tried in every wearable colour, in its natural fabric, and scored
// with the same colour / fabric / style / garment rules as the rest of the app (colors.ts
// scoreLook). Only clear improvements are kept.
//
// Signed-in users get the backend's version (POST /wardrobes/{id}/improve and
// GET /wardrobes/{id}/suggestions, app/improve.py), scored with their photos and ranked with their
// persona; this one serves the sample wardrobe and is the fallback when the backend can't answer.
// Each suggestion carries a structured `spec` and a search `query` ("white leather sneakers"),
// which product matching will plug into later.
import { colorFamily, colorName, colorRelation, scoreLook, textureScore } from "./colors";
import { TYPES } from "./garments";

export type Category = "tops" | "pants" | "dresses" | "shoes" | "jackets";
export type Wear = "women" | "men" | "both";
type Item = { id: string; name: string; category: Category; color: string; texture: string; style: string; garment?: string | null };
export type Spec = { category: Category; garment: string; color: string; color_name: string; texture: string; style: string };

export type Suggestion = {
  /** "category|garment|colour": identifies the piece in feedback events and dismissals. */
  key: string;
  /** What to look for; later matched against real products. */
  spec: Spec;
  /** Search phrase for product matching, e.g. "white leather sneakers". */
  query: string;
  /** The owned piece it would replace; undefined when it adds a layer. */
  replaces?: Item;
  /** Score points gained. */
  gain: number;
  title: string;
  reason: string;
  /** How many of the wardrobe's outfits this piece improves. */
  outfits?: number | null;
};

/** An outfit a "Next buys" piece improves, with its score before and after. */
export type BuyExample = {
  cloth_ids: string[];
  style: string;
  source: "saved" | "generated";
  name: string | null;
  replaces: string | null;
  gain: number;
  before: number;
  after: number;
};
/** A piece worth buying for the whole wardrobe (Next buys). */
export type NextBuy = {
  key: string;
  spec: Spec;
  query: string;
  title: string;
  value: number;
  outfits: number;
  total_gain: number;
  avg_gain: number;
  best_gain: number;
  reason: string;
  examples: BuyExample[];
};
export type NextBuysResult = { suggestions: NextBuy[]; considered: number; complete: boolean; estimated: boolean };
export type WishItem = { key: string; spec: Spec; query: string; title: string };

// Colours people actually buy clothes in, with the swatch values of the named-colour table.
const PALETTE: [string, string][] = [
  ["Black", "#191919"], ["Charcoal", "#3C4046"], ["Grey", "#808080"], ["Light grey", "#C3C3C3"],
  ["White", "#F5F5F5"], ["Cream", "#F0E6CD"], ["Beige", "#D6C4A3"], ["Camel", "#C19A6B"],
  ["Brown", "#6E482D"], ["Burgundy", "#781928"], ["Olive", "#6B6B34"], ["Khaki", "#AAA073"],
  ["Sage", "#96AA8C"], ["Navy", "#1E284B"], ["Light blue", "#9BBEE1"], ["Blue", "#2D5ABE"],
  ["Red", "#C8232D"], ["Pink", "#EE96AA"],
];

const MIN_GAIN = 2; // points; smaller differences aren't worth buying something for
// Near-ties go to colours that work with almost anything: they're the more useful buy.
const VERSATILE = new Set(["Black", "Charcoal", "Grey", "White", "Cream", "Beige", "Camel", "Brown", "Navy"]);
const ROLE: Record<Category, string> = { tops: "top", pants: "bottoms", dresses: "dress", shoes: "shoes", jackets: "layer" };

// Types that already say their fabric ("jeans" are denim) don't repeat it.
const IMPLIED: Record<string, string> = { jeans: "denim", sweater: "knit", cardigan: "knit" };
const describe = (colour: string, texture: string, garment: string) =>
  `${colour} ${texture !== "other" && IMPLIED[garment] !== texture ? `${texture} ` : ""}${garment}`.toLowerCase();

/** How typical a garment is of a style (its first listed style is 1): breaks ties between pieces that score the same. */
const primacy = (garment: string, style: string) => {
  const list = TYPES[garment]?.styles ?? [];
  const i = list.indexOf(style);
  return i < 0 ? 0 : 1 - i / list.length;
};
const preference = (s: Suggestion) => s.gain + (VERSATILE.has(s.spec.color_name) ? 1 : 0) + 0.5 * primacy(s.spec.garment, s.spec.style);

type Breakdown = { semantic: number; color: number; texture: number };
type Found = Suggestion & { before: Breakdown; after: Breakdown; scoreBefore: number; scoreAfter: number };

/** Every clear improvement to one outfit (gain >= MIN_GAIN), one per candidate piece. */
export function improvementsFor(items: Item[], style: string, wardrobe: Item[], wear: Wear = "both"): Found[] {
  if (items.length < 2) return [];
  const before = scoreLook(items, style);
  const owned = new Set(wardrobe.map((p) => `${p.category}|${p.garment ?? ""}|${colorName(p.color)}`));
  const slots: { category: Category; replaces?: Item }[] = items.map((p) => ({ category: p.category, replaces: p }));
  if (!items.some((p) => p.category === "jackets")) slots.push({ category: "jackets" });

  const found: Found[] = [];
  for (const slot of slots) {
    for (const [garment, t] of Object.entries(TYPES)) {
      if (t.category !== slot.category || !t.styles.includes(style) || (t.women && wear === "men")) continue;
      for (const [name, hex] of PALETTE) {
        const key = `${t.category}|${garment}|${name}`;
        if (owned.has(key)) continue;
        if (slot.replaces && slot.replaces.garment === garment && colorName(slot.replaces.color) === name) continue;
        const piece: Item = { id: "suggested", name: `${name} ${garment}`, category: t.category, color: hex, texture: t.fabric, style, garment };
        const next = slot.replaces ? items.map((i) => (i === slot.replaces ? piece : i)) : [...items, piece];
        const after = scoreLook(next, style);
        const gain = after.score - before.score;
        if (gain < MIN_GAIN) continue;
        const query = describe(name, t.fabric, garment);
        const s: Found = {
          key,
          spec: { category: t.category, garment, color: hex, color_name: name, texture: t.fabric, style },
          query,
          replaces: slot.replaces,
          gain,
          title: query.charAt(0).toUpperCase() + query.slice(1),
          reason: "",
          before: before.breakdown,
          after: after.breakdown,
          scoreBefore: before.score,
          scoreAfter: after.score,
        };
        s.reason = reasonFor(s, items, before.breakdown, after.breakdown, style);
        found.push(s);
      }
    }
  }
  return found;
}

/** Up to `limit` suggestions for this outfit, judged as `style`: the best per slot, best first. */
export function suggestFor(items: Item[], style: string, wardrobe: Item[], wear: Wear = "both", limit = 3): Suggestion[] {
  const bySlot = new Map<string, Found>();
  for (const s of improvementsFor(items, style, wardrobe, wear)) {
    const slot = s.replaces?.id ?? "layer";
    const top = bySlot.get(slot);
    if (!top || preference(s) > preference(top)) bySlot.set(slot, s);
  }
  return [...bySlot.values()]
    .sort((a, b) => b.gain - a.gain)
    .slice(0, limit)
    .map(({ before: _b, after: _a, scoreBefore: _sb, scoreAfter: _sa, ...s }) => s);
}

/** "Next buys" for the sample wardrobe: improvements grouped by piece across these outfits and
 *  ranked by the total they add, with the same variety rules as the backend (improve.group). */
export function localNextBuys(
  outfits: { items: Item[]; style: string; source: BuyExample["source"]; name: string | null }[],
  wardrobe: Item[],
  wear: Wear = "both",
  limit = 30,
): NextBuy[] {
  const groups = new Map<string, { s: Found; uses: { outfit: (typeof outfits)[number]; s: Found }[] }>();
  for (const outfit of outfits) {
    const best = new Map<string, Found>();
    for (const s of improvementsFor(outfit.items, outfit.style, wardrobe, wear)) {
      if (!best.has(s.key) || s.gain > best.get(s.key)!.gain) best.set(s.key, s);
    }
    for (const s of best.values()) {
      const g = groups.get(s.key) ?? { s, uses: [] };
      g.uses.push({ outfit, s });
      if (s.gain > g.s.gain) g.s = s;
      groups.set(s.key, g);
    }
  }
  const ranked = [...groups.values()]
    .map(({ s, uses }) => {
      const total = uses.reduce((sum, u) => sum + u.s.gain, 0);
      uses.sort((a, b) => b.s.gain - a.s.gain);
      return {
        typical: uses.reduce((sum, u) => sum + primacy(s.spec.garment, u.outfit.style), 0) / uses.length,
        buy: {
          key: s.key, spec: s.spec, query: s.query, title: s.title,
          value: total + (VERSATILE.has(s.spec.color_name) ? 1 : 0),
          outfits: uses.length, total_gain: total, avg_gain: Math.round((total / uses.length) * 10) / 10,
          best_gain: uses[0].s.gain, reason: s.reason,
          examples: uses.slice(0, 3).map((u) => ({
            cloth_ids: u.outfit.items.map((i) => i.id), style: u.outfit.style, source: u.outfit.source, name: u.outfit.name,
            replaces: u.s.replaces?.id ?? null, gain: u.s.gain, before: u.s.scoreBefore, after: u.s.scoreAfter,
          })),
        } satisfies NextBuy,
      };
    })
    .sort((a, b) => b.buy.value - a.buy.value || b.typical - a.typical);
  const chosen: NextBuy[] = [];
  const garments = new Set<string>(), looks = new Set<string>(), perCategory = new Map<string, number>();
  for (const { buy } of ranked) {
    const g = `${buy.spec.category}|${buy.spec.garment}`, look = `${buy.spec.category}|${buy.spec.color_name}|${buy.spec.texture}`;
    if (garments.has(g) || looks.has(look) || (perCategory.get(buy.spec.category) ?? 0) >= 3) continue;
    garments.add(g);
    looks.add(look);
    perCategory.set(buy.spec.category, (perCategory.get(buy.spec.category) ?? 0) + 1);
    chosen.push(buy);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

const plural = (garment: string) => (garment.endsWith("s") && !garment.endsWith("dress") ? garment : garment + (/(ss|sh)$/.test(garment) ? "es" : "s"));

/** One sentence on why it helps, from whichever part of the score improved most. */
function reasonFor(s: Suggestion, items: Item[], before: Breakdown, after: Breakdown, style: string) {
  const others = items.filter((i) => i !== s.replaces);
  const delta = {
    color: 0.35 * (after.color - before.color),
    texture: 0.2 * (after.texture - before.texture),
    semantic: 0.45 * (after.semantic - before.semantic),
  };
  const main = (Object.keys(delta) as (keyof typeof delta)[]).reduce((a, b) => (delta[b] > delta[a] ? b : a));
  const colour = s.spec.color_name;
  if (main === "color") {
    if (colorFamily(s.spec.color) === "neutral" || ["Navy", "Beige", "Camel", "Brown", "Cream", "Khaki"].includes(colour))
      return `${colour} is a neutral, so it calms the palette and lets the rest of the outfit work together.`;
    const partner = others.find((o) => colorRelation(o.color, s.spec.color) !== "clash");
    if (partner) {
      const rel = colorRelation(partner.color, s.spec.color);
      const name = colorName(partner.color).toLowerCase();
      if (rel === "analogous") return `${colour} sits close to your ${name} on the colour wheel, so the look feels cohesive.`;
      if (rel === "complementary") return `${colour} is the opposite of your ${name} on the colour wheel, which balances it.`;
    }
    return `${colour} sits more easily with the other colours in this outfit.`;
  }
  if (main === "texture") {
    const partner = [...others].sort((a, b) => textureScore(b.texture, s.spec.texture) - textureScore(a.texture, s.spec.texture))[0];
    return partner && partner.texture !== s.spec.texture
      ? `${capital(s.spec.texture)} pairs better with your ${partner.texture} ${ROLE[partner.category]}.`
      : `A ${s.spec.texture} ${s.spec.garment} gives the outfit a better mix of fabrics.`;
  }
  const lower = style.toLowerCase();
  if (s.replaces?.garment && s.replaces.garment !== s.spec.garment)
    return `${capital(plural(s.spec.garment))} suit ${lower} better than ${plural(s.replaces.garment)}.`;
  return s.replaces
    ? `It reads more clearly as ${lower} than the ${s.replaces.name.toLowerCase()}.`
    : `A ${s.spec.garment} reads clearly as ${lower} and pulls the outfit together.`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Backend suggestions and feedback ─────────────────────────────────────────
type Call = <T = unknown>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
type ServerSuggestion = Omit<Suggestion, "replaces"> & { replaces: string | null };

/** The backend's suggestions for an outfit (signed in): real scores, persona-ranked. */
export async function fetchSuggestions(call: Call, wid: string, items: Item[], style: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const r = await call<{ suggestions: ServerSuggestion[] }>(
    `/wardrobes/${wid}/improve`,
    "POST",
    { cloth_ids: items.map((i) => i.id), style },
    signal,
  );
  return r.suggestions.map((s) => ({ ...s, replaces: items.find((i) => i.id === s.replaces) }));
}

export type SuggestionAction = "shown" | "saved" | "unsaved" | "dismissed" | "owned" | "clicked" | "bought";
export type SuggestionSource = "outfit" | "lab" | "next-buys";
type Reported = { key: string; spec: Spec; gain?: number };
const shownThisSession = new Set<string>();

/** Records what the user did with suggestions: the history the persona learns from.
 *  Best effort: feedback never gets in the way. "shown" is sent once per piece and place per page load. */
export function recordSuggestions(
  call: Call,
  action: SuggestionAction,
  list: Reported[],
  where: { source: SuggestionSource; wid: string | null; items?: Item[] },
) {
  const ids = (where.items ?? []).map((i) => i.id);
  const events = list
    .map((s, position) => ({ s, position }))
    .filter(({ s }) => {
      if (action !== "shown") return true;
      const id = `${where.source}|${ids.join(",")}|${s.key}`;
      if (shownThisSession.has(id)) return false;
      shownThisSession.add(id);
      return true;
    })
    .map(({ s, position }) => ({
      action,
      key: s.key,
      spec: s.spec,
      source: where.source,
      wardrobe_id: where.wid,
      gain: s.gain ?? null,
      position: Math.min(position, 50),
      cloth_ids: ids,
    }));
  // The API takes up to 50 events at a time.
  for (let i = 0; i < events.length; i += 50) call("/me/suggestion-events", "POST", { events: events.slice(i, i + 50) }).catch(() => {});
}
