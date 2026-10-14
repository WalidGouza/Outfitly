"""Generate frontend/src/brand.tsx from the master logo SVGs in brand/logo/final.

Run from anywhere: python frontend/scripts/generate_brand.py
"""
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
final = root / "brand" / "logo" / "final"
INK, CORAL = "#1E221D", "#E8644A"


def paths(name):
    s = (final / name).read_text()
    view = re.search(r'viewBox="([^"]+)"', s).group(1)
    group = re.search(r'<g transform="([^"]+)">', s)
    out = []
    for m in re.finditer(r"<path([^>]*)/>", s):
        a = m.group(1)
        fill = re.search(r'fill="([^"]+)"', a).group(1).upper()
        d = re.search(r' d="([^"]+)"', a).group(1)
        tr = re.search(r'transform="([^"]+)"', a)
        rule = re.search(r'fill-rule="([^"]+)"', a)
        role = {INK: "ink", CORAL: "coral"}[fill]
        out.append((role, d, tr.group(1) if tr else None, rule.group(1) if rule else None))
    return view, group.group(1) if group else None, out


def jsx(items, indent):
    lines = []
    for role, d, tr, rule in items:
        attrs = [f'className="logo-{role}"']
        if rule:
            attrs.append(f'fillRule="{rule}"')
        if tr:
            attrs.append(f'transform="{tr}"')
        attrs.append(f'd="{d}"')
        lines.append(f"{indent}<path {' '.join(attrs)} />")
    return "\n".join(lines)


hview, hgroup, hitems = paths("outfitly-horizontal.svg")
sview, _, sitems = paths("outfitly-symbol.svg")
_, _, smallitems = paths("outfitly-symbol-small.svg")
symbol_items = [i for i in hitems if i[2] is None]
word_items = [i for i in hitems if i[2] is not None]
assert len(symbol_items) == 2 and len(word_items) == 2

src = f'''// Generated from brand/logo/final/*.svg (Neckline O identity) — do not edit paths by hand.
// Colours come from CSS: .logo-ink is Wardrobe Ink on light themes and Linen on dark
// (the reversed version), .logo-coral is always Collar Coral. See style.css.

// An empty title marks a decorative use: hidden from assistive technology.
type LogoProps = {{ className?: string; title?: string }};

/** Horizontal lockup: symbol + wordmark. The primary logo (app header, sidebar). */
export function Logo({{ className, title = "Outfitly" }}: LogoProps) {{
  return (
    <svg
      className={{["logo", className].filter(Boolean).join(" ")}}
      viewBox="{hview}"
      {{...(title ? {{ role: "img", "aria-label": title }} : {{ "aria-hidden": true }})}}
    >
      <g transform="{hgroup}">
{jsx(symbol_items, "        ")}
      </g>
{jsx(word_items, "      ")}
    </svg>
  );
}}

/** Symbol alone. `small` is the heavier, collar-less cut required below 32 px. */
export function LogoSymbol({{
  className,
  title = "Outfitly",
  small = false,
}}: LogoProps & {{ small?: boolean }}) {{
  return (
    <svg
      className={{["logo", className].filter(Boolean).join(" ")}}
      viewBox="{sview}"
      {{...(title ? {{ role: "img", "aria-label": title }} : {{ "aria-hidden": true }})}}
    >
      {{small ? (
{jsx(smallitems, "        ")}
      ) : (
        <>
{jsx(sitems, "          ")}
        </>
      )}}
    </svg>
  );
}}
'''
(root / "frontend" / "src" / "brand.tsx").write_text(src, encoding="utf-8")
print("ok", len(src))
