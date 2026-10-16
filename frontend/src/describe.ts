// Written descriptions for outfits (Outfit lab) and single pieces (piece page).
// Rule-based on purpose: they explain the same colour, fabric and style signals the match score
// uses, so the words never disagree with the numbers, cost nothing and appear instantly.
import { colorFamily, colorName, colorRelation, colorScore, textureScore, verdict } from "./colors";
import type { Breakdown, Category, Piece } from "./store";

const ROLE: Record<Category, string> = { jackets: "jacket", tops: "top", pants: "pants", shoes: "shoes" };
const ORDER: Category[] = ["jackets", "tops", "pants", "shoes"];

// Colours fashion treats as neutrals, even when the colour wheel calls them blue or brown.
const FASHION_NEUTRALS = new Set(["Black", "Charcoal", "Grey", "Light grey", "White", "Cream", "Beige", "Camel", "Brown", "Khaki", "Navy"]);
const isNeutral = (hex: string) => FASHION_NEUTRALS.has(colorName(hex)) || colorFamily(hex) === "neutral";

const FABRIC: Record<string, string> = {
  cotton: "Cotton is easy and breathable, comfortable from morning to evening.",
  denim: "Denim is sturdy and casual, and it gets better with wear.",
  knit: "A knit is soft and warm, and adds texture to an outfit.",
  leather: "Leather is polished and structured; it dresses an outfit up.",
  linen: "Linen is light and airy, made for warm days.",
  silk: "Silk is fluid and dressy, with a soft sheen.",
  other: "",
};
const FABRIC_ADJ: Record<string, string> = {
  cotton: "cotton", denim: "denim", knit: "knit", leather: "leather", linen: "linen", silk: "silk", other: "",
};

const list = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);
const sorted = (items: Piece[]) => [...items].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
const pairs = <T,>(items: T[]) => items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b] as const));

export type OutfitDescription = { headline: string; notes: string[]; tip: string | null };

/** What an outfit has going for it, what holds it back, and one concrete swap to try. */
export function describeOutfit(items: Piece[], score: number, breakdown: Breakdown, style: string, wardrobe: Piece[] = []): OutfitDescription {
  const looks = sorted(items);
  const headline =
    score >= 90 ? `${verdict(score)}. This one just works.`
    : score >= 85 ? `${verdict(score)}. A strong combination.`
    : score >= 75 ? "Good, with room to sharpen."
    : "It works, but something is pulling against it.";

  const notes = [colourNote(looks), fabricNote(looks), styleNote(breakdown.semantic, style)].filter(Boolean) as string[];
  return { headline, notes, tip: swapTip(looks, wardrobe, style) };
}

function colourNote(items: Piece[]) {
  const names = items.map((p) => colorName(p.color));
  const accents = items.filter((p) => !isNeutral(p.color));
  if (!accents.length) return `An all-neutral palette (${list([...new Set(names)])}): calm, easy to wear, hard to get wrong.`;
  if (accents.length === 1)
    return `${colorName(accents[0].color)} is the one accent, and the neutrals around it let it stand out without competing.`;
  const relations = pairs(accents).map(([a, b]) => ({ a, b, r: colorRelation(a.color, b.color) }));
  const clash = relations.find((x) => x.r === "clash");
  if (clash)
    return `${colorName(clash.a.color)} and ${colorName(clash.b.color)} compete for attention; one of them as a neutral would calm the look down.`;
  const r = relations[0];
  const [a, b] = [colorName(r.a.color), colorName(r.b.color)];
  if (r.r === "analogous") return `${a} and ${b} sit close on the colour wheel, so the look feels cohesive.`;
  if (r.r === "complementary") return `${a} and ${b} are opposites on the colour wheel: bold, but balanced. Keep the rest quiet.`;
  if (r.r === "triadic") return `${a} and ${b} form a lively, balanced pairing.`;
  return `${a} and ${b} work together.`;
}

function fabricNote(items: Piece[]) {
  const fabrics = [...new Set(items.map((p) => p.texture).filter((t) => t !== "other"))];
  if (fabrics.length <= 1)
    return fabrics.length ? `All ${fabrics[0]}: comfortable, though a second texture would add depth.` : null;
  const best = pairs(items).filter(([a, b]) => a.texture !== b.texture).sort((x, y) => textureScore(y[0].texture, y[1].texture) - textureScore(x[0].texture, x[1].texture))[0];
  const strong = best && textureScore(best[0].texture, best[1].texture) >= 0.9;
  return strong
    ? `${capital(best[0].texture)} with ${best[1].texture} is a classic pairing, and the mix of ${list(fabrics)} keeps it interesting.`
    : `A mix of ${list(fabrics)} gives the outfit some texture.`;
}

function styleNote(semantic: number, style: string) {
  const s = style.toLowerCase();
  if (semantic >= 85) return `It reads clearly as ${s}.`;
  if (semantic >= 75) return `Mostly ${s}, with a piece or two leaning elsewhere.`;
  return `It doesn't strongly read as ${s}; pieces with a clearer ${s} character would help.`;
}

/** The single swap from the wardrobe that most improves colour or fabric harmony without
 *  leaving the outfit's style (a jeans-for-chinos swap shouldn't be offered on a smart look). */
function swapTip(items: Piece[], wardrobe: Piece[], style: string) {
  const parts = (pieces: Piece[]) => {
    const ps = pairs(pieces);
    return {
      colour: ps.reduce((sum, [a, b]) => sum + colorScore(a.color, b.color), 0) / ps.length,
      fabric: ps.reduce((sum, [a, b]) => sum + textureScore(a.texture, b.texture), 0) / ps.length,
    };
  };
  const now = parts(items);
  let best: { from: Piece; to: Piece; gain: number; why: string } | null = null;
  for (const from of items)
    for (const to of wardrobe) {
      if (to.category !== from.category || items.some((i) => i.id === to.id)) continue;
      if (to.style !== style && from.style === style) continue;
      const next = parts(items.map((i) => (i.id === from.id ? to : i)));
      const colourGain = 0.35 * (next.colour - now.colour);
      const fabricGain = 0.2 * (next.fabric - now.fabric);
      const gain = colourGain + fabricGain;
      // Worth suggesting only when it moves the score by about 2 points or more.
      if (gain >= 0.02 && (!best || gain > best.gain))
        best = { from, to, gain, why: colourGain >= fabricGain ? "for a smoother palette" : "for a better mix of fabrics" };
    }
  if (!best) return null;
  return `Try your ${best.to.name.toLowerCase()} instead of the ${best.from.name.toLowerCase()} ${best.why}.`;
}

export type PieceDescription = { summary: string; paragraphs: string[]; goesWith: Piece[] };

/** A short description of one piece and the pieces in this wardrobe it pairs best with. */
export function describePiece(piece: Piece, wardrobe: Piece[]): PieceDescription {
  const colour = colorName(piece.color);
  const kind = piece.garment ?? ROLE[piece.category];
  const fabric = FABRIC_ADJ[piece.texture];
  const summary = `${colour}${fabric ? ` ${fabric}` : ""} ${kind}, ${piece.style.toLowerCase()} style.`;

  const family = colorFamily(piece.color);
  const colourText = isNeutral(piece.color)
    ? `${colour} is a neutral, so it works with almost everything in your wardrobe.`
    : family === "warm"
      ? `${colour} is a warm accent: it shines next to neutrals and other earthy tones.`
      : `${colour} is a cool accent: pair it with neutrals, or with blues and greens for a tonal look.`;

  const tags = weatherTags(piece);
  const weatherText = tags.warm
    ? "It keeps you warm, so it's best on cool or cold days."
    : tags.light
      ? "It's light, so it's best on warm days."
      : "It works most of the year.";

  const goesWith = ORDER.filter((c) => c !== piece.category)
    .map((c) =>
      wardrobe
        .filter((p) => p.category === c)
        .map((p) => ({ p, s: 0.35 * colorScore(piece.color, p.color) + 0.2 * textureScore(piece.texture, p.texture) }))
        .sort((a, b) => b.s - a.s)[0]?.p,
    )
    .filter(Boolean) as Piece[];

  return { summary: capital(summary), paragraphs: [colourText, FABRIC[piece.texture], weatherText].filter(Boolean), goesWith };
}

// Mirrors the warmth signals in backend/app/weather.py (type first, then name and fabric).
function weatherTags(p: Piece) {
  const g = p.garment ?? "";
  const n = p.name.toLowerCase();
  const warm = ["sweater", "hoodie", "sweatshirt", "coat", "puffer jacket", "cardigan", "boots"].includes(g) || p.texture === "knit" || /wool|merino|cashmere|fleece|coat|parka|puffer|boot/.test(n);
  const light = ["t-shirt", "tank top", "polo shirt", "shorts", "sandals", "skirt"].includes(g) || ["linen", "silk"].includes(p.texture) || /linen|tee|t-shirt|shorts|sandal/.test(n);
  return { warm, light: light && !warm };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
