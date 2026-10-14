import { useColorScheme } from "react-native";

// Neckline O identity (brand/logo/GUIDELINES.md): Wardrobe Ink, Collar Coral, Linen.
// Coral is a pocket square, not a suit: the logo, the selected piece, saved state and
// destructive confirmation only. Never coral text on linen (3.0:1).
export const brand = {
  ink: "#1E221D",
  coral: "#E8644A",
  linen: "#F6F2EA",
} as const;

export type Palette = {
  scheme: "light" | "dark";
  page: string;
  surface: string;
  soft: string;
  board: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  accent: string;
  accentSoft: string;
  ink: string;
  onInk: string;
  logoInk: string;
};

const light: Palette = {
  scheme: "light",
  page: brand.linen,
  surface: "#FFFFFF",
  soft: "#EDE7DC",
  board: "#E4DDD0",
  text: brand.ink,
  muted: "#62665E", // 5.2:1 on linen
  faint: "#7B7E75",
  border: "#E2DBCF",
  accent: brand.coral,
  accentSoft: "#FBE7E1",
  // Primary actions are ink, not coral.
  ink: brand.ink,
  onInk: brand.linen,
  logoInk: brand.ink,
};

const dark: Palette = {
  scheme: "dark",
  page: "#171A16",
  surface: "#22261F",
  soft: "#2A2E27",
  board: "#343930",
  text: brand.linen,
  muted: "#AEB1A6",
  faint: "#8B8F84",
  border: "#32372F",
  accent: brand.coral,
  accentSoft: "#3A2620",
  ink: brand.linen,
  onInk: brand.ink,
  // Reversed logo: linen ring and wordmark, coral collar unchanged.
  logoInk: brand.linen,
};

export function useTheme(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

// Inter, the wordmark's typeface. Weights loaded in app/_layout.tsx.
export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

// Size-specific tracking: tighter as type grows, slightly open for small caps labels.
export const type = {
  display: { fontFamily: font.bold, fontSize: 32, lineHeight: 36, letterSpacing: -0.9 },
  title: { fontFamily: font.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  headline: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  callout: { fontFamily: font.medium, fontSize: 14, lineHeight: 19 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 17 },
  eyebrow: { fontFamily: font.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1 },
} as const;

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
