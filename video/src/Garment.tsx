import type { ReactElement } from "react";

// The same flat garment drawings the app uses for its sample wardrobe
// (frontend/src/main.tsx, Garment), so the video and the UI match.
export type Category = "tops" | "pants" | "shoes" | "jackets";

const shapes: Record<Category, ReactElement> = {
  tops: (
    <>
      <path d="M64 34 88 24 Q110 42 132 24 L156 34 185 73 157 94 145 76 145 180 75 180 75 76 63 94 35 73Z" />
      <path d="M88 24Q110 57 132 24" fill="none" stroke="#666" opacity=".25" />
    </>
  ),
  pants: (
    <>
      <path d="M72 26H148L158 184H116L110 96 104 184H62Z" />
      <path
        d="M72 42H148M110 42V88M77 44Q78 64 64 68M143 44Q142 64 153 68"
        fill="none"
        stroke="#fff"
        opacity=".25"
      />
    </>
  ),
  shoes: (
    <>
      <path d="M37 91 56 69 77 86 129 94 155 109Q185 110 184 133H40Q23 116 37 91Z" />
      <path d="M47 143H178V154H47Z" fill="#d4d0c7" />
      <path d="M85 87 76 106M102 91 94 109M117 95 111 111" stroke="#fff" strokeWidth="5" />
      <path d="M54 55 74 37 94 51 145 59 173 75Q198 81 196 97L135 96 77 83Z" opacity=".65" />
    </>
  ),
  jackets: (
    <>
      <path d="M77 29 95 23H125L143 29 176 59 185 168 154 174 142 75 145 189H75L78 75 66 174 35 168 44 59Z" />
      <path
        d="M95 23 110 51 125 23M110 51V189M84 92H101V119H84M119 92H136V119H119"
        fill="none"
        stroke="#fff"
        opacity=".35"
      />
      {[66, 91, 116, 141, 166].map((y) => (
        <circle key={y} cx="111" cy={y} r="2" fill="#555" />
      ))}
    </>
  ),
};

export function Garment({
  id,
  category,
  color,
  shadow,
}: {
  id: string;
  category: Category;
  color: string;
  shadow: number;
}) {
  return (
    <svg viewBox="0 0 220 210" width="100%" height="100%">
      <defs>
        <filter id={`shadow-${id}`}>
          <feDropShadow dx="0" dy="7" stdDeviation="5" floodOpacity={shadow} />
        </filter>
        <linearGradient id={`fabric-${id}`} x1="0" x2="1">
          <stop stopColor={color} />
          <stop offset=".5" stopColor={color} />
          <stop offset="1" stopColor="#000" stopOpacity=".25" />
        </linearGradient>
      </defs>
      <g fill={`url(#fabric-${id})`} filter={`url(#shadow-${id})`}>
        {shapes[category]}
      </g>
    </svg>
  );
}
