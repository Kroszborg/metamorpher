// pdf.js's own parsing worker, bundled from node_modules and served from this
// origin (never a CDN). Importing it in a worker context starts its message handler.
import '@/lib/polyfills';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
