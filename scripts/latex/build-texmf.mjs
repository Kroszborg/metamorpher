// Builds the self-hosted LaTeX engine for the résumé builder's LaTeX mode:
//   vendor/latex/busytex.js, busytex.wasm   TeX Live 2026 pdfTeX/XeTeX/LuaTeX in WebAssembly (BusyTeX,
//                                           TeXlyre build; AGPL-3.0-or-later wrapper, TeX Live licences)
//   vendor/latex/texmf.pack                 the TeX files LaTeX mode needs (format, LaTeX, packages, fonts)
//   vendor/latex/texmf-files.txt            what is in the pack
// Everything is downloaded from the pinned TeXlyre BusyTeX release once, checked against SHA-256,
// and served from this origin afterwards (copied to public/vendor/latex by copy-runtime-assets).
// Only the chunks of texlive-extra.data that hold the selected packages are fetched (HTTP Range).
//
//   node scripts/latex/build-texmf.mjs            (≈ 32 MB wasm + 93 MB basic data + ~20 MB of ranges)
//
// The file list is scripts/latex/texmf-files.txt (files from texlive-basic, the rest from texlive-extra).
// With --tree <dir> (an extracted TeX tree, <dir>/texlive/...) nothing but the engine is downloaded.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'vendor', 'latex');
const cache = join(root, '.cache', 'latex');
const RELEASE = 'https://github.com/TeXlyre/texlyre-busytex-build/releases/download/build_wasm_46ebb6216a5c1fe63dd1dc885831d1a8cef2dc86_31802832436_1';
const PINS = {
  'busytex.js': '875b87795162cb26b15bd93cffa2e8739bcb900d623ab904029b39402508a1a4',
  'busytex.wasm': '8d1988fc58cd1611c3cbd6bd986c3e607e5ff44f1d94252207ff7aae4cee72e0',
  'texlive-basic.data': 'ccb35d98d77cbaf988e1481f8538709f72166196785cf6b8785eabe6c8fb2993',
};
const CHUNK = 2048;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(name, { pin = PINS[name] } = {}) {
  mkdirSync(cache, { recursive: true });
  const path = join(cache, name);
  if (existsSync(path) && (!pin || sha256(readFileSync(path)) === pin)) return readFileSync(path);
  console.log(`[latex] downloading ${name}`);
  const res = await fetch(`${RELEASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (pin && sha256(buf) !== pin) throw new Error(`${name}: checksum mismatch`);
  writeFileSync(path, buf);
  return buf;
}

async function finalUrl(name) {
  const res = await fetch(`${RELEASE}/${name}`, { method: 'HEAD', redirect: 'manual' });
  return res.headers.get('location') ?? `${RELEASE}/${name}`;
}

function metadata(js) {
  const s = js.toString('utf8');
  const i = s.indexOf('var compressedData = ');
  const j = s.indexOf(';', i);
  const comp = JSON.parse(s.slice(i + 'var compressedData = '.length, j));
  const k = s.lastIndexOf('loadPackage({');
  let depth = 0;
  let start = s.indexOf('{', k);
  let end = start;
  for (let p = start; p < s.length; p++) {
    if (s[p] === '{') depth++;
    else if (s[p] === '}' && --depth === 0) {
      end = p + 1;
      break;
    }
  }
  return { comp, files: JSON.parse(s.slice(start, end)).files };
}

function lz4(src, outSize) {
  const dst = Buffer.alloc(outSize + 64);
  let i = 0;
  let o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) for (let b = 255; b === 255; ) lit += b = src[i++];
    src.copy(dst, o, i, i + lit);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8);
    i += 2;
    let ml = token & 15;
    if (ml === 15) for (let b = 255; b === 255; ) ml += b = src[i++];
    ml += 4;
    for (let k = 0; k < ml; k++, o++) dst[o] = dst[o - off];
  }
  return dst.subarray(0, outSize);
}

/** Extracts the selected files; `read(a, b)` returns compressed bytes [a, b). */
async function extract({ comp, files }, pick, read) {
  const total = files.at(-1).end;
  const chosen = files.filter((f) => pick(f.filename));
  const need = new Set();
  for (const f of chosen) for (let c = Math.floor(f.start / CHUNK); c <= Math.floor(Math.max(f.start, f.end - 1) / CHUNK); c++) need.add(c);
  const order = [...need].sort((a, b) => a - b);
  const chunks = new Map();
  let run = [];
  const flush = async () => {
    if (!run.length) return;
    const a = comp.offsets[run[0]];
    const b = comp.offsets[run.at(-1)] + comp.sizes[run.at(-1)];
    const blob = await read(a, b);
    for (const c of run) {
      const raw = blob.subarray(comp.offsets[c] - a, comp.offsets[c] - a + comp.sizes[c]);
      const size = Math.min(CHUNK, total - c * CHUNK);
      chunks.set(c, comp.successes[c] ? lz4(raw, size) : raw.subarray(0, size));
    }
    run = [];
  };
  for (const c of order) {
    if (run.length && (c !== run.at(-1) + 1 || run.length >= 4096)) await flush();
    run.push(c);
  }
  await flush();
  const outFiles = new Map();
  for (const f of chosen) {
    const buf = Buffer.alloc(f.end - f.start);
    for (let c = Math.floor(f.start / CHUNK); c <= Math.floor(Math.max(f.start, f.end - 1) / CHUNK) && f.end > f.start; c++) {
      const chunk = chunks.get(c);
      const lo = Math.max(f.start, c * CHUNK) - c * CHUNK;
      const hi = Math.min(f.end, (c + 1) * CHUNK) - c * CHUNK;
      chunk.copy(buf, Math.max(f.start, c * CHUNK) - f.start, lo, hi);
    }
    outFiles.set(f.filename, buf);
  }
  return outFiles;
}

/** pdftex.map with only the entries whose font files are in the pack. */
function trimMap(map, have) {
  const names = new Set([...have].map((p) => p.slice(p.lastIndexOf('/') + 1)));
  const seen = new Set();
  return map
    .toString('latin1')
    .split('\n')
    .filter((line) => {
      const files = [...line.matchAll(/<\[?([\w.-]+\.(?:pfb|enc))/g)].map((m) => m[1]);
      if (files.length === 0 || !files.every((f) => names.has(f))) return false;
      // One entry per TFM name (later duplicates would only produce warnings).
      const tfm = line.split(/\s+/)[0];
      if (seen.has(tfm)) return false;
      seen.add(tfm);
      return true;
    })
    .join('\n');
}

(async () => {
  const listed = new Set(
    readFileSync(join(root, 'scripts', 'latex', 'texmf-files.txt'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
  const busytexJs = await download('busytex.js');
  const busytexWasm = await download('busytex.wasm');
  const treeAt = process.argv.indexOf('--tree');
  let files;
  if (treeAt > 0) {
    const tree = process.argv[treeAt + 1];
    files = new Map([...listed].map((p) => [p, readFileSync(join(tree, p))]));
  } else {
    const basicJs = await download('texlive-basic.js', { pin: null });
    const basicData = await download('texlive-basic.data');
    const extraJs = await download('texlive-extra.js', { pin: null });
    const basic = await extract(metadata(basicJs), (f) => listed.has(f), async (a, b) => basicData.subarray(a, b));
    const extraUrl = await finalUrl('texlive-extra.data');
    const extra = await extract(
      metadata(extraJs),
      (f) => listed.has(f) && !basic.has(f),
      async (a, b) => {
        for (let attempt = 0; ; attempt++) {
          try {
            const res = await fetch(extraUrl, { headers: { Range: `bytes=${a}-${b - 1}` } });
            if (res.status !== 206) throw new Error(`Range request failed: HTTP ${res.status}`);
            return Buffer.from(await res.arrayBuffer());
          } catch (err) {
            if (attempt >= 8) throw err;
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
          }
        }
      },
    );
    files = new Map([...basic, ...extra]);
    const missing = [...listed].filter((p) => !files.has(p));
    if (missing.length) throw new Error(`Not found in the TeX Live data: ${missing.slice(0, 5).join(', ')}`);
  }
  const mapPath = '/texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map';
  const fullMap = files.get(mapPath);
  if (!fullMap) throw new Error('pdftex.map missing from texmf-files.txt');
  // fontawesome5, marvosym and tex-gyre have their own maps in dvips/; keep the lines whose fonts are packed.
  let combined = fullMap.toString('latin1');
  for (const [p, buf] of files) if (/\/fonts\/map\/(dvips|pdftex)\/(fontawesome5|tex-gyre|marvosym)\/.*\.map$/.test(p)) combined += `\n${buf.toString('latin1')}`;
  files.set(mapPath, Buffer.from(trimMap(Buffer.from(combined, 'latin1'), files.keys()), 'latin1'));

  // ls-R databases for kpathsea (it only searches these): one for each tree root.
  const lsR = (prefix) => {
    const dirs = new Map();
    for (const p of files.keys()) {
      if (!p.startsWith(prefix) || p.endsWith('/ls-R')) continue;
      const rel = p.slice(prefix.length);
      const d = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (!dirs.has(d)) dirs.set(d, []);
      dirs.get(d).push(rel.slice(rel.lastIndexOf('/') + 1));
    }
    let text = '% ls-R -- filename database for kpathsea; do not change this line.\n';
    for (const [d, names] of [...dirs].sort()) text += `\n./${d}:\n${names.sort().join('\n')}\n`;
    return Buffer.from(text);
  };
  files.set('/texlive/texmf-dist/ls-R', lsR('/texlive/texmf-dist/'));
  files.set('/texlive/texmf-dist/texmf-var/ls-R', lsR('/texlive/texmf-dist/texmf-var/'));

  // Pack: u32 index length, UTF-8 JSON index [[path, offset, length]…], then the bytes.
  const entries = [...files].sort(([a], [b]) => (a < b ? -1 : 1));
  let offset = 0;
  const index = entries.map(([p, buf]) => {
    const e = [p, offset, buf.length];
    offset += buf.length;
    return e;
  });
  const indexBuf = Buffer.from(JSON.stringify(index));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(indexBuf.length);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'texmf.pack'), Buffer.concat([head, indexBuf, ...entries.map(([, b]) => b)]));
  writeFileSync(join(out, 'texmf-files.txt'), `${entries.map(([p, b]) => `${b.length}\t${p}`).join('\n')}\n`);
  writeFileSync(join(out, 'busytex.js'), busytexJs);
  writeFileSync(join(out, 'busytex.wasm'), busytexWasm);
  console.log(`[latex] ${entries.length} files, ${(offset / 1e6).toFixed(1)} MB → vendor/latex/texmf.pack`);
})().catch((err) => {
  console.error('[latex]', err);
  process.exit(1);
});
