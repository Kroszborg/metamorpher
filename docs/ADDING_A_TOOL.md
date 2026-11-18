# Adding a tool

A tool is **one folder** plus **one registry entry**. Nothing else in the shared code needs to change.

1. Create `src/tools/<slug>/index.tsx`. Its default export is the tool's React component.
2. In `src/tools/registry.ts`, find the tool's entry (every planned tool is already there), set
   `status: 'available'` and add `load: () => import('./<slug>')`.

That is all. The tool then appears in the rail category, the dashboard grid, the command palette
and the sitemap, and `/tools/<slug>` is statically generated with its title and description as
page metadata. Planned tools stay hidden and their URLs return 404.

## Worked example: PDFs to ZIP

`src/tools/pdfs-to-zip/index.tsx`:

```tsx
'use client';

import { defineJob, Workbench } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

const job = defineJob<null>({
  mode: 'batch',
  async run(inputs, _options, ctx) {
    const blob = await ctx.engines.archive.zip(
      inputs.map((i) => ({ name: i.file.name, blob: i.file })),
      ctx.signal,
    );
    return [{ name: 'pdfs.zip', blob }];
  },
});

export default function PdfsToZip({ tool }: ToolProps) {
  return <Workbench job={job} options={null} accept={tool.accept} runLabel="Create ZIP" />;
}
```

`src/tools/registry.ts`:

```diff
   {
     slug: 'pdfs-to-zip',
     ...
-    status: 'planned',
+    status: 'available',
+    load: () => import('./pdfs-to-zip'),
   },
```

Run `npm run typecheck && npm run lint && npm run build`, then open `/tools/pdfs-to-zip`.

## The contracts

### Registry entry (`src/tools/types.ts`)

| Field | Meaning |
| --- | --- |
| `slug` | URL segment. Never change it once shipped. |
| `title`, `description` | Card, palette and page `<title>`/meta description. One sentence. |
| `category` | One of the `CategoryId`s in `src/tools/categories.ts`. |
| `keywords` | Extra search terms (formats, synonyms). |
| `icon` | An icon from `@hugeicons/core-free-icons`. |
| `accept` | `<input accept>` syntax: `'.pdf'`, `'application/pdf'`, `'image/*'`. Empty = any file. |
| `status` | `'planned'` or `'available'`. `available` requires `load`. |
| `load` | `() => import('./<slug>')`. Called on the client only. |

The component receives `{ tool }` (the entry without `load`).

### Jobs (`src/components/workbench/types.ts`)

```ts
type Job<O> = {
  mode: 'each' | 'batch';
  run: (inputs: InputFile[], options: O, ctx: JobContext) => Promise<OutputFile[]>;
};
type InputFile = { id: string; file: File };          // id is unique per added file
type OutputFile = { name: string; blob: Blob; sourceId?: string };
type JobContext = {
  signal: AbortSignal;                                 // pass to every engine call
  onProgress: (fraction: number, note?: string) => void;
  engines: Engines;
};
```

- `'each'`: `run` gets one file at a time, sequentially, with per-file status. A failing file does
  not stop the others. `perFile(async (input, options, ctx) => output)` is the shorthand.
- `'batch'`: `run` gets every file once, in list order (merge, images to PDF). Use `defineJob`.
- Give outputs a real extension and a blob with the real MIME type (`mimeFor(ext)` in
  `src/lib/files.ts`). Throw an `Error` with a human message to fail a file.
- Cancelling aborts `ctx.signal`; engine calls then reject with an `AbortError` and the
  workbench marks the files cancelled. Long loops of your own should check `ctx.signal.aborted`.
- Define the job at module scope (not inside the component).

### Workbench (`src/components/workbench`)

```tsx
<Workbench
  job={job}
  options={options}          // your state, passed to job.run
  accept={tool.accept}
  runLabel="Convert"
  multiple                   // default true; new files are appended
  reorderable                // drag-to-reorder when order matters
  minFiles={2}               // default 1
  validate={(files, options) => null /* or a message that blocks the run */}
  optionsPanel={<>...</>}    // disabled automatically while running
  zipName="converted.zip"    // name for "Download all (ZIP)"
/>
```

Building blocks for the options panel: `OptionField`, `OptionSelect`, `QualitySlider`
(`@/components/workbench`) and `Segmented` (`@/components/kit/segmented`). For a layout the
composite does not fit, use `useWorkbench()` with `Dropzone`, `FileList`, `RunBar` and `Results`.
The workbench owns every object URL it creates and revokes them on removal, reset and unmount.

### Engines (`src/engines`, also `ctx.engines`)

All engines are lazy: nothing is downloaded or started until the first call. Every call takes a
signal and terminates its worker when it aborts.

| Engine | API |
| --- | --- |
| `pdf` | `merge(files, { signal, onProgress })`, `imagesToPdf(images, layout, opts)`, `pageCount(file, opts)`, `renderPages(file, { dpi, format, quality, signal, onPage })` (pdf.js, one page at a time), `open(file, { signal, name })` → `PdfPreview` (on-demand thumbnails, pixels, page text; call `close()`), `pages.*` (page structure, below) |
| `image` | Decodes with the browser (libheif for HEIC; EXIF/HEIF orientation applied; HEIC/AVIF tagged only with nclx colour code points get a matching Display P3 / BT.2020 profile), encodes jpeg/webp/avif with WebAssembly (MozJPEG, libwebp, libavif from `/vendor/jsquash`), png with a fast TypeScript writer (or oxipng with `effort: 'smallest'`), gif with gifenc, plus bmp/ico, resamples with Lanczos3 in linear light. Animated GIF/WebP/APNG keep every frame, timing and loop count when written as GIF, WebP or PNG (frames from WebCodecs `ImageDecoder`, or JS decoders where it is missing); other outputs use the first frame. `convert(blob, EncodeOptions, signal, onProgress?)`, `process(blob, { rotate, flipHorizontal, flipVertical, crop, resize, output }, signal, onProgress?)` → `{ blob, width, height, flattened, colour, profile, animated, frames, animationKept }`, `compress(blob, { format: 'keep' \| 'auto' \| …, quality \| targetBytes, maxSide }, signal, { onProgress, cache, proxySide })` (`proxySide` = quick preview on a scaled copy, `proxy: true`), `renditions(blob, specs)`, `encodePixels(imageData, opts)`, `probe`, `dimensions`, `readMetadata`, `stripMetadata` (lossless), `supportedFormats()`. `EncodeOptions`: `format`, `quality`, `background`, `lossless`, `colour: 'keep'` (default: a Display P3 / Adobe RGB profile stays with JPEG/PNG/WebP output; AVIF/GIF/BMP/ICO and CMYK sources are converted to sRGB), `exif` (JPEG only), `animation`, `colours` (GIF), `effort` (PNG). Up to 100 megapixels (about 40 bytes of memory per pixel, measured); animations up to 200 megapixels across all frames. `createImageEngine()` gives a separate worker for live previews. UI pieces in `@/components/image` (`ImageWorkbench`, `CompareSlider`, `CropCanvas`, `OutputOptions`, `useRunNotes`, `withDecodeFallback` for TIFF/TGA via ffmpeg). |
| `media` | Audio and video. Mediabunny 1.65 on WebCodecs first (hardware-accelerated where the device has it; reads the `File` in small ranges and writes output into a disk-backed Blob, so multi-GB inputs work), ffmpeg.wasm as an automatic fallback for what WebCodecs cannot do in this browser. Calls take `{ signal, onProgress }` and resolve to `{ blob, ext, report }`; `report` (`MediaReport`) names the engine (`engine`, `engineLabel`), the typed `fallback` reason if any (`describeFallback(reason)`), what happened to each track, notes and timing. `probe(file)` → `MediaInfo` (container, duration, start time, codecs, display size, rotation, `hdr` ('pq' / 'hlg'), fps, bitrates, `canDecode`); `inspect(file)` is `probe` plus what ffmpeg.wasm reads from files Mediabunny cannot (AVI, WMV/WMA, FLV, MPEG-PS, OGV, 3GP with H.263/AMR, AIFF): `engine: 'ffmpeg'`, codec `label`s, duration, sizes, bitrates. `capabilities()`, `convert(file, ConvertRequest)` (container; video codec / quality preset or bitrate / short-side cap / fps cap / `transform` {rotate, flipHorizontal, flipVertical, crop, frame {width, height, fit cover|contain}} / `discard`; audio codec / bitrate or `'copy'` / sample rate / channels / `level` {normalize LUFS \| gainDb, peakCeiling, fadeIn, fadeOut} / `discard`; `trim { start, end, accurate }`; `speed { factor, keepPitch }`), `trim(file, TrimRequest)` (keeps the file's format; formats only ffmpeg reads are cut by ffmpeg.wasm: fast = stream copy, precise = re-encode), `videoToGif`, `estimateGif`, `gifToVideo`, `merge(files, MergeRequest)`, `frames(file, FramesRequest)` (stills at given times), `thumbnails` and `waveform` (both fall back to ffmpeg.wasm for undecodable input), `previewProxy(file)` (small H.264/AAC copy for the player). Rules it enforces: streams are copied when nothing needs changing (rotation metadata kept; containers without rotation get the turn applied to the frames), resolution and frame rate are never raised (except an explicit `transform.frame`), bitrates never exceed the source's, and a re-encode whose video comes out more than 8% over the asked bitrate is encoded once more with the bitrate scaled down (hardware encoders overshoot on short clips). Fast MP3 cuts copy frames and write the LAME delay/padding, so they start and end on the exact sample; re-encoded MP3 cuts get the same end padding. Ogg audio is always cut by re-encoding (copied Ogg cuts start up to 0.4 s early). HDR sources re-encoded by WebCodecs stay 8-bit with their PQ/HLG tags (reported); the ffmpeg path tone-maps them to SDR BT.709. Platform AAC encoders that only take a few bitrates get the nearest lower one; otherwise Mediabunny's WASM AAC/MP3/FLAC encoders are used. Pure helpers (containers, `planVideo`, `planCompress`, `sameContainer`, `formatTime`, `parseTime`) import without loading Mediabunny; `LoudnessMeter` (`loudness.ts`) measures BS.1770 integrated loudness. UI in `src/components/media`: `MediaWorkbench` (workbench + preview slot + engine report), `runMedia` and `createJobLog` (record each job's report), `MediaPreviewCard` / `MediaPlayer` / `TrimTimeline` (player, frame strip or waveform, in/out handles; with a timeline, formats only ffmpeg reads get frames, waveform and an on-demand playable preview from ffmpeg.wasm), `EngineHint`, and option fields (`VideoQualityField`, `ResolutionField`, `FrameRateField`, `AudioBitrateField`, `SampleRateField`, `AudioChannelsField`). `useMediaInfo(file, deep)` uses `inspect` when `deep`. |
| `ffmpeg` | `run({ input, inputExt, outputExt, extraInputs?, args: (in, out, extra) => string[], signal, onProgress, expectedOutputBytes? })`, `runMany({ …, outputs, args: (in, outs) => string[] })` (several outputs, missing ones come back null) and `inspect({ input, inputExt })` (the log of `ffmpeg -i`). ffmpeg.wasm single-thread core (~31 MB): inputs are mounted read-only (WORKERFS) and read from the File in pieces, so input size is not limited; the output is built in memory (a 300 MB result took about 0.9 GB extra, measured), so jobs whose expected output (default: the input size) is over 1 GB reject with `FfmpegInputTooLargeError` before running. Jobs are queued, temp names are unique and freed afterwards, and a crashed core is replaced on the next job. The core has libx264, libvpx (VP8), mpeg4, wmv2, flv, mpeg2video, h263, libtheora, aac, libmp3lame, libopus (mono only, reliably), libvorbis, wmav2, mp2, flac, PCM, mjpeg/png, and the zscale/tonemap, loudnorm, alimiter, afade filters. Prefer `media` for audio and video; this is for formats only ffmpeg reads (the image tools use it for TIFF/TGA). Presets in `src/engines/ffmpeg/presets.ts`. |
| `archive` | `zip(entries, signal)` and `new ZipWriter()` (`add(name, blob)`, `finish()`) for streaming |
| `mupdf` | MuPDF 1.28 (AGPL, ~10.5 MB wasm from `/vendor/mupdf`, one module worker). Typed operations, never the raw library; every call takes `{ signal, password, onProgress }`. `inspect(file)` → `PdfInfo` (pages, version, encryption method and permissions, metadata), `isEncrypted`, `decrypt(file, password)`, `compress(file, CompressOptions)` → `{ blob \| null, stats }` (`null` = not smaller; presets in `COMPRESS_PRESETS`), `analyzeSize` → `SizeReport`, `repair` / `rasterize` (last-resort picture rebuild) → `{ blob, report }`, `extractText(file, 'plain' \| 'layout')` → one string per page, `extractImages` (stored JPEG/JPX bytes, others as PNG with soft masks as alpha, CMYK → RGB), `redact(file, regions, opts)` → `{ blob, check }` (regions in MuPDF page space or `space: 'user'`; the check re-extracts the output), `checkRedactions`, `toTiff`. `openSession(file)` → `MupdfSession` for interactive tools: `renderPage`, `renderRaw`, `pageText` (positioned lines), `search` (quads), `pageTransform` (user → page space), `close()`. Wrong or missing passwords reject with errors `isPasswordError(err)` recognises. For other batches: `import { isEncrypted, decrypt } from '@/engines/mupdf'`. |
| `qpdf` | qpdf 12 (Apache-2.0, ~1.4 MB, `/vendor/qpdf`). `inspect(file, { password })` → encryption method, permissions, whether a password is needed; `encrypt(file, { userPassword, ownerPassword, permissions, algorithm })` (AES-256 default; passwords are passed as arguments, so commas and spaces are safe), `decrypt(file, password)`, `removeRestrictions(file)`, `repair(file, { password })`. |
| `ghostscript` | Ghostscript 10 (AGPL, ~15.5 MB, `/vendor/ghostscript`). `compress(file, { settings, imageDpi, grayscale, password })` with pdfwrite. Slow and rebuilds the whole file (forms and tags may not survive); compress-pdf only uses it as the optional "maximum" mode and keeps whichever result is smaller. |

Two more engines are imported directly (not in `ctx.engines`):

| Engine | API |
| --- | --- |
| `typesetEngine` (`@/engines/typeset`) | Documents → PDF with real, selectable text. MuPDF's HTML layout (CSS, tables, images as data: URLs, HarfBuzz shaping, bidi; block-level `position:absolute` inside a `position:relative` div works, inline backgrounds work) in its own worker. `render({ blocks, css, page, orientation, fontSize, outline, pageNumbers, title, lang, header, footer, footnotes })` → `{ blob, pages, orientation, bookmarks, fonts, missing }`; `header`/`footer` are `RunningText` (HTML per default/first/even page, `{{PAGE}}`/`{{NUMPAGES}}` filled in, distance from the edge); `footnotes` are set at the bottom of the page whose body links to `#mm-fn-<id>`. `slides(SlidesRequest)` draws a presentation model (from `readPptx` in `src/components/doc-tools/pptx.ts`: shapes, pictures, tables, text boxes) one page per slide; `textBoxes(boxes, css)` lays out boxes of text one per page for drawing into another PDF (Edit PDF embeds them as forms). Shaped scripts get ToUnicode maps rebuilt from the layout's glyph clusters (`tounicode.ts`), so conjuncts copy and search. Blocks: `{ kind: 'html', html }` (sanitised body HTML), `{ kind: 'table', header, rows, align, repeatHeader, zebra, title }` (columns measured, header repeated on every page, 10k rows fine) and `{ kind: 'page-break' }`. Headings become bookmarks, links stay clickable, `orientation: 'auto'` turns the page for wide tables. Fonts: MuPDF's Nimbus and Droid Sans Fallback (CJK) built in; Noto fonts for other scripts, symbols and emoji are fetched from `/vendor/fonts` only when the text needs them and embedded subsetted (`missing` lists characters nothing could show). `reflow(file, { magic, page, fontSize, outline, pageNumbers })` lays out EPUB/FB2/MOBI/XHTML. Helpers: `PAGE_SIZES`, `MARGINS`, `pageGeometry`, `documentCss` (the document theme). |
| `ocrEngine` (`@/engines/ocr`) | Orientation and skew on rendered pages: `analyse(parsePgm(render.image))` (text direction, skew), `rotateGray`, `inkBand`, `unrotateResult`, `evidence` (`orient.ts`); `OcrDocument.rotate(i, deg)` turns a page; `fromImages` reads every page of a multi-page TIFF. Text recognition with Tesseract 5 (tesseract.js 7 worker + LSTM-only core, Apache-2.0, ~2.9 MB wasm from `/vendor/tesseract`; SIMD build when available). `ocrEngine.recognize(image, { langs, dpi, signal, onProgress })` → `OcrResult` (`text`, mean `confidence`, `lines` with word boxes and baselines, in image pixels). `image` is a binary PGM (what `render` gives) or PNG/JPEG with `size`. Languages in `OCR_LANGUAGES` (eng, hin, mar, ben, tam, tel, spa, fra, deu, por, ita, rus, ara; tessdata_best integer models, 0.7–3 MB each, fetched only when chosen, never cached in IndexedDB). `OcrDocument.fromPdf(file, { password })` / `fromImages(bytes[], { sheet })` opens a document in a MuPDF worker; `info(i)` (existing text), `render(i, dpi)`, `addTextLayer(i, toPageLines(result, pageWidth, pageHeight))` (invisible glyphless-font text, any script, correct for /Rotate, crop boxes and sideways scans), `save()`. Page by page, so long scans stay at about one page of memory. |
| `piiEngine` (`@/engines/pii`) | Personal data and privacy (MuPDF in its own worker). Pure detectors `detectPii(text, { categories, words, patterns })` (email, phone incl. Indian, US, UK and French formats with label context ("Invoice no.", amounts and IDs are not phones), cards with Luhn, IBAN mod 97, Aadhaar with Verhoeff, PAN, SSN, IPv4/6, SSN without separators after a label, dates of birth in most written forms and several languages, names and addresses only after labels such as "Name:" / "Address:", custom words and regexes) and `locatePii(chars, page, opts)` (matches → one box per line, wrapped tokens included; `charsFromWords` for OCR words). `scan(file, options)` → per page `textChars`, `images`, `transform`, `hits` (MuPDF page space). `prepareRedaction(file, pages)` → a copy whose text arrays are split into Tj strings: **MuPDF 1.28 shifts the rest of a line left after removing text that starts inside a TJ string**, so call this before `mupdfEngine.redact` (`splitTextArrays` is the pure part). `privacy(file)` → `PrivacyReport` (metadata, XMP, revisions, attachments, scripts, layers, comments, form values, fonts, links, PII counts, text under dark boxes, JPEG pictures with EXIF/XMP/IPTC); `clean(file, CleanOptions)` (also cuts hidden-layer content out of pages and forms, strips picture metadata losslessly, removes the file ID; `layers.ts`). |
| `pdfExtract` (`@/engines/pdf-extract`) | PDF structure for reflowing: `structure(file)` → styled lines, images, links, words and ruling lines per page; `buildDocument(raw, { tables: true, columns: true })` adds `table` blocks (ruled grids with merged columns, aligned-text tables with wrapped cells joined) and reads two- and three-column pages column by column (`findTables`, `readingOrder` in `layout.ts`); `buildDocument(raw, { dropRunning, pageBreaks })` → paragraphs, headings (from sizes), alignment, lists, images, running headers/footers removed; `words(file)` + `detectTable(page)` → rows and columns with numbers parsed; `fixedHtml(file)` → MuPDF's positioned HTML per page. |

### AI (`src/engines/ai`, `src/lib/ai`, `src/components/ai`)

The AI tools are the only ones that may talk to other hosts, and only after the user opts in:

- **On-device models** — `localAi` (`@/engines/ai`, not in `ctx.engines`) runs Transformers.js 4 with
  ONNX Runtime Web (wasm self-hosted in `/vendor/ort`, single-threaded; WebGPU when a real adapter is
  present) in module workers, one per kind of work. Models are listed in `catalog.ts` (repo, licence,
  bytes and dtype per device) and are downloaded from huggingface.co **only** by a call with
  `allowDownload: true`, which the tools make from the `ModelGate` "Download" button (size, host and
  licence shown first). Every other call is cache-only: the worker refuses remote requests and
  rejects with an error `isNotDownloaded(err)` recognises. Files are kept in Cache Storage
  (`metamorpher-models`); `storedModels`, `removeModel`, `removeAllModels` manage them (UI in AI
  settings). Calls: `ensure`, `embed`, `generate` (streams; abort stops between tokens and keeps the
  model loaded), `transcribe` (≤ 30 s of 16 kHz audio), `segment`, `upscale` (tiled, seamless),
  `speak` (Kokoro). In a tool use `useLocalModel(task, defaultKey, prefKey)` + `<ModelGate>`;
  `detectDevice` / `planDevice` pick WebGPU or WebAssembly and explain when a model cannot run.
- **Bring-your-own-key providers** — `streamChat(target, messages, { signal, onText })`,
  `listModels`, `transcribeRemote` (`@/lib/ai/providers`) call Anthropic, OpenAI, Gemini, Groq,
  OpenRouter or any OpenAI-compatible server straight from the browser and throw `AiError`s with a
  `kind` (auth, quota, rate, context, model, network…). Keys live in localStorage
  (`@/lib/ai/settings`, `useAiSettings`, `targetFor`); the settings UI is `/settings/ai` and
  `AiSettingsButton`. Before anything is sent, show exactly what goes where (`AnswerModePanel`
  does this for the document tools; `useAnswerer` + `answerWith` switch between device and key).
- Shared helpers: `loadDocument` (PDF/DOCX/TXT/MD → text per page), `rag.ts` (passages, BM25,
  optional embeddings, citations), `summarize.ts` (map-reduce), `audio.ts` (WAV, silence-aware
  windows, SRT/VTT), `chat-store.ts` (chat history per document in IndexedDB — questions, answers
  and page numbers only).

The document tools share `src/components/doc-tools`: `DocToPdfTool` (workbench + paste box + page
setup + results, for "X to PDF" tools; image files in the list are resources documents refer to by
name), `docToPdfJob(prepare)`, `prepareMarkdown` / `prepareHtmlFile` / `prepareText` / `prepareDocx`
(input → engine blocks), `prepareHtml` (DOMPurify, images inlined, remote URLs never fetched, page
breaks), `docxToHtml` (own OOXML reader), `readWorkbook` (SheetJS), `parseCsv`, `decodeText`
(UTF-8/UTF-16/Windows-1252), and writers for the other direction: `writeDocx`, `modelToHtml`,
`modelToEpub`, `writePptx`.

Shared pieces for tools built on these engines live in `src/components/pdf-tools`: `ToolFrame` (the
workbench layout with tool-specific results and inline per-file errors), `ResultRows` (downloads
with verification notes), `PasswordInput` and `EngineNote` ("Loads a 10 MB engine once").

**A tool-specific worker** stays in the tool folder: write `src/tools/<slug>/x.worker.ts` that
calls Comlink's `expose(api)`, and wrap it with
`new WorkerHost<Api>(() => new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' }))`
from `@/engines/worker-host`. Keep the `new Worker(new URL(...))` expression literal so the
bundler can find the worker. Adding a method to a shared engine is a shared-file change; prefer a
tool-local worker unless several tools need it.

### PDF page stage (`src/components/pdf-stage`)

For tools that show a PDF page and place things on it (stamping, signing, forms). Geometry lives
in `src/engines/pdf-stamp/geometry.ts` and is shared with the stamping worker, so what the stage
shows and what the worker writes use the same math. Three coordinate systems: **user space** (the
PDF's own points, y up, where content is drawn), the **reader frame** (the visible crop box after
`/Rotate`, points, origin bottom-left) and the **view** (CSS pixels from the page's top-left).

```tsx
<PdfStage
  file={blob}                       // pdf.js renders it; null shows `placeholder`
  page={page} onPageChange={setPage}
  pageCount={n} renderPage={0}      // optional: navigate n pages while drawing page 0 of `file`
  formFields="hide"                 // leave widgets out of the canvas (HTML inputs go on top)
  overlay={(view) => <StageItem view={view} placement={p} onChange={setP} label="Signature">…</StageItem>}
  onPagePointerDown={(userPoint, view) => {}}
  onViewChange={(view) => {}}       // after geometry/zoom changes (keep it in a ref for "add" buttons)
  busy={…} error={…} toolbar={…}
/>
```

- `StageView`: `pageIndex`, `scale` (CSS px per point), `width`/`height` (px), `frame` (`PageFrame`:
  visible `box` in user space, `rotation`, reader `width`/`height`, `matrix` reader → user), and
  `toView(x, y)` / `toUser(px, py)`. Non-zero box origins and all four rotations are handled.
- `StageItem` drags, resizes from the corners (aspect locked by default) and rotates from the top
  handle; arrow keys nudge, Delete removes. Its `Placement` is `{ cx, cy }` in user space plus
  `width`, `height` (points, upright as the reader sees it) and `rotation` (degrees, clockwise on
  screen). `placementMatrix(placement, pageRotation)` turns it into the `cm` for drawing a
  `width × height` box, which is what `pdfStamp.placeOverlays` does.
- `PreviewWorkbench` is the workbench layout plus a live preview: give it a module-scope
  `preview(options, { file, index, files, page })` that returns a `PreviewRequest` (or null for the
  unchanged page); the stamping worker processes that one page and the stage shows the result, so
  the preview is the real output.
- `usePdfDocument(file)` opens a file with pdf.js (keeping the previous document while the next one
  opens) and `openPdfDocument` / `renderPageToPng` are the one-off forms. Encrypted files reject
  with the shared "remove the protection first" message.
- Option controls shared by the stamping tools: `TextStyleFields`, `PositionGrid`, `PageRangeField`,
  `NumberInput`, `RangeField`, `SwitchRow`, `ImagePicker`, `BlobImage`.

The stamping engine (`@/engines/pdf-stamp`, `pdfStamp.*`) is not in `ctx.engines`; import it
directly. It adds content as new content streams (never rasterising), measures everything against
the visible box, and writes non-WinAnsi text with Liberation Sans served from `/vendor/pdfjs`.

### PDF page tools (`src/components/pdf-pages`)

For tools that pick, reorder or transform whole pages (split, extract, rotate, organize, crop …).
The page structure work is `ctx.engines.pdf.pages` (pdf-lib in its own worker; content is copied or
wrapped in a transform, never rasterised; encrypted files reject with a message containing
`PASSWORD_PROTECTED`):

| Call | Does |
| --- | --- |
| `inspect(file)` | `{ pageCount, outline }` (flattened bookmarks: `title`, `level`, 0-based `page`) |
| `rewrite(file, specs)` | One file in place: new order, duplicates, deletions and per-page transforms. Keeps forms, tags (unless pages are removed), layers, attachments; re-points bookmarks and links, drops those to removed pages. |
| `assemble(files, groups)` | One new PDF per group from pages of several files (split, extract, mix). Keeps bookmarks and links that stay inside a group, and form fields on the copied pages. |
| `splitBySize(file, maxBytes)` | Consecutive parts under a size; `oversized` marks a single page that is larger on its own. |
| `nup(file, options)` | Several pages per sheet as vector form XObjects (links and bookmarks are not carried over). |

A `PageSpec` is `{ file?, page, rotate?, crop?, flip?, resize? }`: `crop` takes margins measured on
the page as displayed (fractions, or points with `unit: 'pt'`) and sets the CropBox; `resize` puts
the page on a sheet of the given displayed size (`fit` scales it). Every call takes
`{ signal, onProgress }`; wrap progress with `withProgress(ctx, map, run)` so a late callback cannot
flip a finished file back to "running".

The UI pieces, from `@/components/pdf-pages`:

- `PageToolLayout` is the workbench frame for page tools (files, page grid, options, run bar,
  results). Give it `wb` from `useWorkbench`, the preview states in `docs`, `runLabel`,
  `disabledReason`, `optionsPanel` and the grid as children. It shows a skeleton while files open
  and `PdfProblem` (with a link to the unlock tool for encrypted files) instead of the grid.
- `usePdfPreview(input)` / `usePdfPreviews(files)` open each file with pdf.js and `inspect` it:
  `{ status, preview, pageCount, outline, error }`, closed when the file leaves the list.
- `PageGrid` shows lazily rendered thumbnails (only near the viewport, newest request first, so a
  500-page file stays responsive). Tiles are `GridPage`s (`key`, `preview`, `index`, `rotation`,
  `flip`, `label`, `tone`, `badge`); `docPages(preview, count, decorate)` builds them for one file.
  Optional: `selected` + `onSelectedChange` (click, Shift-click, Ctrl+A, keyboard), `onMove`
  (drag or Alt+arrows), `actions` (hover buttons; use `TileAction`) and `overlay` (drawn over the
  page as displayed, in percentages). It skips re-rendering while `disabled` and unchanged.
- `parsePageRanges(text, total)` turns "1-3, 8, 12-, last, odd" into 0-based ranges with a
  readable `error`; `parsePageSelection`, `formatPageRanges`, `pagesLabel` ("pages-1-3_8" for file
  names), `chunkPages`, `toRuns`. `PageRangeInput` binds a range field to a `Set<number>`.
- `buildParts(ctx, file, parts)` runs `assemble` for `{ pages, name }[]` with progress and unique
  names; `outputName(file, suffix)` gives `report_pages-1-3.pdf`; `partStarts` / `partOfPage` make
  grid badges and tones.
- `usePageTexts(preview)` reads every page's text in the background (cached per document);
  `containsPhrase(text, phrase, matchCase)` matches forgivingly (whitespace, split words).
- `useScopedState(initial)` is state that resets when a file changes (call `sync(scope, init)` in
  render); `SwitchRow`, `NumberInput` are compact option controls.

### Business tools (`src/components/business`)

For tools that build a document from a form (invoice, receipt, résumé):

- `money.ts`: integer minor units with exact decimal maths (`productMinor`, `percentOf`), `formatMinor`,
  `CURRENCIES`, `indianWords` (lakh/crore), `westernWords`, `amountInWords`.
- `qr.ts`: `qrMatrix(text, ecc)` (uqr, MIT), `drawQr`, `qrSvg` (square, rounded or dot modules, logo hole),
  `qrPngDataUrl`, `upiLink`, `isUpiId`.
- `html.ts`: helpers for HTML that the `typeset` engine lays out (`esc`, `cellWidth` because MuPDF sizes
  cells by their content box, `fitBox`, `sizeImage`, `imageFileToDataUrl`) and `previewDocument` for the
  same markup in an iframe. `breakLigatures(html)` keeps "fi"/"fl"/"ff" as plain letters in the PDF text
  (MuPDF's built-in fonts would otherwise write U+FB01, which search and applicant tracking systems miss).
  MuPDF's HTML layout has no floats, flexbox, percentage cell widths or `text-transform`; use tables
  with widths in points. A table row cannot break across pages, so give long content one row per entry,
  and keep a heading together with the first entry in one row (a block's border otherwise stays behind
  at the foot of the old page). `rowspan` works, as long as nothing follows the table.
- `html-preview.tsx`: `HtmlPreview` (scaled iframe, page guides, `onMeasure` for page-fit estimates).
- `fit-page.ts`: `contentBottom`, `cropTop`, `pageToPng` for documents laid out on one tall page
  (receipts cut to length).
- `form-bits.tsx`: `TextField`, `AreaField`, `SelectField` (native select), `Field`, `JsonButtons`
  (save/open a form as JSON), `fileStem`, `blobToDataUrl`.

The first render of a tool also happens on the server: keep it deterministic (no random ids in DOM
attributes, no dates from the clock). Fill dates and restore browser storage in a mount effect.

### Viewers (`src/components/viewer`)

The "View & play" tools only read files. Each is a one-line tool around `ViewerFrame`:

```tsx
<ViewerFrame tool={tool} kinds={['table']} as="table" intro="What it shows." />
```

- `sniffFile(file)` (`sniff.ts`) reads at most 128 KB and says what the file **is**, from magic bytes and
  text shape, with the extension only as a tie-breaker: a `ViewKind` (`table`, `data`, `text`,
  `markdown`, `hex`, `pdf`, `document`, `image`, `video`, `audio`, `archive`, `font`, `sqlite`,
  `subtitle`), a format name, the canonical extension and MIME type, the guessed text encoding,
  `mismatch` (the name says otherwise) and `unsupported` (recognised but not viewable: 7z, RAR, .doc).
- `ViewerFrame` owns drop/browse/paste, the info bar, fullscreen, file switching, "View as", the
  shortcut help and the "Open with" strip. `kinds` are the kinds the tool is about (others get a
  pointer to the right viewer); `as` forces a viewer for accepted text files (or any file, for `hex`).
- `KindViewer` (`viewers.tsx`) lazy-loads one chunk per viewer; each receives `ViewerProps`
  (`file`, `sniff`, `files`, `index`, `onIndex`). Viewers register their keys with
  `useShortcuts(list)` (shown in the help) and handle them with `useKeys(handler)`, which stays quiet
  while someone types or a menu is open. `useVirtualScroll` scrolls content taller than browsers allow
  (millions of rows) and is what the grid, tree, hex and archive lists use.
- `toolsFor(file, sniff)` lists every available tool whose `accept` matches the file or what it really
  is; `handOff(slug, files, navigate, VIEWER_SLUGS)` moves files to another page in memory: viewers take
  them with `takeHandoff`, any other tool receives them as a paste on its drop zone. The home page uses
  the same pieces (`HomeDrop`).
- Heavy work lives in per-viewer workers: `table/table.worker.ts` (streaming CSV parser on UTF-8 bytes,
  one byte pool per column, sort, filter, search, stats, export) and `data/data.worker.ts` (JSON, YAML,
  TOML, XML and NDJSON as a flat node table) and `sqlite/sqlite.worker.ts` (sql.js, MIT, ~0.7 MB wasm from
  `/vendor/sqljs`, opened with `PRAGMA query_only`). Pure parts (`table/engine.ts`, `data/tree.ts`,
  `archive/formats.ts`) run in Node too, for benchmarks.
- To add a viewer: write `src/components/viewer/<kind>/<name>.tsx` (default export taking
  `ViewerProps`), point its kind at it in `viewers.tsx`, set its tool in `kinds.ts`, and register a
  tool folder that renders `ViewerFrame`.

### Workflow steps (`src/tools/workflow-builder/steps.ts`)

The workflow builder runs a list of `PipelineStep`s as one batch `Job`: each step's outputs become the
next step's inputs. A step is a workbench `Job<Options>` with a plain, JSON-safe options object, plus
`input`/`output` kinds (`pdf`, `image`, `any`, `zip`), `defaults`, `fields` (text, number or select;
`secret: true` fields are never saved), `summary` and an optional `check`. Steps call the shared engines
directly, like the single-purpose tools do. To offer another operation in workflows, add a step there;
no other code changes.

### LaTeX (résumé builder)

`src/tools/resume-builder/latex` runs pdfLaTeX from TeX Live 2026 (BusyTeX WebAssembly build,
AGPL-3.0-or-later) in a module worker. `scripts/latex/build-texmf.mjs` downloads the pinned engine
and the TeX Live data packages (checksummed), keeps only the files listed in
`scripts/latex/texmf-files.txt` (from `-recorder` runs of the shipped templates, plus whole package
directories and trimmed font families), and writes `vendor/latex/` (≈ 32 MB wasm + 28 MB TeX tree,
≈ 27 MB over the wire compressed). `copy-runtime-assets.mjs` copies it to `public/vendor/latex`.
To add a package: add its files to `texmf-files.txt` (or the directory to the subset), run the build
script, and list it in `AVAILABLE_PACKAGES` (`latex/templates.ts`).

## Rules

- `index.tsx` starts with `'use client'`. Do not touch `window`, `document` or workers at module
  scope: pages are prerendered on the server. Import heavy libraries inside functions or workers.
- **Files never leave the device.** No network requests with file data, no third-party scripts or
  CDNs. Large runtime assets (wasm, models) are served from this origin under `public/vendor`,
  copied from `node_modules` by `scripts/copy-runtime-assets.mjs` (a shared file: coordinate).
  The two exceptions are the AI tools' opt-ins described above: downloading a model from
  huggingface.co after the user presses Download, and sending text or audio to a provider with the
  user's own key after the UI has said what is sent where.
- Do not persist file contents (localStorage, IndexedDB, caches).
- The repo is AGPL-3.0-or-later and public, so AGPL/GPL/LGPL engines are allowed. Not allowed:
  anything proprietary, source-unavailable or "non-commercial only" (including model weights).
- Only flip a tool to `available` when it works end to end. Unfinished tools stay `planned`.
- Code style: TypeScript strict, no `any`. `npm run typecheck`, `npm run lint` and
  `npm run build` must pass.
