# Metamorpher

Private file tools that run entirely in your browser. Convert images, video, audio and documents
and work with PDFs without uploading anything: every file is processed on your device.

## Tools

110 tools are available now; the list lives in
[`src/tools/registry.ts`](src/tools/registry.ts).

| Area | Tools | Engines |
| --- | --- | --- |
| PDF pages | Merge, split (by range, size, bookmarks, text, in half), delete, extract, organize, rotate, flip, n-up, crop and resize, alternate and mix, PDFs to ZIP | pdf-lib (`@cantoo/pdf-lib`), pdf.js |
| PDF edit and annotate | Edit PDF (add text in any script the Noto fonts cover, shaped and with subsetted fonts, images, shapes, arrows, drawing, highlight, whiteout; existing text is not editable yet), watermark, page numbers, sign, headers and footers, Bates numbering, flatten, edit metadata, fill form, invert colours | pdf-lib, pdf.js, signature_pad |
| PDF optimise and security | Compress, encrypt, remove password, unlock, redact, auto-redact personal data (emails, phones with context, cards, IBAN, Aadhaar, PAN, SSN, dates of birth, labelled names and addresses; OCR in 13 languages for scans), redaction checker, privacy scanner and cleaner (also hidden layers, the file ID and EXIF/XMP inside pictures), repair, size analyzer, file hash | MuPDF, qpdf, Ghostscript (all WASM) |
| Scan, OCR and compare | OCR / searchable PDF and image to text (13 languages incl. Hindi, Marathi, Bengali, Tamil, Telugu; pages turned upright and straightened automatically; multi-page TIFF), scan document (camera or photos: page borders found by edges or brightness, perspective fix, filters), compare PDFs (word diff that can ignore case, punctuation and spacing, pixel diff, full report) | Tesseract 5 (tesseract.js 7 core, WASM), MuPDF |
| Convert to PDF | Images, Markdown, HTML, text, CSV, Word (.docx, layout approximated: headers, footers, page numbers, tab stops, footnotes), PowerPoint (.pptx: one page per slide with real text; charts not drawn), Excel/ODS, EPUB/FB2/MOBI to PDF; create a PDF; convert document | pdf-lib, MuPDF HTML layout with Noto fonts (selectable text, bookmarks), SheetJS CE |
| Convert from PDF | PDF to JPG/PNG, TIFF, text, Word, HTML and EPUB (tables and multi-column pages), Excel (ruled and aligned tables, wrapped cells joined), PowerPoint (editable text over the page graphics, or page pictures); extract images; PDF to audio (read aloud with system voices, or MP3/WAV with an on-device voice) | pdf.js, MuPDF, SheetJS CE, Kokoro-82M |
| Image | Convert, compress, resize, crop, HEIC to JPG, strip EXIF, SVG to PNG, favicon/ICO; remove background and upscale 2×/4× (on-device models) | jSquash codecs (MozJPEG, oxipng, libwebp, libavif), heic-to; ORMBG / BiRefNet lite / MODNet, Swin2SR |
| Audio and video | Convert video, convert audio, compress video, trim and cut (also AVI, WMV, FLV, MPEG, OGV, 3GP, WMA), extract audio, mute, video to GIF, GIF to video, change speed, merge clips, adjust volume (LUFS normalise, gain, fades), rotate & crop, resize for social media, video to images | Mediabunny (WebCodecs), ffmpeg.wasm fallback |
| AI | Chat with PDF (answers with page citations; PDF, Word, Markdown, text), summarize PDF (short, detailed, bullets, per chapter), transcribe audio and video (TXT/SRT/VTT) | Transformers.js + ONNX Runtime Web (WebGPU or WASM): Qwen2.5 / SmolLM2, all-MiniLM-L6-v2, Whisper; or your own API key for Anthropic, OpenAI, Gemini, Groq, OpenRouter or an OpenAI-compatible server (Ollama, LM Studio) |
| Business and everyday | Invoice generator (India GST: GSTIN check, CGST+SGST/UTGST or IGST, HSN summary, amount in words with lakh/crore, UPI QR; or any currency), POS receipts (58/80 mm PDF and PNG cut to length), résumé builder (form with four ATS-friendly templates, or real LaTeX with five templates compiled in the browser), text to handwriting, whiteboard, QR codes and barcodes (make and read) | typeset (MuPDF HTML layout), BusyTeX (TeX Live 2026 pdfLaTeX in WebAssembly), CodeMirror 6, uqr, jsQR, JsBarcode, perfect-freehand |
| View and play | Open any file (type read from its content, then the matching viewer and every tool that takes it); CSV and spreadsheet viewer (a million rows: sort, filter, search, column statistics, export the view); JSON, YAML, XML, TOML and NDJSON tree; text and code (50+ languages, huge logs in parts); Markdown; hex; PDF reader (thumbnails, bookmarks, search, presentation mode, passwords); Word, PowerPoint and e-book viewer (EPUB, FB2, MOBI); image viewer (HEIC, TIFF, EXIF and GPS, histogram, colour picker, animation frames, gallery, compare); media player (AVI, MKV, WMV, FLAC…: speed, A–B loop, frame steps, subtitles, volume boost, playlist); archive viewer (ZIP, TAR, GZ; preview inside, extract, ZIP passwords); subtitle viewer (SRT, VTT, ASS: reading-speed and overlap checks); font viewer (TTF, OTF, WOFF, WOFF2); SQLite viewer (read-only tables, schema and SELECT queries) | pdf.js viewer, CodeMirror 6, SheetJS CE, js-yaml, smol-toml, markdown-it + DOMPurify, MuPDF (typeset), Mediabunny + ffmpeg.wasm, fflate, sql.js |
| Share and automate | P2P file share (WebRTC data channel, codes copied or scanned, no server), workflow builder (chain images to PDF, merge, rotate, page numbers, watermark, compress, encrypt, image resize/convert, ZIP) | WebRTC, the engines above |

## Development

Requires Node 24 and npm.

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm run build      # next build, then serwist build (offline service worker)
npm start
```

`predev`/`prebuild` run `scripts/copy-runtime-assets.mjs`, which copies the ffmpeg.wasm core
and worker, pdf.js data, the image codecs, the MuPDF, qpdf and Ghostscript wasm files, the Noto document fonts and the ONNX Runtime Web wasm into `public/vendor` (gitignored) so they are served from this origin. It
fails if `@ffmpeg/core` does not match the version `@ffmpeg/ffmpeg` expects.

Set `NEXT_PUBLIC_SITE_URL` in production for canonical URLs and the sitemap (on Vercel the
production domain is used automatically).

## Backend (optional): accounts, sync, statistics, admin

The tool site needs no server. An optional backend adds accounts (email + password), opt-in sync
of starred/recent tools, run history and Chat with PDF conversations, first-party anonymous usage
statistics and an admin dashboard. It never receives files.

**Master switch.** Everything below is off unless `ENABLE_BACKEND=1`. With it off (the default in
production) the build has no account button, account pages say accounts are unavailable, `/admin`
is a 404, `/api/*` answers 503 and pages send no statistics. `NEXT_PUBLIC_*` switches are computed in
`next.config.ts` at build time, so redeploy after changing `ENABLE_BACKEND`, `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `RESEND_API_KEY`/`EMAIL_FROM` or `ANALYTICS_DISABLED`. Every variable is
documented in [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `ENABLE_BACKEND` | `1` turns the backend on. |
| `DATABASE_URL` | Neon Postgres connection string. In development it can be left out: an embedded PGlite database is created in `.data/` (gitignored) and migrated automatically. |
| `BETTER_AUTH_SECRET` | Long random string that signs sessions and tokens (required in production). |
| `BETTER_AUTH_URL` | Public origin for email links and the CSRF origin check (defaults to `NEXT_PUBLIC_SITE_URL`). |
| `ADMIN_EMAILS` | Comma-separated emails allowed into `/admin`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email via Resend. Without them, development prints links to the console and `.data/dev-mail.log`; production allows sign-up without verification and hides password reset (shown as a warning in /admin/system). |
| `CRON_SECRET` | Bearer secret for the daily rollup route Vercel Cron calls (`vercel.json`). |
| `ANALYTICS_DISABLED` | `1` switches usage statistics off. |

### Connecting Neon

1. Create a Neon project (free tier) and copy its connection string (`postgres://…?sslmode=require`).
2. On Vercel, set `ENABLE_BACKEND=1`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ADMIN_EMAILS`,
   `CRON_SECRET` and, for email, `RESEND_API_KEY` and `EMAIL_FROM` (Production and Preview).
3. Apply the migrations from your machine: `DATABASE_URL='postgres://…' npm run db:migrate`
   (or put `DATABASE_URL` in `.env.local`, which is gitignored, and run `npm run db:migrate`).
4. Redeploy. Check `/admin/system`: database connected, migrations up to date, no warnings.

Schema changes: edit `src/server/db/schema.ts`, run `npm run db:generate` (writes SQL to
`drizzle/`), commit it, then `npm run db:migrate` against Neon before deploying. Locally, the dev
server applies new migrations to PGlite on start (`npm run db:migrate` also works with the dev server
stopped; PGlite allows one process at a time).

### How it is built

- **Auth**: Better Auth with the Drizzle adapter (`src/server/auth.ts`, route `/api/auth/*`): sign-up
  with email verification, sign-in, sign-out, password reset, change password, sessions list and
  revoke, delete account (cascades to every row). Passwords: at least 10 characters, not a common
  password or a simple sequence, not containing the email. Rate limits are stored in the database
  (sign-in 5/min, sign-up 10/h, reset and verification emails 3/15 min per IP; the IP comes from
  `x-forwarded-for`, which Vercel sets itself). Cookies are httpOnly, `SameSite=Lax`, `Secure` in
  production; Better Auth checks the Origin of every POST and `/api/me/*` mutations require a
  same-origin request. Sessions keep a coarse device label ("Chrome on Windows"), never the IP.
- **Static pages stay static**: no layout reads cookies or headers. The account button and account
  pages render on the client; signed-out visitors make no account requests (a local hint, set at
  sign-in, tells the top bar to load the account). Only `/admin` renders per request.
- **Sync** (`src/lib/account/sync.ts`, loaded only for signed-in browsers; every switch off by
  default on `/account`): starred/recent tools with a three-way merge, run history recorded from the
  workbench's run events (`src/lib/events.ts`), and Chat with PDF conversations through the chat
  store (`src/lib/ai/chat-store.ts`). `/history` lists and deletes runs and conversations;
  `/api/me/export` downloads everything as JSON.
- **Statistics** (`src/lib/analytics/beacon.ts` → `/api/e` → `src/server/analytics.ts`): after the
  page is idle, `sendBeacon` posts page paths and tool events (opened, started, succeeded, failed with
  a short error category, cancelled; duration and a size bucket). No cookies or browser storage IDs;
  the server stores no IP or user-agent string, only coarse browser/OS/device class, the country
  from Vercel's geo header, the referring host, and a visitor key hashed with a random salt that is
  replaced daily (old salts deleted). Do Not Track, Global Privacy Control, the footer's
  "Usage statistics" switch and automation (webdriver, bot user agents) all stop it. Raw events are
  rolled up into `analytics_daily` by `/api/cron/rollup` (daily, `CRON_SECRET`) and deleted after
  three days. Visitors are daily uniques: the rotating key cannot link days.
- **Admin** (`/admin`, `src/app/admin`): Overview, Tools (with per-tool trend), Audience, Users
  (search, disable/enable, sign out, delete; no impersonation) and System (database, migrations, email,
  warnings, last rollup, row counts). Every page and server action checks `ADMIN_EMAILS` on the server
  and returns 404 to anyone else. Charts are small hand-written SVG (no chart library).

## Structure

```
src/
  app/                  routes: dashboard, /tools/[slug], /category/[slug], /recent, /starred,
                        sitemap, robots, not-found; globals.css and colors.css (all colour tokens)
  components/
    ui/ kit/ layout/    design system and app shell (ported from the Bridge dashboard)
    workbench/          shared tool frame: dropzone, file list, options, run bar, results, job types
    tools/              tool cards, grid, tool host, star button
    viewer/             the shared viewer frame (content sniffing, open with, hand-off) and one folder per viewer
  engines/              pdf, mupdf, qpdf, ghostscript, image, media, ffmpeg, archive, typeset (document → PDF)
                        and pdf-extract (PDF → Word/HTML/EPUB/Excel) engines (workers behind Comlink)
  tools/                registry.ts, categories.ts, types.ts and one folder per tool
  lib/                  file helpers, theme colour, starred/recent storage, site constants,
                        account client (lib/account), statistics beacon (lib/analytics), events bus
  server/               optional backend: config, Drizzle schema and connection, Better Auth, mail,
                        sync data access, analytics ingest/rollup, admin queries (server-only)
  sw.ts                 service worker source (Serwist)
drizzle/                SQL migrations (generated)
docs/ADDING_A_TOOL.md   how to add a tool
```

To add a tool, read [docs/ADDING_A_TOOL.md](docs/ADDING_A_TOOL.md): one folder plus one registry
entry.

## Privacy

There is no server-side file processing. Starred and recently opened tools are kept in your browser's
local storage (tool names only, never files). No third-party scripts are loaded, and the app makes
no requests to other sites, with three exceptions that happen only after you choose them:

- **Connecting two devices in P2P file share across networks.** Turning on the STUN helper (off by
  default) makes both browsers ask stun.l.google.com for their public address. Files never go there;
  they travel directly between the browsers, encrypted.
- **Downloading an on-device model.** Pressing a model's Download button (which shows its size,
  licence and host first) fetches it once from huggingface.co; Hugging Face sees your IP address,
  never your files. Models stay in this browser's storage for offline use and can be removed in
  AI settings (/settings/ai). After that, the model runs entirely on your device.
- **Using your own API key.** If you add a key for Anthropic, OpenAI, Google Gemini, Groq,
  OpenRouter or an OpenAI-compatible server, the tool sends what it says it sends (for chat and
  summaries, your question and the relevant passages or parts of the document; for transcription,
  the audio track) directly from your browser to that provider, under its data policy. Keys are
  stored only in this browser's local storage and are sent only to the provider they belong to.

Finding the relevant passages for a question always happens on your device. Chat history is kept
in this browser's IndexedDB (questions, answers and page numbers, not the documents) until you
clear it.

When the optional backend is switched on (see above), accounts store an email, name, password hash
and opt-in sync data (tool names, run metadata with file names only if the user allows it, chat
text and citations), and pages send anonymous usage statistics as described there. The full,
user-facing description is the `/privacy` page.

## License

AGPL-3.0-or-later, see [LICENSE](LICENSE). If you run a modified version as a public service, you
must make its source available to its users. Bundled engines include MuPDF and Ghostscript (AGPL),
the ffmpeg.wasm core (GPL-2.0-or-later) and libheif (LGPL), each served as a separate file. The
document fonts (Noto, Carlito, Caladea) are under the SIL Open Font License 1.1; SheetJS Community
Edition is Apache-2.0. Transformers.js and ONNX Runtime Web are Apache-2.0 and MIT; the PDF to audio
tool bundles eSpeak NG (GPL-3.0, via the `phonemizer` package). On-device model weights are
downloaded separately and are all licensed for commercial use: Qwen2.5 0.5B/1.5B Instruct,
SmolLM2, Whisper, ORMBG, Swin2SR, Kokoro-82M, all-MiniLM-L6-v2 and MODNet (Apache-2.0) and
BiRefNet lite (MIT).

Made by [Kroszborg](https://www.kroszborg.co/).
