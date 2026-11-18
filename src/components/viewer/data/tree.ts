/**
 * Structured data as a flat node table for a virtualised tree: nodes in
 * pre-order with depth and subtree size, so a 50 MB JSON file becomes a few
 * typed arrays, and expanding, collapsing, searching and paths are array work.
 */

export const T = { null: 0, bool: 1, number: 2, string: 3, array: 4, object: 5, element: 6, text: 7, attr: 8 } as const;
export type NodeType = (typeof T)[keyof typeof T];

export class NodeTable {
  n = 0;
  type: Uint8Array;
  depth: Uint16Array;
  parent: Int32Array;
  /** Number of descendants. */
  size: Int32Array;
  /** Array index, or -1 for object members and XML nodes. */
  index: Int32Array;
  key: (string | null)[] = [];
  /** Primitive value as text (strings unquoted, full length). */
  value: (string | null)[] = [];

  constructor(cap = 1024) {
    this.type = new Uint8Array(cap);
    this.depth = new Uint16Array(cap);
    this.parent = new Int32Array(cap);
    this.size = new Int32Array(cap);
    this.index = new Int32Array(cap);
  }

  #grow(): void {
    const cap = this.type.length * 2;
    const g = <A extends Uint8Array | Uint16Array | Int32Array>(a: A, make: (n: number) => A): A => {
      const b = make(cap);
      b.set(a);
      return b;
    };
    this.type = g(this.type, (n) => new Uint8Array(n));
    this.depth = g(this.depth, (n) => new Uint16Array(n));
    this.parent = g(this.parent, (n) => new Int32Array(n));
    this.size = g(this.size, (n) => new Int32Array(n));
    this.index = g(this.index, (n) => new Int32Array(n));
  }

  add(type: NodeType, depth: number, parent: number, key: string | null, index: number, value: string | null): number {
    if (this.n >= this.type.length) this.#grow();
    const i = this.n++;
    this.type[i] = type;
    this.depth[i] = Math.min(depth, 65535);
    this.parent[i] = parent;
    this.index[i] = index;
    this.key[i] = key;
    this.value[i] = value;
    this.size[i] = 0;
    return i;
  }

  close(i: number): void {
    this.size[i] = this.n - i - 1;
  }

  /** Direct children of node i. */
  children(i: number): number[] {
    const out: number[] = [];
    const end = i + this.size[i]! + 1;
    for (let j = i + 1; j < end; j += this.size[j]! + 1) out.push(j);
    return out;
  }

  childCount(i: number): number {
    let c = 0;
    const end = i + this.size[i]! + 1;
    for (let j = i + 1; j < end; j += this.size[j]! + 1) c++;
    return c;
  }

  isContainer(i: number): boolean {
    const t = this.type[i];
    return t === T.array || t === T.object || t === T.element;
  }
}

/** Builds the table from a parsed JS value (JSON, YAML, TOML, NDJSON). */
export function fromValue(root: unknown): NodeTable {
  const t = new NodeTable(4096);
  // Iterative DFS so deep documents do not overflow the stack.
  type Frame = { node: number; entries: [string | null, number, unknown][]; at: number };
  const open = (value: unknown, depth: number, parent: number, key: string | null, index: number): Frame | null => {
    if (value === null || value === undefined) {
      t.add(T.null, depth, parent, key, index, 'null');
      return null;
    }
    switch (typeof value) {
      case 'boolean':
        t.add(T.bool, depth, parent, key, index, String(value));
        return null;
      case 'number':
      case 'bigint':
        t.add(T.number, depth, parent, key, index, String(value));
        return null;
      case 'string':
        t.add(T.string, depth, parent, key, index, value);
        return null;
      default:
        break;
    }
    if (value instanceof Date) {
      t.add(T.string, depth, parent, key, index, value.toISOString());
      return null;
    }
    if (Array.isArray(value)) {
      const node = t.add(T.array, depth, parent, key, index, null);
      return { node, entries: value.map((v, i) => [null, i, v]), at: 0 };
    }
    const node = t.add(T.object, depth, parent, key, index, null);
    return { node, entries: Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, -1, v]), at: 0 };
  };
  const stack: Frame[] = [];
  const first = open(root, 0, -1, null, -1);
  if (first) stack.push(first);
  while (stack.length) {
    const f = stack[stack.length - 1]!;
    if (f.at >= f.entries.length) {
      t.close(f.node);
      stack.pop();
      continue;
    }
    const [k, i, v] = f.entries[f.at++]!;
    const child = open(v, stack.length, f.node, k, i);
    if (child) stack.push(child);
  }
  return t;
}

// ── XML ─────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export class XmlError extends Error {
  constructor(
    message: string,
    public offset: number,
  ) {
    super(message);
  }
}

/** A small, forgiving-but-honest XML parser: elements, attributes, text, CDATA; comments and declarations are skipped. */
export function fromXml(text: string): NodeTable {
  const t = new NodeTable(4096);
  const stack: { node: number; name: string }[] = [];
  let i = 0;
  const n = text.length;
  let rootSeen = false;
  const addText = (s: string, cdata: boolean) => {
    const v = cdata ? s : decodeEntities(s);
    if (!v.trim()) return;
    if (!stack.length) throw new XmlError('Text outside the root element.', i);
    t.add(T.text, stack.length, stack[stack.length - 1]!.node, '#text', -1, cdata ? v : v.trim());
  };
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      addText(text.slice(i), false);
      break;
    }
    if (lt > i) addText(text.slice(i, lt), false);
    i = lt;
    if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      if (e < 0) throw new XmlError('A comment is not closed.', i);
      i = e + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const e = text.indexOf(']]>', i + 9);
      if (e < 0) throw new XmlError('A CDATA section is not closed.', i);
      addText(text.slice(i + 9, e), true);
      i = e + 3;
    } else if (text.startsWith('<?', i)) {
      const e = text.indexOf('?>', i + 2);
      if (e < 0) throw new XmlError('A processing instruction is not closed.', i);
      i = e + 2;
    } else if (text.startsWith('<!', i)) {
      // DOCTYPE (with an optional internal subset).
      let depth = 0;
      let j = i + 2;
      for (; j < n; j++) {
        const c = text[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (text[i + 1] === '/') {
      const e = text.indexOf('>', i);
      if (e < 0) throw new XmlError('A closing tag is not finished.', i);
      const name = text.slice(i + 2, e).trim();
      const top = stack.pop();
      if (!top) throw new XmlError(`Closing tag </${name}> has no opening tag.`, i);
      if (top.name !== name) throw new XmlError(`Expected </${top.name}> but found </${name}>.`, i);
      t.close(top.node);
      i = e + 1;
    } else {
      const m = /^<([^\s/>]+)/.exec(text.slice(i, i + 256));
      if (!m) throw new XmlError('A tag has no name.', i);
      const name = m[1]!;
      if (!stack.length && rootSeen) throw new XmlError('A second root element: XML has exactly one.', i);
      rootSeen = true;
      const node = t.add(T.element, stack.length, stack.length ? stack[stack.length - 1]!.node : -1, name, -1, null);
      let j = i + 1 + name.length;
      // Attributes.
      const attrRe = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
      for (;;) {
        attrRe.lastIndex = j;
        const a = attrRe.exec(text);
        if (!a) break;
        t.add(T.attr, stack.length + 1, node, `@${a[1]}`, -1, decodeEntities(a[3] ?? a[4] ?? ''));
        j = attrRe.lastIndex;
      }
      while (j < n && /\s/.test(text[j]!)) j++;
      if (text.startsWith('/>', j)) {
        t.close(node);
        i = j + 2;
      } else if (text[j] === '>') {
        stack.push({ node, name });
        i = j + 1;
      } else {
        throw new XmlError(`The tag <${name}> is malformed.`, j);
      }
    }
  }
  if (stack.length) throw new XmlError(`<${stack[stack.length - 1]!.name}> is never closed.`, n);
  if (!rootSeen) throw new XmlError('There is no root element.', 0);
  return t;
}

// ── Back to values (for conversion) ─────────────────────────────────────────

/** A plain value for node i. XML elements become { "@attr": …, "#text": …, child: … } (repeated children as arrays). */
export function toValue(t: NodeTable, i = 0): unknown {
  const type = t.type[i];
  switch (type) {
    case T.null:
      return null;
    case T.bool:
      return t.value[i] === 'true';
    case T.number:
      return Number(t.value[i]);
    case T.string:
    case T.text:
    case T.attr:
      return t.value[i];
    case T.array:
      return t.children(i).map((c) => toValue(t, c));
    case T.object: {
      const o: Record<string, unknown> = {};
      for (const c of t.children(i)) o[t.key[c] ?? ''] = toValue(t, c);
      return o;
    }
    default: {
      const kids = t.children(i);
      if (kids.length === 1 && t.type[kids[0]!] === T.text) return t.value[kids[0]!];
      const o: Record<string, unknown> = {};
      for (const c of kids) {
        const k = t.key[c] ?? '';
        const v = toValue(t, c);
        if (k in o) {
          const prev = o[k];
          o[k] = Array.isArray(prev) && t.type[c] === T.element ? [...prev, v] : [prev, v];
        } else o[k] = v;
      }
      return o;
    }
  }
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlName = (k: string) => (/^[A-Za-z_][\w.-]*$/.test(k) ? k : `_${k.replace(/[^\w.-]/g, '_')}`);

/** XML text for a value: objects → elements, "@x" → attributes, "#text" → text, arrays → repeated elements. */
export function toXml(value: unknown, root = 'root'): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n'];
  const write = (name: string, v: unknown, indent: string) => {
    const tag = xmlName(name);
    if (Array.isArray(v)) {
      for (const item of v) write(name === 'root' ? 'item' : name, item, indent);
      return;
    }
    if (v === null || typeof v !== 'object') {
      out.push(`${indent}<${tag}>${v === null ? '' : xmlEsc(String(v))}</${tag}>\n`);
      return;
    }
    const entries = Object.entries(v as Record<string, unknown>);
    const attrs = entries.filter(([k, x]) => k.startsWith('@') && (x === null || typeof x !== 'object'));
    const rest = entries.filter(([k]) => !k.startsWith('@'));
    const attrText = attrs.map(([k, x]) => ` ${xmlName(k.slice(1))}="${xmlEsc(String(x ?? ''))}"`).join('');
    if (!rest.length) {
      out.push(`${indent}<${tag}${attrText}/>\n`);
      return;
    }
    if (rest.length === 1 && rest[0]![0] === '#text') {
      out.push(`${indent}<${tag}${attrText}>${xmlEsc(String(rest[0]![1] ?? ''))}</${tag}>\n`);
      return;
    }
    out.push(`${indent}<${tag}${attrText}>\n`);
    for (const [k, x] of rest) {
      if (k === '#text') out.push(`${indent}  ${xmlEsc(String(x ?? ''))}\n`);
      else write(k, x, `${indent}  `);
    }
    out.push(`${indent}</${tag}>\n`);
  };
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1) {
    const [[k, v]] = Object.entries(value as Record<string, unknown>) as [[string, unknown]];
    write(k, v, '');
  } else {
    out.push(`<${root}>\n`);
    if (Array.isArray(value)) for (const item of value) write('item', item, '  ');
    else if (value !== null && typeof value === 'object') for (const [k, x] of Object.entries(value)) write(k, x, '  ');
    else out.push(`  ${xmlEsc(String(value))}\n`);
    out.push(`</${root}>\n`);
  }
  return out.join('');
}

// ── Paths ───────────────────────────────────────────────────────────────────

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** JSONPath ($.a.b[2]["x y"]), JavaScript accessor (data.a.b[2]["x y"]) and JSON Pointer (/a/b/2/x y). */
export function pathsOf(t: NodeTable, i: number): { jsonPath: string; js: string; pointer: string } {
  const parts: { key: string | null; index: number }[] = [];
  for (let n = i; n > 0 && n >= 0; n = t.parent[n]!) parts.unshift({ key: t.key[n] ?? null, index: t.index[n]! });
  let jp = '$';
  let js = 'data';
  let ptr = '';
  for (const p of parts) {
    if (p.index >= 0 && p.key === null) {
      jp += `[${p.index}]`;
      js += `[${p.index}]`;
      ptr += `/${p.index}`;
    } else {
      const k = p.key ?? '';
      const safe = IDENT.test(k);
      jp += safe ? `.${k}` : `[${JSON.stringify(k)}]`;
      js += safe ? `.${k}` : `[${JSON.stringify(k)}]`;
      ptr += `/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    }
  }
  return { jsonPath: jp, js, pointer: ptr || '/' };
}

// ── Visible rows ────────────────────────────────────────────────────────────

export class TreeView {
  t: NodeTable;
  expanded: Uint8Array;
  visible: Int32Array;

  constructor(t: NodeTable, level: number) {
    this.t = t;
    this.expanded = new Uint8Array(t.n);
    for (let i = 0; i < t.n; i++) if (t.depth[i]! < level && t.isContainer(i)) this.expanded[i] = 1;
    this.visible = this.#build();
  }

  #build(): Int32Array {
    const t = this.t;
    const out: number[] = [];
    let i = 0;
    while (i < t.n) {
      out.push(i);
      i = t.isContainer(i) && !this.expanded[i] ? i + t.size[i]! + 1 : i + 1;
    }
    return Int32Array.from(out);
  }

  setLevel(level: number): void {
    const t = this.t;
    for (let i = 0; i < t.n; i++) this.expanded[i] = t.depth[i]! < level && t.isContainer(i) ? 1 : 0;
    this.visible = this.#build();
  }

  toggle(pos: number, open?: boolean): void {
    const node = this.visible[pos];
    if (node === undefined || !this.t.isContainer(node) || this.t.size[node] === 0) return;
    const want = open ?? !this.expanded[node];
    if (want === !!this.expanded[node]) return;
    const t = this.t;
    if (!want) {
      this.expanded[node] = 0;
      let end = pos + 1;
      const last = node + t.size[node]!;
      while (end < this.visible.length && this.visible[end]! <= last) end++;
      const next = new Int32Array(this.visible.length - (end - pos - 1));
      next.set(this.visible.subarray(0, pos + 1));
      next.set(this.visible.subarray(end), pos + 1);
      this.visible = next;
      return;
    }
    this.expanded[node] = 1;
    const add: number[] = [];
    let i = node + 1;
    const end = node + t.size[node]! + 1;
    while (i < end) {
      add.push(i);
      i = t.isContainer(i) && !this.expanded[i] ? i + t.size[i]! + 1 : i + 1;
    }
    const next = new Int32Array(this.visible.length + add.length);
    next.set(this.visible.subarray(0, pos + 1));
    next.set(add, pos + 1);
    next.set(this.visible.subarray(pos + 1), pos + 1 + add.length);
    this.visible = next;
  }

  /** Expands every ancestor of node i and returns its visible position. */
  reveal(i: number): number {
    let changed = false;
    for (let p = this.t.parent[i]!; p >= 0; p = this.t.parent[p]!) {
      if (!this.expanded[p]) {
        this.expanded[p] = 1;
        changed = true;
      }
    }
    if (changed) this.visible = this.#build();
    // Binary search: visible is in pre-order, so node ids increase.
    let lo = 0;
    let hi = this.visible.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = this.visible[mid]!;
      if (v === i) return mid;
      if (v < i) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}

/** Line and column (1-based) of a character offset. */
export function lineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, column: offset - last };
}
