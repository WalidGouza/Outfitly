// Colour names and match-score helpers shared by every screen.
// The name table mirrors backend/app/attributes.py so a piece's detected name
// ("Navy chinos") and its swatch label ("Navy") always agree.

const COLOR_NAMES: Record<string, [number, number, number]> = {
  Black: [25, 25, 25], Charcoal: [60, 64, 70], Grey: [128, 128, 128],
  "Light grey": [195, 195, 195], White: [245, 245, 245], Cream: [240, 230, 205],
  Beige: [214, 196, 163], Camel: [193, 154, 107], Brown: [110, 72, 45],
  Burgundy: [120, 25, 40], Red: [200, 35, 45], Pink: [238, 150, 170],
  Orange: [232, 120, 45], Mustard: [205, 165, 45], Yellow: [240, 215, 70],
  Olive: [107, 107, 52], Khaki: [170, 160, 115], Sage: [150, 170, 140],
  Green: [45, 135, 70], Teal: [20, 125, 125], "Light blue": [155, 190, 225],
  Blue: [45, 90, 190], Navy: [30, 40, 75], Purple: [110, 60, 140],
  Lavender: [190, 170, 220],
};

export function rgb(hex: string): [number, number, number] {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "808080";
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

const toHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The closest named colour, e.g. "#2e3a52" → "Navy". */
export function colorName(hex: string): string {
  const c = rgb(hex);
  let best = "Grey";
  let bestDistance = Infinity;
  for (const [name, value] of Object.entries(COLOR_NAMES)) {
    const d = distance(c, value);
    if (d < bestDistance) [best, bestDistance] = [name, d];
  }
  return best;
}

/**
 * Choices for "Main colour" after a photo is read: the detected colour first,
 * then the nearest other named colours so a near miss is one click away.
 */
export function colorChoices(hex: string, count = 5): { name: string; hex: string }[] {
  const c = rgb(hex);
  const first = { name: colorName(hex), hex: toHex(c) };
  const others = Object.entries(COLOR_NAMES)
    .filter(([name]) => name !== first.name)
    .sort((a, b) => distance(c, a[1]) - distance(c, b[1]))
    .slice(0, count - 1)
    .map(([name, value]) => ({ name, hex: toHex(value) }));
  return [first, ...others];
}

export const verdict = (pct: number) => (pct >= 90 ? "Excellent match" : pct >= 85 ? "Strong match" : "Good match");

/** Stroke dash for the score ring (r = 27). */
export const ringDash = (pct: number) => ((Math.max(0, Math.min(100, pct)) / 100) * 2 * Math.PI * 27).toFixed(1) + " 200";

// Sample-wardrobe scoring: a port of backend/app/matching.py with the default rules,
// so the demo shows the same kind of numbers as a real account.
const rules = {
  weights: { semantic: 0.45, color: 0.35, texture: 0.2 },
  neutralSaturation: 0.16, neutralValueLow: 0.2, analogous: 40, falloff: 180, tolerance: 35,
  neutral: 0.9, complementary: 0.9, triadic: 0.8, unmatched: 0.35,
  sameTexture: 0.85, unknownTexture: 0.6,
  pairs: { "cotton:denim": 0.95, "knit:denim": 0.9, "leather:denim": 0.9, "cotton:linen": 0.95 } as Record<string, number>,
};

function hsv(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h / 6) + 1) % 1, s: max ? d / max : 0, v: max };
}

export function colorScore(a: string, b: string, harmony = "balanced") {
  const x = hsv(a), y = hsv(b);
  if (Math.min(x.s, y.s) < rules.neutralSaturation || Math.min(x.v, y.v) < rules.neutralValueLow) return rules.neutral;
  const angle = Math.min(Math.abs(x.h - y.h), 1 - Math.abs(x.h - y.h)) * 360;
  const analogous = harmony === "contrast" ? -1 : rules.analogous;
  const tolerance = harmony === "tonal" ? -1 : rules.tolerance;
  if (angle <= analogous) return 1 - angle / rules.falloff;
  if (Math.abs(angle - 180) <= tolerance) return rules.complementary;
  if (Math.abs(angle - 120) <= tolerance) return rules.triadic;
  return rules.unmatched;
}

export function textureScore(a: string, b: string) {
  if (a === b) return rules.sameTexture;
  return rules.pairs[`${a}:${b}`] ?? rules.pairs[`${b}:${a}`] ?? rules.unknownTexture;
}

type Scorable = { color: string; texture: string; style: string };

export function scoreLook(items: Scorable[], style: string, harmony = "balanced") {
  const pairs = items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b] as const));
  // Without CLIP in the browser, "meaning" is how many pieces share the requested style.
  const semantic = 0.72 + 0.2 * (items.filter((i) => i.style === style).length / items.length);
  const color = pairs.reduce((sum, [a, b]) => sum + colorScore(a.color, b.color, harmony), 0) / pairs.length;
  const texture = pairs.reduce((sum, [a, b]) => sum + textureScore(a.texture, b.texture), 0) / pairs.length;
  const score = semantic * rules.weights.semantic + color * rules.weights.color + texture * rules.weights.texture;
  return {
    score: Math.round(score * 100),
    breakdown: { semantic: Math.round(semantic * 100), color: Math.round(color * 100), texture: Math.round(texture * 100) },
  };
}
