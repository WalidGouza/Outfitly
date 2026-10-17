// Suggestions: pieces the user doesn't own that would raise an outfit's score.
//
// For each slot of the outfit (and an extra layer when there is none) every garment type that
// suits the outfit's style is tried in every wearable colour, in its natural fabric, and scored
// with the same colour / fabric / style rules as the rest of the app (colors.ts scoreLook).
// Only clear improvements are kept, best first, one per slot.
//
// v1 is text only. Each suggestion also carries a structured `spec` and a search `query`
// ("white leather sneakers"), which is what product matching will plug into later.
import { colorFamily, colorName, colorRelation, scoreLook, textureScore } from "./colors";

export type Category = "tops" | "pants" | "dresses" | "shoes" | "jackets";
export type Wear = "women" | "men" | "both";
type Item = { id: string; name: string; category: Category; color: string; texture: string; style: string; garment?: string | null };

export type Suggestion = {
  /** What to look for; later matched against real products. */
  spec: { category: Category; garment: string; color: string; colorName: string; texture: string; style: string };
  /** Search phrase for product matching, e.g. "white leather sneakers". */
  query: string;
  /** The owned piece it would replace; undefined when it adds a layer. */
  replaces?: Item;
  /** Estimated score points gained (colour, fabric and style rules; photos aren't known yet). */
  gain: number;
  title: string;
  reason: string;
};

// Colours people actually buy clothes in, with the swatch values of the named-colour table.
const PALETTE: [string, string][] = [
  ["Black", "#191919"], ["Charcoal", "#3C4046"], ["Grey", "#808080"], ["Light grey", "#C3C3C3"],
  ["White", "#F5F5F5"], ["Cream", "#F0E6CD"], ["Beige", "#D6C4A3"], ["Camel", "#C19A6B"],
  ["Brown", "#6E482D"], ["Burgundy", "#781928"], ["Olive", "#6B6B34"], ["Khaki", "#AAA073"],
  ["Sage", "#96AA8C"], ["Navy", "#1E284B"], ["Light blue", "#9BBEE1"], ["Blue", "#2D5ABE"],
  ["Red", "#C8232D"], ["Pink", "#EE96AA"],
];

// The fabric each type usually comes in (first is the default) and the styles it suits.
const TYPES: Record<string, { category: Category; fabric: string; styles: string[]; women?: boolean }> = {
  "t-shirt": { category: "tops", fabric: "cotton", styles: ["Everyday", "Minimal", "Streetwear"] },
  shirt: { category: "tops", fabric: "cotton", styles: ["Smart casual", "Minimal", "Everyday", "Evening"] },
  blouse: { category: "tops", fabric: "silk", styles: ["Smart casual", "Evening", "Minimal"], women: true },
  "polo shirt": { category: "tops", fabric: "cotton", styles: ["Everyday", "Smart casual"] },
  sweater: { category: "tops", fabric: "knit", styles: ["Everyday", "Minimal", "Smart casual"] },
  hoodie: { category: "tops", fabric: "cotton", styles: ["Streetwear", "Everyday"] },
  sweatshirt: { category: "tops", fabric: "cotton", styles: ["Streetwear", "Everyday"] },
  "tank top": { category: "tops", fabric: "cotton", styles: ["Everyday", "Streetwear"] },
  "crop top": { category: "tops", fabric: "cotton", styles: ["Streetwear", "Everyday"], women: true },
  camisole: { category: "tops", fabric: "silk", styles: ["Evening", "Minimal"], women: true },
  bodysuit: { category: "tops", fabric: "cotton", styles: ["Evening", "Minimal", "Smart casual"], women: true },
  "corset top": { category: "tops", fabric: "silk", styles: ["Evening"], women: true },
  jeans: { category: "pants", fabric: "denim", styles: ["Everyday", "Streetwear", "Minimal"] },
  trousers: { category: "pants", fabric: "other", styles: ["Smart casual", "Minimal", "Evening"] },
  chinos: { category: "pants", fabric: "cotton", styles: ["Smart casual", "Everyday", "Minimal"] },
  shorts: { category: "pants", fabric: "cotton", styles: ["Everyday", "Streetwear"] },
  skirt: { category: "pants", fabric: "cotton", styles: ["Smart casual", "Minimal", "Everyday"], women: true },
  "mini skirt": { category: "pants", fabric: "leather", styles: ["Evening", "Streetwear"], women: true },
  "wide-leg trousers": { category: "pants", fabric: "linen", styles: ["Minimal", "Smart casual", "Evening"] },
  culottes: { category: "pants", fabric: "linen", styles: ["Minimal", "Smart casual"], women: true },
  joggers: { category: "pants", fabric: "cotton", styles: ["Streetwear", "Everyday"] },
  "mini dress": { category: "dresses", fabric: "silk", styles: ["Evening", "Everyday"], women: true },
  "midi dress": { category: "dresses", fabric: "linen", styles: ["Smart casual", "Minimal", "Evening", "Everyday"], women: true },
  "maxi dress": { category: "dresses", fabric: "linen", styles: ["Evening", "Everyday"], women: true },
  "shirt dress": { category: "dresses", fabric: "cotton", styles: ["Smart casual", "Everyday", "Minimal"], women: true },
  jumpsuit: { category: "dresses", fabric: "linen", styles: ["Minimal", "Evening", "Smart casual"], women: true },
  sneakers: { category: "shoes", fabric: "leather", styles: ["Everyday", "Streetwear", "Minimal"] },
  boots: { category: "shoes", fabric: "leather", styles: ["Everyday", "Streetwear"] },
  loafers: { category: "shoes", fabric: "leather", styles: ["Smart casual", "Minimal"] },
  sandals: { category: "shoes", fabric: "leather", styles: ["Everyday"] },
  heels: { category: "shoes", fabric: "leather", styles: ["Evening", "Smart casual"], women: true },
  flats: { category: "shoes", fabric: "leather", styles: ["Minimal", "Smart casual", "Everyday"] },
  "ankle boots": { category: "shoes", fabric: "leather", styles: ["Smart casual", "Everyday", "Minimal"] },
  "dress shoes": { category: "shoes", fabric: "leather", styles: ["Evening", "Smart casual"] },
  jacket: { category: "jackets", fabric: "denim", styles: ["Everyday", "Streetwear"] },
  coat: { category: "jackets", fabric: "other", styles: ["Smart casual", "Minimal", "Evening"] },
  blazer: { category: "jackets", fabric: "other", styles: ["Smart casual", "Evening", "Minimal"] },
  cardigan: { category: "jackets", fabric: "knit", styles: ["Everyday", "Minimal"] },
  "puffer jacket": { category: "jackets", fabric: "other", styles: ["Streetwear", "Everyday"] },
  "trench coat": { category: "jackets", fabric: "cotton", styles: ["Smart casual", "Minimal"] },
  "cropped jacket": { category: "jackets", fabric: "denim", styles: ["Streetwear", "Everyday"], women: true },
};

const MIN_GAIN = 2; // points; smaller differences aren't worth buying something for
// Near-ties go to colours that work with almost anything: they're the more useful buy.
const VERSATILE = new Set(["Black", "Charcoal", "Grey", "White", "Cream", "Beige", "Camel", "Brown", "Navy"]);
const preference = (gain: number, colour: string) => gain + (VERSATILE.has(colour) ? 1 : 0);
const ROLE: Record<Category, string> = { tops: "top", pants: "bottoms", dresses: "dress", shoes: "shoes", jackets: "layer" };

// Types that already say their fabric ("jeans" are denim) don't repeat it.
const IMPLIED: Record<string, string> = { jeans: "denim", sweater: "knit", cardigan: "knit" };
const describe = (colour: string, texture: string, garment: string) =>
  `${colour} ${texture !== "other" && IMPLIED[garment] !== texture ? `${texture} ` : ""}${garment}`.toLowerCase();

/** Up to `limit` suggestions for this outfit, judged as `style`, best first. */
export function suggestFor(items: Item[], style: string, wardrobe: Item[], wear: Wear = "both", limit = 3): Suggestion[] {
  if (items.length < 2) return [];
  const before = scoreLook(items, style);
  const owned = new Set(wardrobe.map((p) => `${p.category}|${p.garment ?? ""}|${colorName(p.color)}`));
  const slots: { category: Category; replaces?: Item }[] = items.map((p) => ({ category: p.category, replaces: p }));
  if (!items.some((p) => p.category === "jackets")) slots.push({ category: "jackets" });

  const best: Suggestion[] = [];
  for (const slot of slots) {
    let top: (Suggestion & { after: ReturnType<typeof scoreLook> }) | null = null;
    for (const [garment, t] of Object.entries(TYPES)) {
      if (t.category !== slot.category || !t.styles.includes(style) || (t.women && wear === "men")) continue;
      for (const [name, hex] of PALETTE) {
        if (owned.has(`${t.category}|${garment}|${name}`)) continue;
        if (slot.replaces && slot.replaces.garment === garment && colorName(slot.replaces.color) === name) continue;
        const piece: Item = { id: "suggested", name: `${name} ${garment}`, category: t.category, color: hex, texture: t.fabric, style, garment };
        const next = slot.replaces ? items.map((i) => (i === slot.replaces ? piece : i)) : [...items, piece];
        const after = scoreLook(next, style);
        const gain = after.score - before.score;
        if (gain >= MIN_GAIN && (!top || preference(gain, name) > preference(top.gain, top.spec.colorName))) {
          const query = describe(name, t.fabric, garment);
          top = {
            spec: { category: t.category, garment, color: hex, colorName: name, texture: t.fabric, style },
            query,
            replaces: slot.replaces,
            gain,
            title: query.charAt(0).toUpperCase() + query.slice(1),
            reason: "",
            after,
          };
        }
      }
    }
    if (top) {
      const { after, ...suggestion } = top;
      suggestion.reason = reasonFor(suggestion, items, before.breakdown, after.breakdown, style);
      best.push(suggestion);
    }
  }
  return best.sort((a, b) => b.gain - a.gain).slice(0, limit);
}

type Breakdown = { semantic: number; color: number; texture: number };

/** One sentence on why it helps, from whichever part of the score improved most. */
function reasonFor(s: Suggestion, items: Item[], before: Breakdown, after: Breakdown, style: string) {
  const others = items.filter((i) => i !== s.replaces);
  const delta = {
    color: 0.35 * (after.color - before.color),
    texture: 0.2 * (after.texture - before.texture),
    semantic: 0.45 * (after.semantic - before.semantic),
  };
  const main = (Object.keys(delta) as (keyof typeof delta)[]).reduce((a, b) => (delta[b] > delta[a] ? b : a));
  const colour = s.spec.colorName;
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
  return s.replaces
    ? `It reads more clearly as ${style.toLowerCase()} than the ${s.replaces.name.toLowerCase()}.`
    : `It reads clearly as ${style.toLowerCase()} and pulls the outfit together.`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
