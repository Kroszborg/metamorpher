// Copies runtime assets that must be served from this app's own origin into
// public/vendor (gitignored). Runs before `next dev` and `next build`.
//
//   public/vendor/ffmpeg/core/     single-thread ffmpeg.wasm core (ESM build)
//   public/vendor/ffmpeg/wrapper/  @ffmpeg/ffmpeg's module worker, loaded via classWorkerURL
//   public/vendor/pdfjs/           pdf.js standard fonts, CMaps, ICC profiles and wasm decoders
//
// Fails when the installed @ffmpeg/core differs from the version the wrapper was built for.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'public', 'vendor');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// ffmpeg: the core version must equal the wrapper's CORE_VERSION.
const ffmpegDir = join(root, 'node_modules', '@ffmpeg', 'ffmpeg');
const coreDir = join(root, 'node_modules', '@ffmpeg', 'core');
const constJs = readFileSync(join(ffmpegDir, 'dist', 'esm', 'const.js'), 'utf8');
const wanted = /CORE_VERSION = "([^"]+)"/.exec(constJs)?.[1];
const installed = readJson(join(coreDir, 'package.json')).version;
if (!wanted || wanted !== installed) {
  console.error(
    `[copy-runtime-assets] @ffmpeg/ffmpeg expects @ffmpeg/core@${wanted}, but ${installed} is installed. ` +
      'Pin @ffmpeg/core to the matching version in package.json.',
  );
  process.exit(1);
}

rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });

cpSync(join(coreDir, 'dist', 'esm'), join(vendor, 'ffmpeg', 'core'), { recursive: true });
cpSync(join(ffmpegDir, 'dist', 'esm'), join(vendor, 'ffmpeg', 'wrapper'), {
  recursive: true,
  filter: (src) => !src.endsWith('.d.ts') && !src.endsWith('.d.mts'),
});

const pdfjsDir = join(root, 'node_modules', 'pdfjs-dist');
for (const sub of ['standard_fonts', 'cmaps', 'iccs', 'wasm']) {
  const from = join(pdfjsDir, sub);
  if (existsSync(from)) cpSync(from, join(vendor, 'pdfjs', sub), { recursive: true });
}

const pdfjsVersion = readJson(join(pdfjsDir, 'package.json')).version;
console.log(
  `[copy-runtime-assets] ffmpeg core ${installed}, wrapper ${readJson(join(ffmpegDir, 'package.json')).version}, pdf.js ${pdfjsVersion} → public/vendor`,
);

// ── BEGIN image engine (src/engines/image/codecs.ts) ─────────────────────
// Single-thread WebAssembly codecs, imported at runtime by the image worker:
//   public/vendor/jsquash/{jpeg,webp,avif,oxipng,resize}/  MozJPEG, libwebp, libavif, oxipng, Lanczos resize
//   public/vendor/heic-to/heic-to.js                        libheif (LGPL-3.0), CSP-safe build
{
  const nm = join(root, 'node_modules');
  const imageAssets = [
    ['@jsquash/jpeg/codec/enc/mozjpeg_enc.js', 'jsquash/jpeg'],
    ['@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm', 'jsquash/jpeg'],
    ['@jsquash/webp/codec/enc/webp_enc.js', 'jsquash/webp'],
    ['@jsquash/webp/codec/enc/webp_enc.wasm', 'jsquash/webp'],
    ['@jsquash/webp/codec/enc/webp_enc_simd.js', 'jsquash/webp'],
    ['@jsquash/webp/codec/enc/webp_enc_simd.wasm', 'jsquash/webp'],
    ['@jsquash/avif/codec/enc/avif_enc.js', 'jsquash/avif'],
    ['@jsquash/avif/codec/enc/avif_enc.wasm', 'jsquash/avif'],
    ['@jsquash/oxipng/codec/pkg/squoosh_oxipng.js', 'jsquash/oxipng'],
    ['@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm', 'jsquash/oxipng'],
    ['@jsquash/resize/lib/resize/pkg/squoosh_resize.js', 'jsquash/resize'],
    ['@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm', 'jsquash/resize'],
    ['heic-to/dist/csp/heic-to.js', 'heic-to'],
  ];
  for (const [from, to] of imageAssets) {
    const name = from.slice(from.lastIndexOf('/') + 1);
    mkdirSync(join(vendor, to), { recursive: true });
    cpSync(join(nm, from), join(vendor, to, name));
  }
  console.log(`[copy-runtime-assets] image codecs (${imageAssets.length} files) → public/vendor/jsquash, public/vendor/heic-to`);
}
// ── END image engine ─────────────────────────────────────────────────────

// ── BEGIN MuPDF / qpdf / Ghostscript engines (src/engines/mupdf, qpdf, ghostscript) ──
// Served unbundled and imported by their module workers at runtime:
//   public/vendor/mupdf/        MuPDF.js (AGPL): mupdf.js, mupdf-wasm.js, mupdf-wasm.wasm
//   public/vendor/qpdf/         qpdf (Apache-2.0) wasm; qpdf.mjs is an ES-module copy of the CommonJS glue
//   public/vendor/ghostscript/  Ghostscript (AGPL) wasm for the optional "maximum" compression mode
{
  const nm = join(root, 'node_modules');
  mkdirSync(join(vendor, 'mupdf'), { recursive: true });
  for (const name of ['mupdf.js', 'mupdf-wasm.js', 'mupdf-wasm.wasm']) {
    cpSync(join(nm, 'mupdf', 'dist', name), join(vendor, 'mupdf', name));
  }
  const qpdfDist = join(nm, '@neslinesli93', 'qpdf-wasm', 'dist');
  mkdirSync(join(vendor, 'qpdf'), { recursive: true });
  cpSync(join(qpdfDist, 'qpdf.wasm'), join(vendor, 'qpdf', 'qpdf.wasm'));
  writeFileSync(
    join(vendor, 'qpdf', 'qpdf.mjs'),
    `${readFileSync(join(qpdfDist, 'qpdf.js'), 'utf8')}\nexport default Module;\n`,
  );
  const gsAssets = join(nm, '@bentopdf', 'gs-wasm', 'assets');
  mkdirSync(join(vendor, 'ghostscript'), { recursive: true });
  for (const name of ['gs.js', 'gs.wasm']) cpSync(join(gsAssets, name), join(vendor, 'ghostscript', name));
  console.log('[copy-runtime-assets] MuPDF, qpdf and Ghostscript wasm → public/vendor/{mupdf,qpdf,ghostscript}');
}
// ── END MuPDF / qpdf / Ghostscript engines ───────────────────────────────

// ── BEGIN document fonts (src/engines/typeset/fonts.ts) ──────────────────
// Fonts the document layout engine fetches on demand, only when a document
// contains text the built-in MuPDF fonts cannot show (OFL-1.1, from
// @expo-google-fonts). Embedded subsetted into the PDFs it makes:
//   public/vendor/fonts/<family>-<400|700|400i|700i>.ttf, OFL.txt
{
  const nm = join(root, 'node_modules', '@expo-google-fonts');
  const dir = join(vendor, 'fonts');
  mkdirSync(dir, { recursive: true });
  // [package, file prefix, styles]
  const R = ['400'];
  const RB = ['400', '700'];
  const RBI = ['400', '700', '400i', '700i'];
  const families = [
    ['noto-sans', 'NotoSans', RBI],
    ['noto-sans-mono', 'NotoSansMono', RB],
    ['carlito', 'Carlito', RBI],
    ['caladea', 'Caladea', RBI],
    ['noto-sans-symbols', 'NotoSansSymbols', R],
    ['noto-sans-symbols-2', 'NotoSansSymbols2', R],
    ['noto-sans-math', 'NotoSansMath', R],
    ['noto-emoji', 'NotoEmoji', R],
    ...[
      'arabic', 'armenian', 'bengali', 'devanagari', 'ethiopic', 'georgian', 'gujarati', 'gurmukhi', 'hebrew',
      'kannada', 'khmer', 'lao', 'malayalam', 'myanmar', 'sinhala', 'tamil', 'telugu', 'thai',
    ].map((s) => [`noto-sans-${s}`, `NotoSans${s[0].toUpperCase()}${s.slice(1)}`, RB]),
  ];
  const STYLE_DIR = { 400: '400Regular', 700: '700Bold', '400i': '400Regular_Italic', '700i': '700Bold_Italic' };
  // Latin ligatures (fi, ti …) lose their text in the PDF's ToUnicode map, so
  // "Introduction" would not be searchable. Renaming the optional ligature
  // features in GSUB turns them off without touching anything else.
  const NO_LIGATURES = new Set(['noto-sans', 'noto-sans-mono', 'carlito', 'caladea']);
  const disableLigatures = (buf) => {
    const tables = buf.readUInt16BE(4);
    for (let i = 0; i < tables; i++) {
      const rec = 12 + i * 16;
      if (buf.toString('latin1', rec, rec + 4) !== 'GSUB') continue;
      const gsub = buf.readUInt32BE(rec + 8);
      const list = gsub + buf.readUInt16BE(gsub + 6);
      const n = buf.readUInt16BE(list);
      for (let f = 0; f < n; f++) {
        const tagAt = list + 2 + f * 6;
        if (['liga', 'clig', 'dlig', 'hlig'].includes(buf.toString('latin1', tagAt, tagAt + 4))) buf.write('xlig', tagAt, 'latin1');
      }
    }
    return buf;
  };
  let count = 0;
  for (const [pkg, prefix, styles] of families) {
    for (const style of styles) {
      const sub = STYLE_DIR[style];
      const from = join(nm, pkg, sub, `${prefix}_${sub}.ttf`);
      const to = join(dir, `${pkg}-${style}.ttf`);
      if (NO_LIGATURES.has(pkg)) writeFileSync(to, disableLigatures(readFileSync(from)));
      else cpSync(from, to);
      count += 1;
    }
  }
  cpSync(join(nm, 'noto-sans', 'LICENSE_FONT'), join(dir, 'OFL.txt'));
  console.log(`[copy-runtime-assets] document fonts (${count} files) → public/vendor/fonts`);
}
// ── END document fonts ───────────────────────────────────────────────────

// ── BEGIN handwriting fonts (src/tools/text-to-handwriting/fonts.ts) ─────
// Handwriting typefaces for the text-to-handwriting tool, loaded with the
// FontFace API only when that tool draws (OFL-1.1; Homemade Apple Apache-2.0),
// from @fontsource. Latin, Latin Extended, plus Devanagari (Kalam) and
// Cyrillic (Caveat):
//   public/vendor/handwriting/<family>-<subset>-400-normal.woff2, LICENSE-<family>.txt
{
  const nm = join(root, 'node_modules', '@fontsource');
  const dir = join(vendor, 'handwriting');
  mkdirSync(dir, { recursive: true });
  const families = {
    caveat: ['latin', 'latin-ext', 'cyrillic'],
    kalam: ['latin', 'latin-ext', 'devanagari'],
    'patrick-hand': ['latin', 'latin-ext'],
    'indie-flower': ['latin', 'latin-ext'],
    'homemade-apple': ['latin'],
    'shadows-into-light': ['latin', 'latin-ext'],
  };
  let count = 0;
  for (const [family, subsets] of Object.entries(families)) {
    for (const subset of subsets) {
      const name = `${family}-${subset}-400-normal.woff2`;
      cpSync(join(nm, family, 'files', name), join(dir, name));
      count += 1;
    }
    cpSync(join(nm, family, 'LICENSE'), join(dir, `LICENSE-${family}.txt`));
  }
  console.log(`[copy-runtime-assets] handwriting fonts (${count} files) → public/vendor/handwriting`);
}
// ── END handwriting fonts ────────────────────────────────────────────────

// ── BEGIN LaTeX engine (src/tools/resume-builder/latex) ──────────────────
// pdfLaTeX for the résumé builder's LaTeX mode: BusyTeX (TeX Live 2026 in
// WebAssembly, AGPL-3.0-or-later build by TeXlyre) and a trimmed TeX tree,
// produced by scripts/latex/build-texmf.mjs into vendor/latex (pinned,
// checksummed). busytex.mjs is an ES-module copy of the Emscripten glue.
//   public/vendor/latex/busytex.mjs, busytex.wasm, texmf.pack
{
  const src = join(root, 'vendor', 'latex');
  const dir = join(vendor, 'latex');
  if (existsSync(join(src, 'busytex.wasm')) && existsSync(join(src, 'texmf.pack'))) {
    mkdirSync(dir, { recursive: true });
    cpSync(join(src, 'busytex.wasm'), join(dir, 'busytex.wasm'));
    cpSync(join(src, 'texmf.pack'), join(dir, 'texmf.pack'));
    writeFileSync(join(dir, 'busytex.mjs'), `${readFileSync(join(src, 'busytex.js'), 'utf8')}\nexport default busytex;\n`);
    console.log('[copy-runtime-assets] LaTeX engine (BusyTeX + TeX tree) → public/vendor/latex');
  } else {
    console.warn('[copy-runtime-assets] vendor/latex is missing: LaTeX mode will say the engine is not installed. Run `node scripts/latex/build-texmf.mjs`.');
  }
}
// ── END LaTeX engine ─────────────────────────────────────────────────────

// ── BEGIN OCR engine (src/engines/ocr) ───────────────────────────────────
// Tesseract (Apache-2.0) for text recognition, fetched only when a tool runs OCR:
//   public/vendor/tesseract/worker.min.js                tesseract.js 7 worker script (classic worker)
//   public/vendor/tesseract/tesseract-core-*lstm.{js,wasm} LSTM-only cores, with and without SIMD
//   public/vendor/tesseract/lang/<code>.traineddata.gz   tessdata_best integer models, one per language
{
  const nm = join(root, 'node_modules');
  const dir = join(vendor, 'tesseract');
  mkdirSync(join(dir, 'lang'), { recursive: true });
  cpSync(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(dir, 'worker.min.js'));
  for (const name of ['tesseract-core-simd-lstm', 'tesseract-core-lstm']) {
    cpSync(join(nm, 'tesseract.js-core', `${name}.js`), join(dir, `${name}.js`));
    cpSync(join(nm, 'tesseract.js-core', `${name}.wasm`), join(dir, `${name}.wasm`));
  }
  cpSync(join(nm, 'tesseract.js-core', 'LICENSE'), join(dir, 'LICENSE.txt'));
  const langs = ['eng', 'hin', 'mar', 'ben', 'tam', 'tel', 'spa', 'fra', 'deu', 'por', 'ita', 'rus', 'ara'];
  for (const lang of langs) {
    cpSync(
      join(nm, '@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`),
      join(dir, 'lang', `${lang}.traineddata.gz`),
    );
  }
  console.log(`[copy-runtime-assets] Tesseract core and ${langs.length} language models → public/vendor/tesseract`);
}
// ── END OCR engine ───────────────────────────────────────────────────────

// ── BEGIN on-device AI (src/engines/ai) ──────────────────────────────────
// ONNX Runtime Web (MIT) for Transformers.js, loaded by the AI worker only when
// a model runs. The asyncify build serves both the WebAssembly CPU path and
// WebGPU. Model weights are not copied here: they are downloaded from
// huggingface.co after the user agrees, and kept in Cache Storage.
//   public/vendor/ort/ort-wasm-simd-threaded.asyncify.{mjs,wasm}
{
  const nm = join(root, 'node_modules');
  const nested = join(nm, '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web');
  const ortDir = existsSync(nested) ? nested : join(nm, 'onnxruntime-web');
  const wantedOrt = readJson(join(nm, '@huggingface', 'transformers', 'package.json')).dependencies['onnxruntime-web'];
  const haveOrt = readJson(join(ortDir, 'package.json')).version;
  if (wantedOrt.replace(/^[\^~]/, '') !== haveOrt) {
    console.error(`[copy-runtime-assets] Transformers.js expects onnxruntime-web ${wantedOrt}, found ${haveOrt}.`);
    process.exit(1);
  }
  const dir = join(vendor, 'ort');
  mkdirSync(dir, { recursive: true });
  for (const name of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
    cpSync(join(ortDir, 'dist', name), join(dir, name));
  }
  console.log(`[copy-runtime-assets] ONNX Runtime Web ${haveOrt} (asyncify) → public/vendor/ort`);
}
// ── END on-device AI ─────────────────────────────────────────────────────
