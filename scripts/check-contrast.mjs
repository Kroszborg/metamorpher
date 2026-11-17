// Checks the WCAG contrast of the light and dark palettes in src/app/colors.css.
// Usage: node scripts/check-contrast.mjs   (exits 1 when a pair is below its minimum)
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/app/colors.css', import.meta.url), 'utf8');

function parseColor(v) {
  v = v.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^rgb\((\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\)$/.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] ? +m[4] : 1 };
  throw new Error(`Cannot parse colour ${v}`);
}
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});
const lum = ({ r, g, b }) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const blocks = [...css.matchAll(/([^{}]+)\{([^}]+)\}/g)].map(([, sel, body]) => ({
  sel: sel.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
  tokens: Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]),
  ),
}));

const checks = [
  ['primary-foreground', 'primary', 4.5],
  ['primary', 'background', 4.5],
  ['primary', 'card', 4.5],
  ['sidebar-accent-foreground', 'sidebar-accent', 4.5],
  ['primary', 'sidebar-accent', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['sidebar-foreground', 'sidebar', 4.5],
  ['foreground', 'background', 7],
];

let failed = false;
for (const { sel, tokens } of blocks) {
  if (!tokens.primary) continue;
  const solid = (name) => {
    const c = parseColor(tokens[name]);
    // Translucent sidebar tints are composited over the sidebar surface.
    return c.a < 1 ? over(c, parseColor(tokens.sidebar)) : c;
  };
  const rows = checks.map(([fg, bg, min]) => {
    const r = ratio(solid(fg), solid(bg));
    if (r < min) failed = true;
    return `${r < min ? 'FAIL' : ' ok '} ${r.toFixed(2).padStart(5)}  ${fg} on ${bg}`;
  });
  console.log(`\n${sel.split('\n').pop()}\n${rows.join('\n')}`);
}
process.exit(failed ? 1 : 0);
