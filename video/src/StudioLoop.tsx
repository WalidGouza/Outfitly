import {
  AbsoluteFill,
  Easing,
  interpolate,
  interpolateColors,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { Garment, type Category } from "./Garment";
import { Logo } from "./brand";

const { fontFamily } = loadFont("normal", { weights: ["600"], subsets: ["latin"] });

export type Theme = "light" | "dark";

// Brand palette (brand/logo/GUIDELINES.md) and the app's board colours (style.css).
const palette = {
  light: { board: "#e4ddd0", ink: "#1e221d", chip: "#ffffff", chipText: "#1e221d", shadow: 0.13 },
  dark: { board: "#343930", ink: "#f6f2ea", chip: "#22261f", chipText: "#f6f2ea", shadow: 0.3 },
};
const CORAL = "#e8644a";

// Strong ease-out (the app's --ease); every move settles, nothing bounces.
const easeOut = Easing.bezier(0.23, 1, 0.32, 1);

type Box = { x: number; y: number; w: number; h: number; r: number };

// Scattered = the app's static board layout (style.css .board-*), scaled to 1200×800.
// Outfit = a straightened 2×2 flat lay, like a generated look card.
const pieces: {
  id: string;
  category: Category;
  colors: [string, string]; // [original, alternative]
  scattered: Box;
  outfit: Box;
}[] = [
  {
    id: "top",
    category: "tops",
    colors: ["#e9e5dc", "#aab6ae"], // everyday tee → relaxed Oxford
    scattered: { x: 12, y: 32, w: 636, h: 480, r: -9 },
    outfit: { x: 255, y: 40, w: 330, h: 315, r: 0 },
  },
  {
    id: "pants",
    category: "pants",
    colors: ["#506778", "#817864"], // denim → tailored trousers
    scattered: { x: 564, y: 16, w: 636, h: 688, r: 9 },
    outfit: { x: 255, y: 385, w: 330, h: 315, r: 0 },
  },
  {
    id: "shoes",
    category: "shoes",
    colors: ["#e8e4dc", "#886448"], // court sneakers → suede loafers
    scattered: { x: 72, y: 432, w: 600, h: 368, r: -7 },
    outfit: { x: 615, y: 385, w: 330, h: 315, r: 0 },
  },
  {
    id: "jacket",
    category: "jackets",
    colors: ["#8b927a", "#b8a18a"], // chore jacket → knit cardigan
    scattered: { x: 384, y: 248, w: 396, h: 464, r: 7 },
    outfit: { x: 615, y: 40, w: 330, h: 315, r: 0 },
  },
];

// Timeline (30 fps, 240 frames = 8 s, seamless loop: the last frame equals the first).
const T = {
  gather: 18, // pieces glide into the outfit
  chip: 52, // "match" chip appears
  swap: 96, // pieces turn into their alternatives
  logoIn: 146, // outfit steps back, logo resolves
  logoOut: 200, // logo leaves, pieces drift back to the board
  end: 240,
};

const mix = (a: Box, b: Box, t: number): Box => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
  r: a.r + (b.r - a.r) * t,
});

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function StudioLoop({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = palette[theme];

  // Critically damped spring (no overshoot) starting at `at`.
  const settle = (at: number, durationInFrames = 34) =>
    spring({ frame: frame - at, fps, durationInFrames, config: { damping: 200 } });

  // The outfit steps back while the logo takes over, then everything returns.
  const outfitPresence =
    interpolate(frame, [T.logoIn, T.logoIn + 16], [1, 0], { ...clamp, easing: easeOut }) +
    interpolate(frame, [T.logoOut + 8, T.end - 6], [0, 1], { ...clamp, easing: easeOut });
  const outfitScale = interpolate(
    frame,
    [T.logoIn, T.logoIn + 16, T.logoOut + 8, T.end - 6],
    [1, 0.94, 0.94, 1],
    { ...clamp, easing: easeOut },
  );

  const chipIn = settle(T.chip, 22);
  const chipOut = interpolate(frame, [T.logoIn, T.logoIn + 10], [1, 0], clamp);
  const swapped = interpolate(frame, [T.swap, T.swap + 18], [0, 1], { ...clamp, easing: easeOut });

  const ringIn = settle(T.logoIn + 12, 28);
  const collarIn = settle(T.logoIn + 22, 26);
  const wordIn = interpolate(frame, [T.logoIn + 28, T.logoIn + 42], [0, 1], { ...clamp, easing: easeOut });
  const dotIn = interpolate(frame, [T.logoIn + 40, T.logoIn + 48], [0, 1], { ...clamp, easing: easeOut });
  const logoOut = interpolate(frame, [T.logoOut, T.logoOut + 12], [1, 0], clamp);
  // The symbol arrives centred, then glides left as the name appears beside it.
  // Lockup viewBox is 909.18 wide; the ring's centre sits at x=104, the lockup's at 454.59.
  const LOCKUP_WIDTH = 720;
  const symbolOffset = ((454.59 - 104) / 909.18) * LOCKUP_WIDTH;
  const slide = interpolate(frame, [T.logoIn + 26, T.logoIn + 44], [1, 0], { ...clamp, easing: easeOut });

  return (
    <AbsoluteFill style={{ background: c.board, fontFamily }}>
      {pieces.map((p, i) => {
        // Gather with a 4-frame stagger; return along the same path in reverse order.
        const gathered = settle(T.gather + i * 4);
        const back = interpolate(
          frame,
          [T.logoOut + 6 + (3 - i) * 3, T.end - 2],
          [0, 1],
          { ...clamp, easing: Easing.bezier(0.32, 0.72, 0, 1) },
        );
        const t = Math.max(0, gathered - back);
        const box = mix(p.scattered, p.outfit, t);
        // Alternatives fade back to the originals while pieces return to the board.
        const toAlternative = swapped * (1 - back);
        const lift = interpolate(frame, [T.swap + i * 3, T.swap + i * 3 + 9, T.swap + i * 3 + 18], [0, -10, 0], clamp);
        return (
          <div
            key={p.id}
            style={{
              position: "absolute",
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
              opacity: outfitPresence,
              transform: `translateY(${lift}px) rotate(${box.r}deg) scale(${outfitScale})`,
            }}
          >
            <Garment
              id={`${p.id}-${theme}`}
              category={p.category}
              color={interpolateColors(toAlternative, [0, 1], p.colors)}
              shadow={c.shadow}
            />
          </div>
        );
      })}

      {/* Match chip: the one interface element, with coral as its single accent. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 30,
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "16px 30px 16px 24px",
          borderRadius: 999,
          background: c.chip,
          color: c.chipText,
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          boxShadow: "0 10px 30px #1e221d1f",
          opacity: chipIn * chipOut,
          transform: `translateX(-50%) translateY(${(1 - chipIn) * 16}px) scale(${0.96 + chipIn * 0.04})`,
        }}
      >
        <span style={{ width: 14, height: 14, borderRadius: 7, background: CORAL }} />
        {/* Both labels share one grid cell, so the pill fits the longer one. */}
        <span style={{ display: "grid", whiteSpace: "nowrap" }}>
          <span style={{ gridArea: "1 / 1", opacity: 1 - swapped }}>Everyday · 94% match</span>
          <span style={{ gridArea: "1 / 1", opacity: swapped }}>Smart casual · 91% match</span>
        </span>
      </div>

      {/* Logo: ring settles in, the coral collar drops into its notch, then the name. */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          opacity: logoOut,
          ["--logo-ink" as string]: c.ink,
        }}
      >
        <style>{`
          .lockup .logo-ink { fill: var(--logo-ink); }
          .lockup .logo-coral { fill: ${CORAL}; }
          .lockup g .logo-ink, .lockup g .logo-coral { transform-box: fill-box; transform-origin: center; }
        `}</style>
        <div
          style={{ width: LOCKUP_WIDTH, transform: `translateX(${symbolOffset * slide}px)` }}
          className="lockup"
        >
          <style>{`
            .lockup g .logo-ink { opacity: ${ringIn}; transform: scale(${0.9 + ringIn * 0.1}); }
            .lockup g .logo-coral { opacity: ${collarIn}; transform: translateY(${(1 - collarIn) * -36}px); }
            .lockup > svg > path.logo-ink { opacity: ${wordIn}; }
            .lockup > svg > path.logo-coral { opacity: ${dotIn}; }
          `}</style>
          <Logo title="" />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
