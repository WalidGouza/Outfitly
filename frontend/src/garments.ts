// What each garment type says about style, and how two garments go together.
// Mirrors backend/app/garments.py (see there for the reasoning); the sample wardrobe and the
// in-browser estimates score with it, so they agree with the backend.
import type { Category } from "./store";

export type GarmentType = { category: Category; fabric: string; styles: string[]; women?: boolean };
const T = (category: Category, fabric: string, styles: string[], women = false): GarmentType => ({ category, fabric, styles, women });

/** The fabric each type usually comes in and the styles it suits, most typical first. */
export const TYPES: Record<string, GarmentType> = {
  "t-shirt": T("tops", "cotton", ["Everyday", "Minimal", "Streetwear"]),
  shirt: T("tops", "cotton", ["Smart casual", "Minimal", "Everyday", "Evening"]),
  blouse: T("tops", "silk", ["Smart casual", "Evening", "Minimal"], true),
  "polo shirt": T("tops", "cotton", ["Everyday", "Smart casual"]),
  sweater: T("tops", "knit", ["Everyday", "Minimal", "Smart casual"]),
  hoodie: T("tops", "cotton", ["Streetwear", "Everyday"]),
  sweatshirt: T("tops", "cotton", ["Streetwear", "Everyday"]),
  "tank top": T("tops", "cotton", ["Everyday", "Streetwear"]),
  "crop top": T("tops", "cotton", ["Streetwear", "Everyday"], true),
  camisole: T("tops", "silk", ["Evening", "Minimal"], true),
  bodysuit: T("tops", "cotton", ["Evening", "Minimal", "Smart casual"], true),
  "corset top": T("tops", "silk", ["Evening"], true),
  jeans: T("pants", "denim", ["Everyday", "Streetwear", "Minimal"]),
  trousers: T("pants", "other", ["Smart casual", "Minimal", "Evening"]),
  chinos: T("pants", "cotton", ["Smart casual", "Everyday", "Minimal"]),
  shorts: T("pants", "cotton", ["Everyday", "Streetwear"]),
  skirt: T("pants", "cotton", ["Smart casual", "Minimal", "Everyday"], true),
  "mini skirt": T("pants", "leather", ["Evening", "Streetwear"], true),
  "wide-leg trousers": T("pants", "linen", ["Minimal", "Smart casual", "Evening"]),
  culottes: T("pants", "linen", ["Minimal", "Smart casual"], true),
  joggers: T("pants", "cotton", ["Streetwear", "Everyday"]),
  leggings: T("pants", "other", ["Everyday", "Streetwear"], true),
  "mini dress": T("dresses", "silk", ["Evening", "Everyday"], true),
  "midi dress": T("dresses", "linen", ["Smart casual", "Minimal", "Evening", "Everyday"], true),
  "maxi dress": T("dresses", "linen", ["Evening", "Everyday"], true),
  "shirt dress": T("dresses", "cotton", ["Smart casual", "Everyday", "Minimal"], true),
  jumpsuit: T("dresses", "linen", ["Minimal", "Evening", "Smart casual"], true),
  sneakers: T("shoes", "leather", ["Everyday", "Streetwear", "Minimal"]),
  boots: T("shoes", "leather", ["Everyday", "Streetwear"]),
  loafers: T("shoes", "leather", ["Smart casual", "Minimal"]),
  sandals: T("shoes", "leather", ["Everyday"]),
  heels: T("shoes", "leather", ["Evening", "Smart casual"], true),
  flats: T("shoes", "leather", ["Minimal", "Smart casual", "Everyday"]),
  "ballet flats": T("shoes", "leather", ["Minimal", "Everyday", "Smart casual"], true),
  mules: T("shoes", "leather", ["Minimal", "Smart casual", "Evening"], true),
  "ankle boots": T("shoes", "leather", ["Smart casual", "Everyday", "Minimal"]),
  "dress shoes": T("shoes", "leather", ["Evening", "Smart casual"]),
  jacket: T("jackets", "denim", ["Everyday", "Streetwear"]),
  coat: T("jackets", "other", ["Smart casual", "Minimal", "Evening"]),
  blazer: T("jackets", "other", ["Smart casual", "Evening", "Minimal"]),
  cardigan: T("jackets", "knit", ["Everyday", "Minimal"]),
  "puffer jacket": T("jackets", "other", ["Streetwear", "Everyday"]),
  "trench coat": T("jackets", "cotton", ["Smart casual", "Minimal"]),
  "cropped jacket": T("jackets", "denim", ["Streetwear", "Everyday"], true),
};

const RANK_WEIGHTS = [1, 0.8, 0.65, 0.5];
const CLASSIC: [string, string, number][] = [
  ["blazer", "jeans", 0.85], ["blazer", "t-shirt", 0.8], ["blazer", "sneakers", 0.7], ["coat", "sneakers", 0.7],
  ["trench coat", "jeans", 0.85], ["shirt", "jeans", 0.85], ["sweater", "trousers", 0.8], ["t-shirt", "trousers", 0.75],
  ["midi dress", "sneakers", 0.75], ["shirt dress", "sneakers", 0.75], ["jacket", "midi dress", 0.75], ["hoodie", "coat", 0.7],
  ["loafers", "jeans", 0.8], ["ankle boots", "jeans", 0.85], ["ankle boots", "midi dress", 0.8],
];
const classic = (a: string, b: string) => CLASSIC.find(([x, y]) => (x === a && y === b) || (x === b && y === a))?.[2];

type Affinity = (target: string, style: string) => number;
const profile = (garment?: string | null) =>
  (TYPES[garment ?? ""]?.styles ?? []).map((s, i) => [s, RANK_WEIGHTS[i]] as const);

/** How typical a garment is of a style (0-1); null for an unknown type. */
export function garmentFit(garment: string | null | undefined, target: string, affinity: Affinity) {
  const styles = profile(garment);
  return styles.length ? Math.max(...styles.map(([s, w]) => w * affinity(target, s))) : null;
}

/** How well two garments go together (0-1); null when either type is unknown. */
export function garmentPair(a: string | null | undefined, b: string | null | undefined, affinity: Affinity) {
  const pa = profile(a), pb = profile(b);
  if (!pa.length || !pb.length) return null;
  return classic(a!, b!) ?? Math.max(...pa.flatMap(([sa, wa]) => pb.map(([sb, wb]) => wa * wb * affinity(sa, sb))));
}
