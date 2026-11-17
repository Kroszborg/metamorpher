// Page-level PDF structure operations with @cantoo/pdf-lib, off the main thread:
// reorder, duplicate, delete, rotate, mirror, crop, resize, split and N-up.
// Page content is never re-rendered: content streams are kept as they are and,
// where geometry changes, wrapped in a transformation (vector stays vector).
import {
  concatTransformationMatrix,
  drawObject,
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFObject,
  PDFObjectCopier,
  PDFPage,
  PDFPageLeaf,
  PDFRef,
  PDFStream,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from '@cantoo/pdf-lib';
import { expose } from 'comlink';
import { passwordMessage, unreadableMessage } from './messages';

// ── Public types ─────────────────────────────────────────────────────────────

type NamedBlob = { name: string; blob: Blob };
type Progress = (done: number, total: number) => void;

/** Margins measured inward from each edge of the page as displayed (after rotation). */
export type PageMargins = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** 'fraction' (default): 0–1 of the displayed width/height. 'pt': PDF points. */
  unit?: 'fraction' | 'pt';
};

/** One page of an output document and what to do to it. */
export type PageSpec = {
  /** Index of the source file (in the `files` passed to the call). Default 0. */
  file?: number;
  /** 0-based page index in that file. */
  page: number;
  /** Extra clockwise rotation in degrees, a multiple of 90 (negative is fine). */
  rotate?: number;
  /** Keep only part of the page (sets the CropBox; nothing is deleted). */
  crop?: PageMargins;
  /** Mirror the page as displayed. */
  flip?: 'horizontal' | 'vertical';
  /**
   * Put the page on a sheet of this displayed size in points. `fit` scales the
   * content to fit (keeping its aspect ratio); otherwise it is centred at 100%.
   */
  resize?: { width: number; height: number; fit: boolean };
};

export type OutlineEntry = { title: string; level: number; page: number | null };

export type PdfInfo = { pageCount: number; outline: OutlineEntry[] };

export type NupOptions = {
  perSheet: 2 | 4 | 6 | 9 | 16;
  /** Sheet size in points (portrait), or null for the size of the first page. */
  sheet: { width: number; height: number } | null;
  orientation: 'auto' | 'portrait' | 'landscape';
  /** 'rows': left to right, then down. 'columns': top to bottom, then right. */
  order: 'rows' | 'columns';
  /** Outer margin and gap between pages, in points. */
  margin: number;
  border: boolean;
};

export type SizePart = { start: number; end: number; blob: Blob; oversized: boolean };

// ── Small helpers ────────────────────────────────────────────────────────────

const N = (name: string) => PDFName.of(name);
const MARK = N('MMDest');
type Rect = [number, number, number, number];
type Matrix = [number, number, number, number, number, number];

const pdfBlob = (bytes: Uint8Array) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });

function deref(ctx: PDFContext, obj: PDFObject | undefined): PDFObject | undefined {
  return obj instanceof PDFRef ? ctx.lookup(obj) : obj;
}
function asDict(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | undefined {
  const v = deref(ctx, obj);
  return v instanceof PDFDict ? v : undefined;
}
function asArray(ctx: PDFContext, obj: PDFObject | undefined): PDFArray | undefined {
  const v = deref(ctx, obj);
  return v instanceof PDFArray ? v : undefined;
}
function asNumber(ctx: PDFContext, obj: PDFObject | undefined): number | undefined {
  const v = deref(ctx, obj);
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}
function textOf(obj: PDFObject | undefined): string {
  return obj instanceof PDFString || obj instanceof PDFHexString ? obj.decodeText() : '';
}
function readRect(ctx: PDFContext, obj: PDFObject | undefined): Rect | undefined {
  const arr = asArray(ctx, obj);
  if (!arr || arr.size() < 4) return undefined;
  const v = [0, 1, 2, 3].map((i) => asNumber(ctx, arr.get(i)));
  if (v.some((n) => n === undefined || !Number.isFinite(n))) return undefined;
  const [x0, y0, x1, y1] = v as number[] as Rect;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}
function intersect(a: Rect, b: Rect): Rect {
  const r: Rect = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[2] - r[0] < 1 || r[3] - r[1] < 1 ? a : r;
}
const fmt = (n: number) => {
  const s = (Math.round(n * 10000) / 10000).toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
};
const norm90 = (deg: number) => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;

function transformPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

async function loadPdf(file: NamedBlob): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await file.blob.arrayBuffer(), { updateMetadata: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(message) || (err instanceof Error && err.name === 'EncryptedPDFError')) {
      throw new Error(passwordMessage(file.name));
    }
    throw new Error(unreadableMessage(file.name, message));
  }
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  // Write pending embeds first: their objects are only reachable once written.
  await doc.flush();
  collectGarbage(doc.context);
  return doc.save({ addDefaultPage: false, updateFieldAppearances: false });
}

/** Deletes every indirect object that the trailer can no longer reach (removed pages and their content). */
function collectGarbage(ctx: PDFContext): void {
  const live = new Set<PDFRef>();
  const stack: PDFObject[] = [];
  const info = ctx.trailerInfo;
  for (const root of [info.Root, info.Info]) if (root) stack.push(root);
  while (stack.length > 0) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (live.has(obj)) continue;
      live.add(obj);
      const target = ctx.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFDict) {
      for (const [, v] of obj.entries()) stack.push(v);
    } else if (obj instanceof PDFArray) {
      for (const v of obj.asArray()) stack.push(v);
    } else if (obj instanceof PDFStream) {
      for (const [, v] of obj.dict.entries()) stack.push(v);
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!live.has(ref)) ctx.delete(ref);
}

// ── Page geometry and transformations ────────────────────────────────────────

const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

/** Copies inherited attributes onto the leaf so it no longer depends on its page-tree parents. */
function materialize(leaf: PDFPageLeaf): void {
  for (const key of INHERITABLE) {
    if (leaf.get(N(key))) continue;
    const value = leaf.getInheritableAttribute(N(key));
    if (value) leaf.set(N(key), value);
  }
}

function geometry(ctx: PDFContext, leaf: PDFPageLeaf): { media: Rect; crop: Rect; rotate: number } {
  const media = readRect(ctx, leaf.getInheritableAttribute(N('MediaBox'))) ?? [0, 0, 612, 792];
  const cropRaw = readRect(ctx, leaf.getInheritableAttribute(N('CropBox')));
  const crop = cropRaw ? intersect(media, cropRaw) : media;
  const rotate = norm90(asNumber(ctx, leaf.getInheritableAttribute(N('Rotate'))) ?? 0);
  return { media, crop, rotate };
}

/** Displayed-edge margins → margins on the unrotated page edges (left, bottom, right, top). */
function unrotateMargins(m: PageMargins, rotation: number) {
  switch (rotation) {
    case 90:
      return { l: m.top, t: m.right, r: m.bottom, b: m.left };
    case 180:
      return { l: m.right, t: m.bottom, r: m.left, b: m.top };
    case 270:
      return { l: m.bottom, t: m.left, r: m.top, b: m.right };
    default:
      return { l: m.left, t: m.top, r: m.right, b: m.bottom };
  }
}

function applyMargins(box: Rect, margins: PageMargins, rotation: number): Rect {
  const m = unrotateMargins(margins, rotation);
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const k = margins.unit === 'pt' ? { x: 1, y: 1 } : { x: w, y: h };
  const clamp = (v: number) => Math.max(0, v);
  let x0 = box[0] + clamp(m.l) * k.x;
  let x1 = box[2] - clamp(m.r) * k.x;
  let y0 = box[1] + clamp(m.b) * k.y;
  let y1 = box[3] - clamp(m.t) * k.y;
  if (x1 - x0 < 1) [x0, x1] = [(x0 + x1) / 2 - 0.5, (x0 + x1) / 2 + 0.5];
  if (y1 - y0 < 1) [y0, y1] = [(y0 + y1) / 2 - 0.5, (y0 + y1) / 2 + 0.5];
  return [x0, y0, x1, y1];
}

/** Wraps the page's content streams in `q <m> cm [clip] … Q`. */
function wrapContent(ctx: PDFContext, leaf: PDFPageLeaf, m: Matrix, clip?: Rect): void {
  const contents = leaf.get(N('Contents'));
  const items: PDFObject[] = [];
  const resolved = deref(ctx, contents);
  if (resolved instanceof PDFArray) items.push(...resolved.asArray());
  else if (contents) items.push(contents);
  let pre = `q ${m.map(fmt).join(' ')} cm\n`;
  if (clip) {
    pre += `${fmt(clip[0])} ${fmt(clip[1])} ${fmt(clip[2] - clip[0])} ${fmt(clip[3] - clip[1])} re W n\n`;
  }
  const start = ctx.register(ctx.stream(pre));
  const end = ctx.register(ctx.stream('\nQ\n'));
  leaf.set(N('Contents'), ctx.obj([start, ...items, end]));
}

/** Moves annotation rectangles (and link quads) along with transformed content. */
function transformAnnots(ctx: PDFContext, leaf: PDFPageLeaf, m: Matrix): void {
  const annots = asArray(ctx, leaf.get(N('Annots')));
  if (!annots) return;
  for (const item of annots.asArray()) {
    const annot = asDict(ctx, item);
    if (!annot) continue;
    const rect = readRect(ctx, annot.get(N('Rect')));
    if (rect) {
      const a = transformPoint(m, rect[0], rect[1]);
      const b = transformPoint(m, rect[2], rect[3]);
      annot.set(
        N('Rect'),
        ctx.obj([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]),
      );
    }
    const quads = asArray(ctx, annot.get(N('QuadPoints')));
    if (quads) {
      const nums = quads.asArray().map((v) => asNumber(ctx, v) ?? 0);
      const out: number[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) out.push(...transformPoint(m, nums[i] ?? 0, nums[i + 1] ?? 0));
      annot.set(N('QuadPoints'), ctx.obj(out));
    }
  }
}

function transformPage(ctx: PDFContext, leaf: PDFPageLeaf, spec: PageSpec): void {
  materialize(leaf);
  const geo = geometry(ctx, leaf);
  const rotation = norm90(geo.rotate + (spec.rotate ?? 0));
  leaf.set(N('Rotate'), PDFNumber.of(rotation));
  let crop = geo.crop;

  if (spec.crop) {
    crop = applyMargins(crop, spec.crop, rotation);
    leaf.set(N('CropBox'), ctx.obj(crop));
    for (const key of ['BleedBox', 'TrimBox', 'ArtBox']) {
      const box = readRect(ctx, leaf.get(N(key)));
      if (box) leaf.set(N(key), ctx.obj(intersect(crop, box)));
    }
  }

  if (spec.flip) {
    const mirrorX = (spec.flip === 'horizontal') === (rotation % 180 === 0);
    const m: Matrix = mirrorX ? [-1, 0, 0, 1, crop[0] + crop[2], 0] : [1, 0, 0, -1, 0, crop[1] + crop[3]];
    wrapContent(ctx, leaf, m);
    transformAnnots(ctx, leaf, m);
  }

  if (spec.resize) {
    const sideways = rotation % 180 !== 0;
    const tw = sideways ? spec.resize.height : spec.resize.width;
    const th = sideways ? spec.resize.width : spec.resize.height;
    const cw = crop[2] - crop[0];
    const ch = crop[3] - crop[1];
    const s = spec.resize.fit ? Math.min(tw / cw, th / ch) : 1;
    const ox = (tw - s * cw) / 2;
    const oy = (th - s * ch) / 2;
    const m: Matrix = [s, 0, 0, s, ox - s * crop[0], oy - s * crop[1]];
    wrapContent(ctx, leaf, m, crop);
    transformAnnots(ctx, leaf, m);
    leaf.set(N('MediaBox'), ctx.obj([0, 0, tw, th]));
    for (const key of ['CropBox', 'BleedBox', 'TrimBox', 'ArtBox']) leaf.delete(N(key));
  }
}

// ── Destinations, links and outlines ─────────────────────────────────────────

type DestTarget = { page: number; rest: PDFObject[] };

/** Named destinations from the catalog's /Dests dictionary and /Names /Dests tree. */
function namedDests(doc: PDFDocument): Map<string, PDFObject> {
  const ctx = doc.context;
  const map = new Map<string, PDFObject>();
  const old = asDict(ctx, doc.catalog.get(N('Dests')));
  if (old) for (const [k, v] of old.entries()) map.set(k.decodeText(), v);
  const names = asDict(ctx, doc.catalog.get(N('Names')));
  const tree = asDict(ctx, names?.get(N('Dests')));
  const seen = new Set<PDFDict>();
  const walk = (node: PDFDict | undefined, depth: number) => {
    if (!node || seen.has(node) || depth > 32) return;
    seen.add(node);
    const pairs = asArray(ctx, node.get(N('Names')));
    if (pairs) {
      for (let i = 0; i + 1 < pairs.size(); i += 2) {
        const key = textOf(deref(ctx, pairs.get(i)));
        const value = pairs.get(i + 1);
        if (key && value && !map.has(key)) map.set(key, value);
      }
    }
    const kids = asArray(ctx, node.get(N('Kids')));
    if (kids) for (const kid of kids.asArray()) walk(asDict(ctx, kid), depth + 1);
  };
  walk(tree, 0);
  return map;
}

class DestResolver {
  #doc: PDFDocument;
  #named: Map<string, PDFObject> | null = null;
  readonly pageIndex: Map<PDFRef, number>;

  constructor(doc: PDFDocument, pages: PDFPage[]) {
    this.#doc = doc;
    this.pageIndex = new Map(pages.map((p, i) => [p.ref, i]));
  }

  #resolveValue(value: PDFObject | undefined, depth = 0): PDFArray | undefined {
    const ctx = this.#doc.context;
    const v = deref(ctx, value);
    if (!v || depth > 4) return undefined;
    if (v instanceof PDFArray) return v;
    if (v instanceof PDFDict) return this.#resolveValue(v.get(N('D')), depth + 1);
    let key: string | undefined;
    if (v instanceof PDFName) key = v.decodeText();
    else if (v instanceof PDFString || v instanceof PDFHexString) key = v.decodeText();
    if (key === undefined) return undefined;
    this.#named ??= namedDests(this.#doc);
    return this.#resolveValue(this.#named.get(key), depth + 1);
  }

  /** The destination of an outline item or link: its /Dest, or a /GoTo action's /D. */
  destOf(holder: PDFDict): { target: DestTarget | null; viaAction: boolean } | null {
    const ctx = this.#doc.context;
    let value = holder.get(N('Dest'));
    let viaAction = false;
    if (!value) {
      const action = asDict(ctx, holder.get(N('A')));
      if (!action || action.get(N('S')) !== N('GoTo')) return null;
      value = action.get(N('D'));
      viaAction = true;
    }
    const arr = this.#resolveValue(value);
    if (!arr) return { target: null, viaAction };
    const first = arr.get(0);
    const page = first instanceof PDFRef ? this.pageIndex.get(first) : undefined;
    if (page === undefined) return { target: null, viaAction };
    const rest = arr.asArray().slice(1).map((o) => (o instanceof PDFRef ? PDFNull : o));
    return { target: { page, rest }, viaAction };
  }
}

type OutlineNode = {
  title: string;
  file: number;
  page: number | null;
  rest: PDFObject[];
  /** A non-GoTo action (URI, launch …), from the source context. */
  action?: PDFObject;
  color?: PDFObject;
  flags?: PDFObject;
  open: boolean;
  children: OutlineNode[];
};

function readOutline(doc: PDFDocument, file: number, resolver: DestResolver): OutlineNode[] {
  const ctx = doc.context;
  const root = asDict(ctx, doc.catalog.get(N('Outlines')));
  if (!root) return [];
  const seen = new Set<PDFDict>();
  const walk = (first: PDFObject | undefined, depth: number): OutlineNode[] => {
    const out: OutlineNode[] = [];
    let item = asDict(ctx, first);
    while (item && !seen.has(item) && depth < 48) {
      seen.add(item);
      const dest = resolver.destOf(item);
      const action = dest ? undefined : item.get(N('A'));
      out.push({
        title: textOf(deref(ctx, item.get(N('Title')))).replace(/\0/g, ''),
        file,
        page: dest?.target?.page ?? null,
        rest: dest?.target?.rest ?? [],
        action,
        color: item.get(N('C')),
        flags: item.get(N('F')),
        open: (asNumber(ctx, item.get(N('Count'))) ?? 0) > 0,
        children: walk(item.get(N('First')), depth + 1),
      });
      item = asDict(ctx, item.get(N('Next')));
    }
    return out;
  };
  return walk(root.get(N('First')), 0);
}

function flattenOutline(nodes: OutlineNode[], level = 0, out: OutlineEntry[] = []): OutlineEntry[] {
  for (const n of nodes) {
    out.push({ title: n.title, level, page: n.page });
    flattenOutline(n.children, level + 1, out);
  }
  return out;
}

/**
 * Writes an outline into `doc`, keeping only items whose page is in the output
 * (an item whose own page is gone but whose children survive points at its
 * first surviving child).
 */
function writeOutline(
  doc: PDFDocument,
  nodes: OutlineNode[],
  refFor: (file: number, page: number) => PDFRef | undefined,
  copyObj: (file: number, obj: PDFObject) => PDFObject,
): void {
  const ctx = doc.context;
  type Built = { node: OutlineNode; dest?: PDFObject[]; action?: PDFObject; children: Built[] };
  const filter = (list: OutlineNode[]): Built[] => {
    const out: Built[] = [];
    for (const node of list) {
      const children = filter(node.children);
      const ref = node.page === null ? undefined : refFor(node.file, node.page);
      if (ref) out.push({ node, dest: [ref, ...node.rest], children });
      else if (node.action && node.page === null) out.push({ node, action: copyObj(node.file, node.action), children });
      else {
        const firstDest = children.find((c) => c.dest)?.dest;
        if (firstDest) out.push({ node, dest: firstDest, children });
        else if (children.length > 0) out.push(...children);
      }
    }
    return out;
  };
  const items = filter(nodes);
  doc.catalog.delete(N('Outlines'));
  if (items.length === 0) return;

  const rootRef = ctx.nextRef();
  const link = (list: Built[], parent: PDFRef): { first: PDFRef; last: PDFRef; visible: number } => {
    const refs = list.map(() => ctx.nextRef());
    let visible = 0;
    list.forEach((b, i) => {
      const ref = refs[i] as PDFRef;
      const dict = ctx.obj({ Title: PDFHexString.fromText(b.node.title), Parent: parent });
      if (i > 0) dict.set(N('Prev'), refs[i - 1] as PDFRef);
      if (i < refs.length - 1) dict.set(N('Next'), refs[i + 1] as PDFRef);
      if (b.dest) dict.set(N('Dest'), ctx.obj(b.dest));
      else if (b.action) dict.set(N('A'), b.action);
      if (b.node.color) dict.set(N('C'), copyObj(b.node.file, b.node.color));
      if (b.node.flags) dict.set(N('F'), copyObj(b.node.file, b.node.flags));
      let below = 0;
      if (b.children.length > 0) {
        const sub = link(b.children, ref);
        below = sub.visible;
        dict.set(N('First'), sub.first);
        dict.set(N('Last'), sub.last);
        dict.set(N('Count'), PDFNumber.of(b.node.open ? sub.visible : -sub.visible));
      }
      visible += 1 + (b.node.open ? below : 0);
      ctx.assign(ref, dict);
    });
    return { first: refs[0] as PDFRef, last: refs[refs.length - 1] as PDFRef, visible };
  };
  const top = link(items, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.visible }));
  doc.catalog.set(N('Outlines'), rootRef);
}

/**
 * Replaces every internal link's page reference with a marker
 * `/MMDest [file page …rest]`, so pages can be copied without dragging the
 * link targets along, and links can be re-pointed afterwards.
 */
function markLinks(doc: PDFDocument, pages: PDFPage[], file: number, resolver: DestResolver): void {
  const ctx = doc.context;
  for (const page of pages) {
    page.node.delete(N('B'));
    const annots = asArray(ctx, page.node.get(N('Annots')));
    if (!annots) continue;
    for (const item of annots.asArray()) {
      const annot = asDict(ctx, item);
      if (!annot) continue;
      annot.delete(N('P'));
      if (annot.get(N('Subtype')) !== N('Link')) continue;
      const dest = resolver.destOf(annot);
      if (!dest?.target) continue;
      annot.delete(N('Dest'));
      if (dest.viaAction) annot.delete(N('A'));
      annot.set(MARK, ctx.obj([file, dest.target.page, ...dest.target.rest]));
    }
  }
}

/** Re-points marked links at their page in the output, or drops links whose target is gone. */
function fixLinks(ctx: PDFContext, leaves: PDFPageLeaf[], refFor: (file: number, page: number) => PDFRef | undefined) {
  for (const leaf of leaves) {
    const annots = asArray(ctx, leaf.get(N('Annots')));
    if (!annots) continue;
    const keep: PDFObject[] = [];
    for (const item of annots.asArray()) {
      const annot = asDict(ctx, item);
      const mark = annot ? asArray(ctx, annot.get(MARK)) : undefined;
      if (!annot || !mark) {
        keep.push(item);
        continue;
      }
      annot.delete(MARK);
      const values = mark.asArray();
      const ref = refFor(asNumber(ctx, values[0]) ?? -1, asNumber(ctx, values[1]) ?? -1);
      if (!ref) continue;
      annot.set(N('Dest'), ctx.obj([ref, ...values.slice(2)]));
      keep.push(item);
    }
    leaf.set(N('Annots'), ctx.obj(keep));
  }
}

/** Gives each page its own annotation array and objects, so duplicated pages can be changed independently. */
function separateAnnots(ctx: PDFContext, leaves: PDFPageLeaf[]): void {
  const seen = new Set<PDFObject>();
  for (const leaf of leaves) {
    const annots = asArray(ctx, leaf.get(N('Annots')));
    if (!annots) continue;
    const items = annots.asArray().map((item) => {
      const key = item instanceof PDFRef ? item : deref(ctx, item);
      if (!key) return item;
      if (!seen.has(key)) {
        seen.add(key);
        return item;
      }
      const dict = asDict(ctx, item);
      return dict ? ctx.register(dict.clone(ctx)) : item;
    });
    leaf.set(N('Annots'), ctx.obj(items));
  }
}

/** Drops form fields whose widgets are no longer on any page. */
function pruneForm(ctx: PDFContext, acroForm: PDFDict, leaves: PDFPageLeaf[]): void {
  const onPages = new Set<PDFObject>();
  for (const leaf of leaves) {
    const annots = asArray(ctx, leaf.get(N('Annots')));
    if (annots) for (const a of annots.asArray()) onPages.add(a);
  }
  const keep = (item: PDFObject, depth: number): boolean => {
    const field = asDict(ctx, item);
    if (!field || depth > 32) return false;
    const kids = asArray(ctx, field.get(N('Kids')));
    if (kids) {
      const kept = kids.asArray().filter((k) => keep(k, depth + 1));
      field.set(N('Kids'), ctx.obj(kept));
      return kept.length > 0;
    }
    if (field.get(N('Subtype')) === N('Widget')) return onPages.has(item);
    return true;
  };
  const fields = asArray(ctx, acroForm.get(N('Fields')));
  if (fields) acroForm.set(N('Fields'), ctx.obj(fields.asArray().filter((f) => keep(f, 0))));
}

// ── Sources ──────────────────────────────────────────────────────────────────

type Source = {
  name: string;
  doc: PDFDocument;
  pages: PDFPage[];
  outline: OutlineNode[];
};

async function openSource(file: NamedBlob, index: number): Promise<Source> {
  const doc = await loadPdf(file);
  const pages = doc.getPages();
  const resolver = new DestResolver(doc, pages);
  const outline = readOutline(doc, index, resolver);
  markLinks(doc, pages, index, resolver);
  return { name: file.name, doc, pages, outline };
}

function checkSpecs(sources: Source[], specs: PageSpec[]): void {
  for (const spec of specs) {
    const src = sources[spec.file ?? 0];
    if (!src) throw new Error('A page refers to a file that is not in the list.');
    if (!Number.isInteger(spec.page) || spec.page < 0 || spec.page >= src.pages.length) {
      throw new Error(`${src.name} has no page ${spec.page + 1} (it has ${src.pages.length}).`);
    }
  }
}

/** Builds one new document from pages of the sources (each copied with only what it uses). */
async function buildCopy(sources: Source[], specs: PageSpec[], keepOutline: boolean): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const ctx = out.context;
  const copiers = new Map<number, PDFObjectCopier>();
  const copierFor = (file: number) => {
    let c = copiers.get(file);
    if (!c) {
      const src = sources[file];
      if (!src) throw new Error('Missing source.');
      c = PDFObjectCopier.for(src.doc.context, ctx);
      copiers.set(file, c);
    }
    return c;
  };
  const first = new Map<string, PDFRef>();
  const leaves: PDFPageLeaf[] = [];
  for (const spec of specs) {
    const file = spec.file ?? 0;
    const src = sources[file] as Source;
    const leaf = copierFor(file).copy((src.pages[spec.page] as PDFPage).node);
    const ref = ctx.register(leaf);
    out.addPage(PDFPage.of(leaf, ref, out));
    leaves.push(leaf);
    const key = `${file}:${spec.page}`;
    if (!first.has(key)) first.set(key, ref);
  }
  const refFor = (file: number, page: number) => first.get(`${file}:${page}`);

  separateAnnots(ctx, leaves);
  specs.forEach((spec, i) => transformPage(ctx, leaves[i] as PDFPageLeaf, spec));
  fixLinks(ctx, leaves, refFor);

  // Document-level parts that pages depend on, from the first source used.
  const used = [...new Set(specs.map((s) => s.file ?? 0))];
  const lead = used[0] ?? 0;
  const leadSrc = sources[lead] as Source;
  const info = leadSrc.doc.context.trailerInfo.Info;
  if (info) ctx.trailerInfo.Info = copierFor(lead).copy(info);
  for (const key of ['OCProperties', 'Lang', 'ViewerPreferences']) {
    const value = leadSrc.doc.catalog.get(N(key));
    if (value) out.catalog.set(N(key), copierFor(lead).copy(value));
  }
  // Form fields from every source, pruned to the widgets that made it in.
  const fieldRefs: PDFObject[] = [];
  let acro: PDFDict | undefined;
  for (const file of used) {
    const src = sources[file] as Source;
    const form = asDict(src.doc.context, src.doc.catalog.get(N('AcroForm')));
    if (!form) continue;
    const copied = asDict(ctx, copierFor(file).copy(form));
    if (!copied) continue;
    acro ??= copied;
    const fields = asArray(ctx, copied.get(N('Fields')));
    if (fields) fieldRefs.push(...fields.asArray());
  }
  if (acro) {
    acro.set(N('Fields'), ctx.obj(fieldRefs));
    acro.delete(N('XFA'));
    pruneForm(ctx, acro, leaves);
    out.catalog.set(N('AcroForm'), ctx.register(acro));
  }

  if (keepOutline) {
    const nodes = used.flatMap((file) => (sources[file] as Source).outline);
    writeOutline(out, nodes, refFor, (file, obj) => copierFor(file).copy(obj));
    if (nodes.length > 0 && leadSrc.doc.catalog.get(N('PageMode')) === N('UseOutlines')) {
      out.catalog.set(N('PageMode'), N('UseOutlines'));
    }
  }
  return save(out);
}

/**
 * Rewrites a single document in place: new page order (with duplicates),
 * transformations, then cleanup of whatever pointed at removed pages. Keeps
 * everything else the file has (forms, tags, layers, attachments, metadata).
 */
async function rewriteInPlace(file: NamedBlob, specs: PageSpec[]): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const ctx = doc.context;
  const pages = doc.getPages();
  const name = file.name;
  checkSpecs([{ name, doc, pages, outline: [] }], specs);
  if (specs.length === 0) throw new Error('The result would have no pages.');

  const used = new Set(specs.map((s) => s.page));
  const removed = used.size < pages.length;
  const restructured = removed || specs.length !== pages.length || specs.some((s, i) => s.page !== i);

  const resolver = new DestResolver(doc, pages);
  const outline = restructured ? readOutline(doc, 0, resolver) : [];
  const openDest = (() => {
    if (!restructured) return null;
    const v = deref(ctx, doc.catalog.get(N('OpenAction')));
    if (v instanceof PDFArray) return resolver.destOf(ctx.obj({ Dest: v }));
    if (v instanceof PDFDict) return resolver.destOf(ctx.obj({ A: v }));
    return null;
  })();
  if (restructured) markLinks(doc, pages, 0, resolver);

  for (const page of pages) materialize(page.node);
  const taken = new Set<number>();
  const leaves: PDFPageLeaf[] = [];
  const refs: PDFRef[] = [];
  const first = new Map<number, PDFRef>();
  for (const spec of specs) {
    const page = pages[spec.page] as PDFPage;
    let leaf = page.node;
    let ref = page.ref;
    if (taken.has(spec.page)) {
      leaf = page.node.clone(ctx);
      ref = ctx.register(leaf);
    }
    taken.add(spec.page);
    leaves.push(leaf);
    refs.push(ref);
    if (!first.has(spec.page)) first.set(spec.page, ref);
  }

  const rootRef = doc.catalog.get(N('Pages'));
  const root = asDict(ctx, rootRef);
  if (!(rootRef instanceof PDFRef) || !root) throw new Error(`${name} has a damaged page tree.`);
  root.set(N('Kids'), ctx.obj(refs));
  root.set(N('Count'), PDFNumber.of(refs.length));
  for (const leaf of leaves) leaf.set(N('Parent'), rootRef);

  if (restructured) separateAnnots(ctx, leaves);
  specs.forEach((spec, i) => transformPage(ctx, leaves[i] as PDFPageLeaf, spec));

  if (restructured) {
    const refFor = (_file: number, page: number) => first.get(page);
    fixLinks(ctx, leaves, refFor);
    writeOutline(doc, outline, refFor, (_file, obj) => obj);
    const cat = doc.catalog;
    if (openDest) {
      const target = openDest.target ? first.get(openDest.target.page) : undefined;
      if (target && openDest.target) cat.set(N('OpenAction'), ctx.obj([target, ...openDest.target.rest]));
      else cat.delete(N('OpenAction'));
    }
    // Page labels are numbered by position, so they no longer fit a new order.
    cat.delete(N('PageLabels'));
    if (removed) {
      // These point at pages directly; rebuilding them is not supported, so they
      // are dropped rather than left pointing at (and keeping alive) removed pages.
      cat.delete(N('StructTreeRoot'));
      cat.delete(N('Threads'));
      cat.delete(N('Dests'));
      asDict(ctx, cat.get(N('Names')))?.delete(N('Dests'));
      const form = asDict(ctx, cat.get(N('AcroForm')));
      if (form) pruneForm(ctx, form, leaves);
    }
  }
  return save(doc);
}

// ── N-up ─────────────────────────────────────────────────────────────────────

const GRIDS: Record<NupOptions['perSheet'], [number, number][]> = {
  2: [
    [2, 1],
    [1, 2],
  ],
  4: [[2, 2]],
  6: [
    [3, 2],
    [2, 3],
  ],
  9: [[3, 3]],
  16: [[4, 4]],
};

/** The placement matrix for a page whose crop box is cw×ch, shown with `rotation`, scaled by s at (x, y). */
function placement(rotation: number, s: number, cw: number, ch: number, x: number, y: number): Matrix {
  switch (rotation) {
    case 90:
      return [0, -s, s, 0, x, y + s * cw];
    case 180:
      return [-s, 0, 0, -s, x + s * cw, y + s * ch];
    case 270:
      return [0, s, -s, 0, x + s * ch, y];
    default:
      return [s, 0, 0, s, x, y];
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

const api = {
  /** Page count and the flattened bookmark tree. Rejects with a clear message for encrypted files. */
  async inspect(file: NamedBlob): Promise<PdfInfo> {
    const doc = await loadPdf(file);
    const pages = doc.getPages();
    const outline = readOutline(doc, 0, new DestResolver(doc, pages));
    return { pageCount: pages.length, outline: flattenOutline(outline) };
  },

  /** One document, rewritten in place (see `rewriteInPlace`). */
  async rewrite(file: NamedBlob, specs: PageSpec[]): Promise<Blob> {
    return pdfBlob(await rewriteInPlace(file, specs));
  },

  /**
   * One new document per group, each built from pages of `files` (copied with
   * only what they use, so parts are small). Bookmarks and internal links are
   * kept for pages that are in the same output.
   */
  async assemble(
    files: NamedBlob[],
    groups: PageSpec[][],
    options: { outline?: boolean } = {},
    onProgress?: Progress,
  ): Promise<Blob[]> {
    const sources: Source[] = [];
    for (const [i, f] of files.entries()) sources.push(await openSource(f, i));
    for (const group of groups) checkSpecs(sources, group);
    const out: Blob[] = [];
    for (const [i, group] of groups.entries()) {
      if (group.length === 0) throw new Error('A part would have no pages.');
      out.push(pdfBlob(await buildCopy(sources, group, options.outline ?? true)));
      onProgress?.(i + 1, groups.length);
    }
    return out;
  },

  /** Consecutive parts that each stay under `maxBytes` where a single page allows it. */
  async splitBySize(file: NamedBlob, maxBytes: number, onProgress?: Progress): Promise<SizePart[]> {
    const src = await openSource(file, 0);
    const n = src.pages.length;
    const build = (start: number, count: number) =>
      buildCopy(
        [src],
        Array.from({ length: count }, (_, k) => ({ page: start + k })),
        true,
      );
    const avg = Math.max(1, file.blob.size / n);
    const parts: SizePart[] = [];
    let start = 0;
    while (start < n) {
      const left = n - start;
      let best = await build(start, 1);
      let fit = 1;
      if (best.byteLength > maxBytes) {
        parts.push({ start, end: start, blob: pdfBlob(best), oversized: true });
        start += 1;
        onProgress?.(start, n);
        continue;
      }
      // Gallop from an estimate, then binary-search the largest part that fits.
      let probe = Math.min(left, Math.max(2, Math.floor((maxBytes * 0.9) / avg)));
      let tooBig = left + 1;
      while (fit < left) {
        const bytes = await build(start, probe);
        if (bytes.byteLength <= maxBytes) {
          fit = probe;
          best = bytes;
          if (probe === left) break;
          probe = Math.min(left, probe * 2);
        } else {
          tooBig = probe;
          break;
        }
      }
      let lo = fit;
      let hi = Math.min(tooBig, left + 1);
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const bytes = await build(start, mid);
        if (bytes.byteLength <= maxBytes) {
          lo = mid;
          best = bytes;
        } else hi = mid;
      }
      parts.push({ start, end: start + lo - 1, blob: pdfBlob(best), oversized: false });
      start += lo;
      onProgress?.(start, n);
    }
    return parts;
  },

  /** Places several pages on each sheet. Pages are embedded as vector form XObjects. */
  async nup(file: NamedBlob, options: NupOptions, onProgress?: Progress): Promise<Blob> {
    const src = await loadPdf(file);
    const ctx = src.context;
    const pages = src.getPages();
    if (pages.length === 0) throw new Error(`${file.name} has no pages.`);
    const geos = pages.map((p) => {
      p.node.delete(N('Annots'));
      return geometry(ctx, p.node);
    });
    const out = await PDFDocument.create({ updateMetadata: false });
    const info = ctx.trailerInfo.Info;
    if (info) out.context.trailerInfo.Info = PDFObjectCopier.for(ctx, out.context).copy(info);
    const embedded = await out.embedPages(
      pages,
      geos.map((g) => ({ left: g.crop[0], bottom: g.crop[1], right: g.crop[2], top: g.crop[3] })),
    );

    const g0 = geos[0] as (typeof geos)[number];
    const shown = (g: typeof g0) => {
      const w = g.crop[2] - g.crop[0];
      const h = g.crop[3] - g.crop[1];
      return g.rotate % 180 === 0 ? { w, h } : { w: h, h: w };
    };
    const firstShown = shown(g0);
    const base = options.sheet ?? { width: firstShown.w, height: firstShown.h };
    const short = Math.min(base.width, base.height);
    const long = Math.max(base.width, base.height);
    const m = Math.max(0, options.margin);

    // Pick the sheet orientation and grid that show the pages largest.
    let best = { score: -1, W: short, H: long, cols: 1, rows: 1 };
    const orientations =
      options.orientation === 'portrait'
        ? [[short, long]]
        : options.orientation === 'landscape'
          ? [[long, short]]
          : [
              [short, long],
              [long, short],
            ];
    for (const [W, H] of orientations as [number, number][]) {
      for (const [cols, rows] of GRIDS[options.perSheet]) {
        const cellW = (W - m * (cols + 1)) / cols;
        const cellH = (H - m * (rows + 1)) / rows;
        const score = Math.min(cellW / firstShown.w, cellH / firstShown.h);
        if (score > best.score) best = { score, W, H, cols, rows };
      }
    }
    const { W, H, cols, rows } = best;
    const cellW = (W - m * (cols + 1)) / cols;
    const cellH = (H - m * (rows + 1)) / rows;
    if (cellW <= 1 || cellH <= 1) throw new Error('The margin is too large for this sheet size.');

    const per = cols * rows;
    for (let startIdx = 0; startIdx < pages.length; startIdx += per) {
      const sheet = out.addPage([W, H]);
      for (let k = 0; k < per && startIdx + k < pages.length; k += 1) {
        const idx = startIdx + k;
        const col = options.order === 'rows' ? k % cols : Math.floor(k / rows);
        const row = options.order === 'rows' ? Math.floor(k / cols) : k % rows;
        const g = geos[idx] as typeof g0;
        const size = shown(g);
        const s = Math.min(cellW / size.w, cellH / size.h);
        const w = size.w * s;
        const h = size.h * s;
        const cellX = m + col * (cellW + m);
        const cellY = H - m - (row + 1) * cellH - row * m;
        const x = cellX + (cellW - w) / 2;
        const y = cellY + (cellH - h) / 2;
        const cw = g.crop[2] - g.crop[0];
        const ch = g.crop[3] - g.crop[1];
        const name = sheet.node.newXObject('MMPage', (embedded[idx] as (typeof embedded)[number]).ref);
        sheet.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(...placement(g.rotate, s, cw, ch, x, y)),
          drawObject(name),
          popGraphicsState(),
        );
        if (options.border) {
          sheet.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
        }
      }
      onProgress?.(Math.min(pages.length, startIdx + per), pages.length);
    }
    return pdfBlob(await save(out));
  },
};

export type PageOpsWorkerApi = typeof api;

expose(api);
