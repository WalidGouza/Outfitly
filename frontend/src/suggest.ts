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
  /** Shown to learn the user's taste (app/explore.py), not because it improves an outfit. */
  explore?: boolean;
};
/** A new piece in a suggested outfit, and the owned piece it takes the place of (none: a layer). */
export type LookPiece = { key: string; spec: Spec; query: string; title: string; replaces: string | null };
/** A whole outfit to suggest (app/improve.py looks): one of the user's outfits with its best swap
 *  in ("improved"), or taken further with a second new piece ("new"). */
export type SuggestedLook = {
  key: string;
  kind: "improved" | "new";
  style: string;
  source: BuyExample["source"];
  name: string | null;
  /** The owned pieces it keeps. */
  cloth_ids: string[];
  pieces: LookPiece[];
  before: number;
  after: number;
  gain: number;
  reason: string;
};
export type NextBuysResult = {
  suggestions: NextBuy[];
  /** Whole outfits to swipe on, mixed into the deck. */
  looks?: SuggestedLook[];
  /** Pieces to learn the user's taste from, mixed into the deck. */
  explore?: NextBuy[];
  considered: number;
  complete: boolean;
  estimated: boolean;
};
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

export type SuggestionAction = "look_saved" | "look_unsaved" | "look_dismissed" | "look_owned" | "shown" | "saved" | "unsaved" | "dismissed" | "owned" | "clicked" | "bought";
export type SuggestionSource = "outfit" | "lab" | "next-buys";
type Reported = { key: string; spec: Spec; gain?: number; explore?: boolean; look?: string };
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
      explore: !!s.explore,
      look: s.look ?? null,
    }));
  // The API takes up to 50 events at a time.
  for (let i = 0; i < events.length; i += 50) call("/me/suggestion-events", "POST", { events: events.slice(i, i + 50) }).catch(() => {});
}

// ── Exploration (the sample wardrobe's version of app/explore.py) ────────────
const EXPLORE_COUNT = 4;

/** A small seeded random generator, so the picks hold still for the day. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pieces to learn the user's taste from: styles they wear little, colours they don't own, one
 *  per style, category and colour. Without reactions to go on, everything counts as unknown. */
export function localExplore(wardrobe: Item[], wear: Wear, exclude: Set<string>, seed: string, styles: string[]): NextBuy[] {
  const random = seeded(seed);
  const counts = new Map<string, number>();
  for (const p of wardrobe) counts.set(p.style, (counts.get(p.style) ?? 0) + 1);
  const owned = new Set(wardrobe.map((p) => colorName(p.color)));
  const options: { score: number; key: string; garment: string; colour: string; hex: string; style: string; novelty: number; newColour: boolean }[] = [];
  for (const style of styles) {
    const novelty = 1 - Math.min(1, (2 * (counts.get(style) ?? 0)) / Math.max(1, wardrobe.length));
    for (const [garment, t] of Object.entries(TYPES)) {
      if (!t.styles.includes(style) || (t.women && wear === "men")) continue;
      for (const [colour, hex] of PALETTE) {
        const key = `${t.category}|${garment}|${colour}`;
        if (exclude.has(key)) continue;
        const newColour = !owned.has(colour);
        options.push({ score: 0.45 * novelty + 0.2 * (newColour ? 1 : 0) + 0.35 + 0.35 * random(), key, garment, colour, hex, style, novelty, newColour });
      }
    }
  }
  options.sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  const picks: NextBuy[] = [];
  for (const o of options) {
    const t = TYPES[o.garment];
    const marks = [`s|${o.style}`, `c|${t.category}`, `k|${o.colour}`];
    if (marks.some((m) => used.has(m))) continue;
    marks.forEach((m) => used.add(m));
    const query = describe(o.colour, t.fabric, o.garment);
    picks.push({
      key: o.key,
      spec: { category: t.category, garment: o.garment, color: o.hex, color_name: o.colour, texture: t.fabric, style: o.style },
      query,
      title: query.charAt(0).toUpperCase() + query.slice(1),
      value: 0, outfits: 0, total_gain: 0, avg_gain: 0, best_gain: 0,
      reason: o.novelty >= 0.6 ? `More ${o.style.toLowerCase()} than what you usually wear.` : o.newColour ? `${o.colour} isn’t in your wardrobe yet.` : `A different take on ${o.style.toLowerCase()}.`,
      examples: [],
      explore: true,
    });
    if (picks.length === EXPLORE_COUNT) break;
  }
  return picks;
}

/** The deck's order: `base` as it is, with one of `extra` after every `every` cards (the rest at the end). */
export function interleave<T>(base: T[], extra: T[], every: number): T[] {
  const out: T[] = [];
  let j = 0;
  base.forEach((b, i) => {
    out.push(b);
    if ((i + 1) % every === 0 && j < extra.length) out.push(extra[j++]);
  });
  return [...out, ...extra.slice(j)];
}

// ── Whole outfits (the sample wardrobe's version of improve.looks) ───────────
const FIRST = "suggested-1";

export const lookKey = (clothIds: string[], pieces: { key: string }[]) =>
  `look|${[...clothIds].sort().join(",")}|${pieces.map((p) => p.key).sort().join(",")}`;

function asLook(kind: SuggestedLook["kind"], outfit: { items: Item[]; style: string; source: BuyExample["source"]; name: string | null }, steps: Found[]): SuggestedLook {
  const replaced = new Set(steps.map((s) => s.replaces?.id).filter(Boolean));
  const kept = outfit.items.map((i) => i.id).filter((id) => !replaced.has(id));
  const pieces = steps.map((s) => ({ key: s.key, spec: s.spec, query: s.query, title: s.title, replaces: s.replaces?.id ?? null }));
  const before = steps[0].scoreBefore;
  const after = steps[steps.length - 1].scoreAfter;
  return { key: lookKey(kept, pieces), kind, style: outfit.style, source: outfit.source, name: outfit.name, cloth_ids: kept, pieces, before, after, gain: after - before, reason: steps[0].reason };
}

/** Whole outfits to suggest: each outfit with its best swap in, and the best of them taken further
 *  with a second new piece. One per outfit and per new piece, so they read as different ideas. */
export function localLooks(
  outfits: { items: Item[]; style: string; source: BuyExample["source"]; name: string | null }[],
  wardrobe: Item[],
  wear: Wear = "both",
  improved = 4,
  news = 3,
): SuggestedLook[] {
  const best = outfits
    .map((outfit) => {
      const found = improvementsFor(outfit.items, outfit.style, wardrobe, wear);
      return { outfit, s: found.length ? found.reduce((a, b) => (preference(b) > preference(a) ? b : a)) : null };
    })
    .filter((x): x is { outfit: (typeof outfits)[number]; s: Found } => x.s !== null)
    .sort((a, b) => preference(b.s) - preference(a.s));

  const out: SuggestedLook[] = [];
  const seen = new Set<string>();
  const keys = new Set<string>();
  for (const { outfit, s } of best) {
    const sig = outfit.items.map((i) => i.id).sort().join();
    if (seen.has(sig) || keys.has(s.key)) continue;
    seen.add(sig);
    keys.add(s.key);
    out.push(asLook("improved", outfit, [s]));
    if (out.length === improved) break;
  }

  const further: { value: number; outfit: (typeof outfits)[number]; s: Found; t: Found }[] = [];
  for (const { outfit, s } of best) {
    const first: Item = { id: FIRST, name: s.title, category: s.spec.category, color: s.spec.color, texture: s.spec.texture, style: s.spec.style, garment: s.spec.garment };
    const withFirst = s.replaces ? outfit.items.map((i) => (i === s.replaces ? first : i)) : [...outfit.items, first];
    const second = improvementsFor(withFirst, outfit.style, wardrobe, wear).filter((t) => t.replaces?.id !== FIRST && t.key !== s.key);
    if (!second.length) continue;
    const t = second.reduce((a, b) => (preference(b) > preference(a) ? b : a));
    further.push({ value: preference(s) + preference(t), outfit, s, t });
  }
  further.sort((a, b) => b.value - a.value);
  seen.clear();
  keys.clear();
  let count = 0;
  for (const { outfit, s, t } of further) {
    const sig = outfit.items.map((i) => i.id).sort().join();
    if (seen.has(sig) || keys.has(s.key) || keys.has(t.key)) continue;
    seen.add(sig);
    keys.add(s.key).add(t.key);
    out.push(asLook("new", outfit, [s, t]));
    if (++count === news) break;
  }
  return out;
}
