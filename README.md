# Metamorpher

Private file tools that run entirely in your browser. Convert images, video, audio and documents
and work with PDFs without uploading anything: every file is processed on your device.

## Tools

92 tools are available now; the list lives in
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
| Audio and video | Convert video, convert audio, compress video, trim and cut, extract audio, mute, video to GIF, GIF to video, change speed, merge clips | Mediabunny (WebCodecs), ffmpeg.wasm fallback |
| AI | Chat with PDF (answers with page citations; PDF, Word, Markdown, text), summarize PDF (short, detailed, bullets, per chapter), transcribe audio and video (TXT/SRT/VTT) | Transformers.js + ONNX Runtime Web (WebGPU or WASM): Qwen2.5 / SmolLM2, all-MiniLM-L6-v2, Whisper; or your own API key for Anthropic, OpenAI, Gemini, Groq, OpenRouter or an OpenAI-compatible server (Ollama, LM Studio) |
| Business and everyday | Invoice generator (India GST: GSTIN check, CGST+SGST/UTGST or IGST, HSN summary, amount in words with lakh/crore, UPI QR; or any currency), POS receipts (58/80 mm PDF and PNG cut to length), résumé builder (form with four ATS-friendly templates, or real LaTeX with five templates compiled in the browser), text to handwriting, whiteboard, QR codes and barcodes (make and read) | typeset (MuPDF HTML layout), BusyTeX (TeX Live 2026 pdfLaTeX in WebAssembly), CodeMirror 6, uqr, jsQR, JsBarcode, perfect-freehand |
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

## Structure

```
src/
  app/                  routes: dashboard, /tools/[slug], /category/[slug], /recent, /starred,
                        sitemap, robots, not-found; globals.css and colors.css (all colour tokens)
  components/
    ui/ kit/ layout/    design system and app shell (ported from the Bridge dashboard)
    workbench/          shared tool frame: dropzone, file list, options, run bar, results, job types
    tools/              tool cards, grid, tool host, star button
  engines/              pdf, mupdf, qpdf, ghostscript, image, media, ffmpeg, archive, typeset (document → PDF)
                        and pdf-extract (PDF → Word/HTML/EPUB/Excel) engines (workers behind Comlink)
  tools/                registry.ts, categories.ts, types.ts and one folder per tool
  lib/                  file helpers, theme colour, starred/recent storage, site constants
  sw.ts                 service worker source (Serwist)
docs/ADDING_A_TOOL.md   how to add a tool
```

To add a tool, read [docs/ADDING_A_TOOL.md](docs/ADDING_A_TOOL.md): one folder plus one registry
entry.

## Privacy

There is no server-side processing. Starred and recently opened tools are kept in your browser's
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
