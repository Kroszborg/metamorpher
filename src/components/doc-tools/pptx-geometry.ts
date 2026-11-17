/**
 * DrawingML shape outlines: the preset geometries PowerPoint decks use most
 * (with their adjust values) and custom geometry paths, as path commands in
 * the shape's own box (0..w, 0..h, y down).
 */
import type { PathCmd } from '@/engines/typeset';

type Adj = Map<string, number>;

/** Bezier constant for a quarter ellipse. */
const K = 0.5522847498;

function poly(points: [number, number][]): PathCmd[] {
  const out: PathCmd[] = points.map(([x, y], i): PathCmd => [i === 0 ? 'M' : 'L', x, y]);
  out.push(['Z']);
  return out;
}

export function ellipsePath(x: number, y: number, w: number, h: number): PathCmd[] {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry],
    ['C', cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy],
    ['C', cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry],
    ['C', cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy],
    ['Z'],
  ];
}

/** Rectangle with per-corner radii: top-left, top-right, bottom-right, bottom-left. */
function roundedRect(w: number, h: number, [tl, tr, br, bl]: [number, number, number, number]): PathCmd[] {
  const c = 1 - K;
  return [
    ['M', tl, 0],
    ['L', w - tr, 0],
    ['C', w - tr * c, 0, w, tr * c, w, tr],
    ['L', w, h - br],
    ['C', w, h - br * c, w - br * c, h, w - br, h],
    ['L', bl, h],
    ['C', bl * c, h, 0, h - bl * c, 0, h - bl],
    ['L', 0, tl],
    ['C', 0, tl * c, tl * c, 0, tl, 0],
    ['Z'],
  ];
}

/** Elliptical arc as cubic segments, angles in degrees (clockwise, 0 = +x). Starts with a line or move to the arc start. */
function arc(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number, move: boolean): PathCmd[] {
  const out: PathCmd[] = [];
  const rad = Math.PI / 180;
  let a = start * rad;
  out.push([move ? 'M' : 'L', cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 90));
  const d = (sweep * rad) / steps;
  const t = (4 / 3) * Math.tan(d / 4);
  for (let i = 0; i < steps; i++) {
    const b = a + d;
    const [c1, s1, c2, s2] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
    out.push([
      'C',
      cx + rx * (c1 - t * s1),
      cy + ry * (s1 + t * c1),
      cx + rx * (c2 + t * s2),
      cy + ry * (s2 - t * c2),
      cx + rx * c2,
      cy + ry * s2,
    ]);
    a = b;
  }
  return out;
}

function star(w: number, h: number, points: number, inner: number): PathCmd[] {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]);
  }
  return poly(pts);
}

function rightArrow(w: number, h: number, a1: number, a2: number): [number, number][] {
  const ss = Math.min(w, h);
  const y1 = h / 2 - (h * a1) / 200000;
  const y2 = h / 2 + (h * a1) / 200000;
  const x1 = Math.max(0, w - (ss * a2) / 100000);
  return [[0, y1], [x1, y1], [x1, 0], [w, h / 2], [x1, h], [x1, y2], [0, y2]];
}

/** Lines and connectors: drawn as open strokes. */
export const LINE_PRESETS = new Set(['line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'bentConnector4', 'curvedConnector2', 'curvedConnector3', 'curvedConnector4', 'arc']);

/**
 * The outline of a preset shape, or null when the preset is not known
 * (the caller draws a rectangle and counts it).
 */
export function presetPath(name: string, w: number, h: number, adj: Adj): PathCmd[] | null {
  const ss = Math.min(w, h);
  const a = (key: string, def: number) => adj.get(key) ?? def;
  switch (name) {
    case 'rect':
    case 'flowChartProcess':
    case 'flowChartPredefinedProcess':
    case 'flowChartInternalStorage':
    case 'wedgeRectCallout':
    case 'borderCallout1':
    case 'callout1':
    case 'accentCallout1':
    case 'frame':
    case 'plaque':
    case 'textBox':
      return poly([[0, 0], [w, 0], [w, h], [0, h]]);
    case 'roundRect':
    case 'wedgeRoundRectCallout': {
      const r = Math.min(ss / 2, (ss * a('adj', 16667)) / 100000);
      return roundedRect(w, h, [r, r, r, r]);
    }
    case 'flowChartAlternateProcess': {
      const r = ss * 0.16667;
      return roundedRect(w, h, [r, r, r, r]);
    }
    case 'flowChartTerminator': {
      const r = Math.min(w, h) / 2;
      return roundedRect(w, h, [r, r, r, r]);
    }
    case 'round1Rect': {
      const r = Math.min(ss / 2, (ss * a('adj', 16667)) / 100000);
      return roundedRect(w, h, [0, r, 0, 0]);
    }
    case 'round2SameRect': {
      const r = Math.min(ss / 2, (ss * a('adj1', 16667)) / 100000);
      const r2 = Math.min(ss / 2, (ss * a('adj2', 0)) / 100000);
      return roundedRect(w, h, [r, r, r2, r2]);
    }
    case 'round2DiagRect': {
      const r = Math.min(ss / 2, (ss * a('adj1', 16667)) / 100000);
      const r2 = Math.min(ss / 2, (ss * a('adj2', 0)) / 100000);
      return roundedRect(w, h, [r, r2, r, r2]);
    }
    case 'snip1Rect': {
      const s = (ss * a('adj', 16667)) / 100000;
      return poly([[0, 0], [w - s, 0], [w, s], [w, h], [0, h]]);
    }
    case 'snip2SameRect': {
      const s = (ss * a('adj1', 16667)) / 100000;
      return poly([[s, 0], [w - s, 0], [w, s], [w, h], [0, h], [0, s]]);
    }
    case 'ellipse':
    case 'flowChartConnector':
    case 'wedgeEllipseCallout':
    case 'cloud':
    case 'cloudCallout':
    case 'donut':
    case 'noSmoking':
    case 'sun':
      return ellipsePath(0, 0, w, h);
    case 'triangle':
    case 'flowChartExtract': {
      const x = (w * a('adj', 50000)) / 100000;
      return poly([[x, 0], [w, h], [0, h]]);
    }
    case 'flowChartMerge':
      return poly([[0, 0], [w, 0], [w / 2, h]]);
    case 'rtTriangle':
      return poly([[0, 0], [w, h], [0, h]]);
    case 'diamond':
    case 'flowChartDecision':
      return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const x = name === 'parallelogram' ? Math.min(w, (ss * a('adj', 25000)) / 100000) : w / 5;
      return poly([[x, 0], [w, 0], [w - x, h], [0, h]]);
    }
    case 'trapezoid': {
      const x = Math.min(w / 2, (ss * a('adj', 25000)) / 100000);
      return poly([[0, h], [x, 0], [w - x, 0], [w, h]]);
    }
    case 'flowChartManualOperation':
      return poly([[0, 0], [w, 0], [w * 0.8, h], [w * 0.2, h]]);
    case 'pentagon':
      return poly([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]);
    case 'hexagon': {
      const x = Math.min(w / 2, (ss * a('adj', 25000)) / 100000);
      return poly([[0, h / 2], [x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h]]);
    }
    case 'flowChartPreparation': {
      const x = w * 0.2;
      return poly([[0, h / 2], [x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h]]);
    }
    case 'heptagon':
    case 'decagon':
    case 'dodecagon': {
      const n = name === 'heptagon' ? 7 : name === 'decagon' ? 10 : 12;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        pts.push([w / 2 + (w / 2) * Math.cos(ang), h / 2 + (h / 2) * Math.sin(ang)]);
      }
      return poly(pts);
    }
    case 'octagon': {
      const x = Math.min(ss / 2, (ss * a('adj', 29289)) / 100000);
      return poly([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]);
    }
    case 'homePlate': {
      const x = Math.max(0, w - (ss * a('adj', 50000)) / 100000);
      return poly([[0, 0], [x, 0], [w, h / 2], [x, h], [0, h]]);
    }
    case 'chevron': {
      const x = Math.min(w, (ss * a('adj', 50000)) / 100000);
      return poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]);
    }
    case 'rightArrow':
    case 'notchedRightArrow':
      return poly(rightArrow(w, h, a('adj1', 50000), a('adj2', 50000)));
    case 'leftArrow':
      return poly(rightArrow(w, h, a('adj1', 50000), a('adj2', 50000)).map(([x, y]) => [w - x, y]));
    case 'downArrow':
      return poly(rightArrow(h, w, a('adj1', 50000), a('adj2', 50000)).map(([x, y]) => [y, x]));
    case 'upArrow':
      return poly(rightArrow(h, w, a('adj1', 50000), a('adj2', 50000)).map(([x, y]) => [y, h - x]));
    case 'leftRightArrow': {
      const ah = Math.min(w / 2, (ss * a('adj2', 50000)) / 100000);
      const y1 = h / 2 - (h * a('adj1', 50000)) / 200000;
      const y2 = h / 2 + (h * a('adj1', 50000)) / 200000;
      return poly([[0, h / 2], [ah, 0], [ah, y1], [w - ah, y1], [w - ah, 0], [w, h / 2], [w - ah, h], [w - ah, y2], [ah, y2], [ah, h]]);
    }
    case 'upDownArrow': {
      const ah = Math.min(h / 2, (ss * a('adj2', 50000)) / 100000);
      const x1 = w / 2 - (w * a('adj1', 50000)) / 200000;
      const x2 = w / 2 + (w * a('adj1', 50000)) / 200000;
      return poly([[w / 2, 0], [w, ah], [x2, ah], [x2, h - ah], [w, h - ah], [w / 2, h], [0, h - ah], [x1, h - ah], [x1, ah], [0, ah]]);
    }
    case 'plus':
    case 'flowChartOr':
    case 'mathPlus': {
      const x = Math.min(ss / 2, (ss * a('adj', 25000)) / 100000);
      return poly([[x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]]);
    }
    case 'star4':
      return star(w, h, 4, 0.25);
    case 'star5':
      return star(w, h, 5, 0.382);
    case 'star6':
      return star(w, h, 6, 0.5);
    case 'star7':
    case 'star8':
      return star(w, h, name === 'star7' ? 7 : 8, 0.6);
    case 'star10':
    case 'star12':
    case 'star16':
    case 'star24':
    case 'star32':
      return star(w, h, Number(name.slice(4)), 0.75);
    case 'flowChartDocument':
      return [['M', 0, 0], ['L', w, 0], ['L', w, h * 0.83], ['C', w * 0.75, h * 0.7, w * 0.55, h * 0.9, w * 0.5, h * 0.93], ['C', w * 0.3, h * 1.08, w * 0.12, h * 0.95, 0, h * 0.9], ['Z']];
    case 'can':
    case 'flowChartMagneticDisk': {
      const ry = Math.min(h / 4, (ss * a('adj', 25000)) / 200000);
      return [...arc(w / 2, ry, w / 2, ry, 180, 180, true), ['L', w, h - ry], ...arc(w / 2, h - ry, w / 2, ry, 0, 180, false).slice(1), ['Z']];
    }
    case 'line':
    case 'straightConnector1':
    case 'curvedConnector2':
    case 'curvedConnector3':
    case 'curvedConnector4':
      return [['M', 0, 0], ['L', w, h]];
    case 'bentConnector2':
      return [['M', 0, 0], ['L', w, 0], ['L', w, h]];
    case 'bentConnector3':
    case 'bentConnector4': {
      const x = (w * a('adj1', 50000)) / 100000;
      return [['M', 0, 0], ['L', x, 0], ['L', x, h], ['L', w, h]];
    }
    case 'arc': {
      const st = a('adj1', 16200000) / 60000;
      let en = a('adj2', 0) / 60000;
      if (en <= st) en += 360;
      return arc(w / 2, h / 2, w / 2, h / 2, st, en - st, true);
    }
    case 'pie':
    case 'chord': {
      const st = a('adj1', 0) / 60000;
      let en = a('adj2', 16200000) / 60000;
      if (en <= st) en += 360;
      const pts = arc(w / 2, h / 2, w / 2, h / 2, st, en - st, true);
      return name === 'pie' ? [...pts, ['L', w / 2, h / 2], ['Z']] : [...pts, ['Z']];
    }
    default:
      return null;
  }
}

/** `<a:custGeom>`: its paths scaled from their own size to the box. */
export function customPath(custGeom: Element, w: number, h: number): PathCmd[] {
  const out: PathCmd[] = [];
  const kid = (el: Element, name: string) => [...el.children].find((c) => c.localName === name);
  const lst = kid(custGeom, 'pathLst');
  if (!lst) return out;
  for (const path of lst.children) {
    if (path.localName !== 'path') continue;
    const pw = Number(path.getAttribute('w') ?? 0);
    const ph = Number(path.getAttribute('h') ?? 0);
    const sx = pw > 0 ? w / pw : 1 / 12700;
    const sy = ph > 0 ? h / ph : 1 / 12700;
    const pt = (el: Element | undefined): [number, number] => [Number(el?.getAttribute('x') ?? 0) * sx, Number(el?.getAttribute('y') ?? 0) * sy];
    let cur: [number, number] = [0, 0];
    for (const c of path.children) {
      const pts = [...c.children].filter((p) => p.localName === 'pt');
      switch (c.localName) {
        case 'moveTo':
          cur = pt(pts[0]);
          out.push(['M', ...cur]);
          break;
        case 'lnTo':
          cur = pt(pts[0]);
          out.push(['L', ...cur]);
          break;
        case 'cubicBezTo': {
          const [p1, p2, p3] = [pt(pts[0]), pt(pts[1]), pt(pts[2])];
          out.push(['C', ...p1, ...p2, ...p3]);
          cur = p3;
          break;
        }
        case 'quadBezTo': {
          const [q, p] = [pt(pts[0]), pt(pts[1])];
          out.push(['C', cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1]), p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1]), ...p]);
          cur = p;
          break;
        }
        case 'arcTo': {
          const rx = Number(c.getAttribute('wR') ?? 0) * sx;
          const ry = Number(c.getAttribute('hR') ?? 0) * sy;
          const st = Number(c.getAttribute('stAng') ?? 0) / 60000;
          const sw = Number(c.getAttribute('swAng') ?? 0) / 60000;
          const r = (st * Math.PI) / 180;
          const cx = cur[0] - rx * Math.cos(r);
          const cy = cur[1] - ry * Math.sin(r);
          const seg = arc(cx, cy, rx, ry, st, sw, false).slice(1);
          out.push(...seg);
          const last = seg[seg.length - 1];
          if (last && last[0] === 'C') cur = [last[5], last[6]];
          break;
        }
        case 'close':
          out.push(['Z']);
          break;
        default:
      }
    }
  }
  return out;
}
