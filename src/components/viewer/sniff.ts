/**
 * Content sniffing for the viewers: what a file really is, from its first and
 * last bytes, with the extension only as a tie-breaker. Pure functions plus
 * `sniffFile`, which reads at most 128 KB of the file.
 */

/** Which viewer shows a file. */
export type ViewKind =
  | 'table'
  | 'data'
  | 'markdown'
  | 'text'
  | 'hex'
  | 'pdf'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'font'
  | 'sqlite'
  | 'subtitle';

export type Sniffed = {
  kind: ViewKind;
  /** Short format name for people: "CSV", "PNG", "Matroska video". */
  format: string;
  /** Canonical extension for the detected format, without the dot. */
  ext: string;
  mime: string;
  /** The file's own extension disagrees with its content. */
  mismatch: boolean;
  /** Recognised, but no viewer here can show it (legacy .doc, RAR…); `kind` is the fallback. */
  unsupported?: string;
  /** For text: the encoding guessed from the sample. */
  encoding?: string;
};

const SAMPLE = 64 * 1024;

const ascii = (b: Uint8Array, o: number, n: number) => {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]!);
  return s;
};
const starts = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v);

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

type Guess = Omit<Sniffed, 'mismatch'>;
const g = (kind: ViewKind, format: string, ext: string, mime: string, extra: Partial<Guess> = {}): Guess => ({
  kind,
  format,
  ext,
  mime,
  ...extra,
});

/** Extensions that are all the same format, so "x.jpeg" holding a JPEG is no mismatch. */
const SAME: Record<string, string[]> = {
  jpg: ['jpg', 'jpeg', 'jfif', 'jpe'],
  tif: ['tif', 'tiff'],
  heic: ['heic', 'heif', 'hif'],
  mp4: ['mp4', 'm4v', 'mp4v', 'f4v', 'm4p'],
  m4a: ['m4a', 'm4b', 'mp4', 'aac'],
  mkv: ['mkv', 'mka', 'mks', 'mk3d'],
  webm: ['webm', 'weba', 'mkv'],
  ogg: ['ogg', 'oga', 'ogv', 'opus', 'spx', 'ogx'],
  mpg: ['mpg', 'mpeg', 'vob', 'mpe', 'm2p'],
  ts: ['ts', 'm2ts', 'mts', 'tsv'],
  zip: ['zip', 'jar', 'apk', 'xpi', 'cbz', 'ipa', 'nupkg', 'vsix', 'whl', 'aar', 'kmz', 'xps', 'oxps', '3mf'],
  gz: ['gz', 'tgz', 'gzip'],
  tar: ['tar'],
  html: ['html', 'htm', 'xhtml', 'shtml'],
  yaml: ['yaml', 'yml'],
  md: ['md', 'markdown', 'mdown', 'mkd', 'mdx'],
  txt: ['txt', 'text', 'log'],
  aiff: ['aiff', 'aif', 'aifc'],
  ttf: ['ttf', 'otf'],
  otf: ['otf', 'ttf'],
  ndjson: ['ndjson', 'jsonl'],
  json: ['json', 'geojson', 'webmanifest', 'har', 'ipynb', 'map', 'jsonc'],
  xml: ['xml', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'plist', 'kml', 'gpx', 'csproj', 'svg', 'xaml', 'resx', 'opf', 'ncx', 'xlf'],
  csv: ['csv', 'txt', 'tab', 'tsv', 'dat'],
  tsv: ['tsv', 'tab', 'txt', 'csv'],
  sqlite: ['sqlite', 'sqlite3', 'db', 'db3', 's3db', 'sl3', 'gpkg', 'mbtiles'],
  ico: ['ico', 'cur'],
  wma: ['wma', 'wmv', 'asf'],
  wmv: ['wmv', 'wma', 'asf'],
  xls: ['xls', 'doc', 'ppt', 'msg', 'msi'],
  doc: ['doc', 'dot', 'xls', 'ppt'],
  mobi: ['mobi', 'azw', 'azw3', 'prc'],
};

function isMismatch(own: string, ext: string): boolean {
  if (!own || own === ext) return false;
  return !(SAME[ext]?.includes(own) ?? false);
}

// ── Binary signatures ──────────────────────────────────────────────────────

function isoBrand(b: Uint8Array): Guess | null {
  if (ascii(b, 4, 4) !== 'ftyp') return null;
  const brands = [ascii(b, 8, 4)];
  const size = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  for (let o = 16; o + 4 <= Math.min(size, 64); o += 4) brands.push(ascii(b, o, 4));
  const has = (...xs: string[]) => brands.some((x) => xs.includes(x));
  if (has('avif', 'avis')) return g('image', 'AVIF image', 'avif', 'image/avif');
  if (has('heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1')) return g('image', 'HEIC image', 'heic', 'image/heic');
  if (has('crx ')) return g('hex', 'Canon raw photo', 'cr3', 'image/x-canon-cr3', { unsupported: 'Camera raw photos cannot be shown here.' });
  if (brands[0] === 'M4A ' || brands[0] === 'M4B ' || brands[0] === 'M4P ') return g('audio', 'MPEG-4 audio', 'm4a', 'audio/mp4');
  if (has('qt  ')) return g('video', 'QuickTime video', 'mov', 'video/quicktime');
  if (brands[0]?.startsWith('3g')) return g('video', '3GP video', '3gp', 'video/3gpp');
  return g('video', 'MPEG-4 video', 'mp4', 'video/mp4');
}

function zipKind(head: Uint8Array, tail: Uint8Array, own: string): Guess {
  // ODF and EPUB store an uncompressed "mimetype" entry first.
  if (ascii(head, 30, 8) === 'mimetype') {
    const mime = ascii(head, 38, 80).replace(/[^\x20-\x7e].*$/s, '');
    if (mime.startsWith('application/epub+zip')) return g('document', 'EPUB e-book', 'epub', 'application/epub+zip');
    if (mime.includes('opendocument.text')) return g('document', 'OpenDocument text', 'odt', mime);
    if (mime.includes('opendocument.spreadsheet')) return g('table', 'OpenDocument spreadsheet', 'ods', mime);
    if (mime.includes('opendocument.presentation'))
      return g('archive', 'OpenDocument presentation', 'odp', mime, { unsupported: 'OpenDocument presentations are shown as their parts.' });
  }
  const names = `${ascii(head, 0, head.length)}${ascii(tail, 0, tail.length)}`;
  if (names.includes('word/document.xml') || names.includes('word/_rels'))
    return g('document', 'Word document', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  if (names.includes('xl/workbook.xml') || names.includes('xl/_rels'))
    return g('table', 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (names.includes('ppt/presentation.xml') || names.includes('ppt/_rels'))
    return g('document', 'PowerPoint presentation', 'pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  if (names.includes('META-INF/container.xml') && own === 'epub') return g('document', 'EPUB e-book', 'epub', 'application/epub+zip');
  if (own === 'cbz') return g('archive', 'Comic book archive', 'cbz', 'application/vnd.comicbook+zip');
  return g('archive', 'ZIP archive', 'zip', 'application/zip');
}

function mp3Frame(b: Uint8Array, o: number): boolean {
  return b[o] === 0xff && (b[o + 1]! & 0xe0) === 0xe0 && (b[o + 1]! & 0x06) !== 0 && (b[o + 2]! & 0xf0) !== 0xf0;
}

function binaryGuess(b: Uint8Array, tail: Uint8Array, own: string): Guess | null {
  if (b.length === 0) return null;
  if (ascii(b, 0, 5) === '%PDF-' || (b.length > 1024 && ascii(b, 0, 1024).includes('%PDF-')))
    return g('pdf', 'PDF document', 'pdf', 'application/pdf');
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    const s = ascii(b, 0, Math.min(b.length, 4096));
    const apng = s.indexOf('acTL') >= 0 && (s.indexOf('IDAT') < 0 || s.indexOf('acTL') < s.indexOf('IDAT'));
    return g('image', apng ? 'Animated PNG' : 'PNG image', 'png', 'image/png');
  }
  if (starts(b, [0xff, 0xd8, 0xff])) return g('image', 'JPEG image', 'jpg', 'image/jpeg');
  if (ascii(b, 0, 4) === 'GIF8') return g('image', 'GIF image', 'gif', 'image/gif');
  if (ascii(b, 0, 4) === 'RIFF') {
    const type = ascii(b, 8, 4);
    if (type === 'WEBP') return g('image', 'WebP image', 'webp', 'image/webp');
    if (type === 'WAVE') return g('audio', 'WAV audio', 'wav', 'audio/wav');
    if (type === 'AVI ') return g('video', 'AVI video', 'avi', 'video/x-msvideo');
  }
  if (ascii(b, 0, 4) === 'FORM' && ascii(b, 8, 3) === 'AIF') return g('audio', 'AIFF audio', 'aiff', 'audio/aiff');
  const iso = isoBrand(b);
  if (iso) return iso;
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = ascii(b, 0, 64);
    if (head.includes('webm')) return g('video', 'WebM video', 'webm', 'video/webm');
    return own === 'mka' ? g('audio', 'Matroska audio', 'mka', 'audio/x-matroska') : g('video', 'Matroska video', 'mkv', 'video/x-matroska');
  }
  if (ascii(b, 0, 4) === 'OggS') {
    const s = ascii(b, 0, 256);
    if (s.includes('theora') || s.includes('\x80theora')) return g('video', 'Ogg video', 'ogv', 'video/ogg');
    if (s.includes('OpusHead')) return g('audio', 'Opus audio', 'opus', 'audio/ogg');
    if (s.includes('FLAC')) return g('audio', 'Ogg FLAC audio', 'oga', 'audio/ogg');
    return g('audio', 'Ogg Vorbis audio', 'ogg', 'audio/ogg');
  }
  if (ascii(b, 0, 4) === 'fLaC') return g('audio', 'FLAC audio', 'flac', 'audio/flac');
  if (ascii(b, 0, 3) === 'ID3') {
    // ID3 can front MP3, AAC or FLAC.
    const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
    const at = 10 + size;
    if (ascii(b, at, 4) === 'fLaC') return g('audio', 'FLAC audio', 'flac', 'audio/flac');
    if (b[at] === 0xff && (b[at + 1]! & 0xf6) === 0xf0) return g('audio', 'AAC audio', 'aac', 'audio/aac');
    return g('audio', 'MP3 audio', 'mp3', 'audio/mpeg');
  }
  if (b[0] === 0xff && (b[1]! & 0xf6) === 0xf0) return g('audio', 'AAC audio', 'aac', 'audio/aac');
  if (mp3Frame(b, 0)) return g('audio', 'MP3 audio', 'mp3', 'audio/mpeg');
  if (starts(b, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) {
    return own === 'wma' ? g('audio', 'Windows Media audio', 'wma', 'audio/x-ms-wma') : g('video', 'Windows Media video', 'wmv', 'video/x-ms-wmv');
  }
  if (ascii(b, 0, 3) === 'FLV') return g('video', 'Flash video', 'flv', 'video/x-flv');
  if (starts(b, [0x00, 0x00, 0x01, 0xba])) return g('video', 'MPEG video', 'mpg', 'video/mpeg');
  if (b[0] === 0x47 && b[188] === 0x47 && (b.length < 377 || b[376] === 0x47)) return g('video', 'MPEG transport stream', 'ts', 'video/mp2t');
  if (ascii(b, 0, 4) === 'PK\x03\x04' || ascii(b, 0, 4) === 'PK\x05\x06') return zipKind(b, tail, own);
  if (starts(b, [0x1f, 0x8b])) return g('archive', 'Gzip archive', 'gz', 'application/gzip');
  if (ascii(b, 257, 5) === 'ustar') return g('archive', 'TAR archive', 'tar', 'application/x-tar');
  if (starts(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
    return g('hex', '7-Zip archive', '7z', 'application/x-7z-compressed', { unsupported: '7-Zip archives cannot be opened here yet. ZIP, TAR and GZ can.' });
  if (ascii(b, 0, 4) === 'Rar!')
    return g('hex', 'RAR archive', 'rar', 'application/vnd.rar', {
      unsupported: 'RAR archives cannot be opened here: the only RAR decoder has a licence that does not allow it in open-source software.',
    });
  if (ascii(b, 0, 3) === 'BZh') return g('hex', 'Bzip2 archive', 'bz2', 'application/x-bzip2', { unsupported: 'Bzip2 files cannot be opened here.' });
  if (starts(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return g('hex', 'XZ archive', 'xz', 'application/x-xz', { unsupported: 'XZ files cannot be opened here.' });
  if (starts(b, [0x28, 0xb5, 0x2f, 0xfd])) return g('hex', 'Zstandard archive', 'zst', 'application/zstd', { unsupported: 'Zstandard files cannot be opened here.' });
  if (ascii(b, 0, 16) === 'SQLite format 3\0') return g('sqlite', 'SQLite database', 'sqlite', 'application/vnd.sqlite3');
  if (ascii(b, 0, 4) === 'wOFF') return g('font', 'WOFF font', 'woff', 'font/woff');
  if (ascii(b, 0, 4) === 'wOF2') return g('font', 'WOFF2 font', 'woff2', 'font/woff2');
  if (ascii(b, 0, 4) === 'OTTO') return g('font', 'OpenType font', 'otf', 'font/otf');
  if (starts(b, [0x00, 0x01, 0x00, 0x00]) && /^(ttf|otf|ttc)$/.test(own)) return g('font', 'TrueType font', 'ttf', 'font/ttf');
  if (ascii(b, 0, 4) === 'true' || ascii(b, 0, 4) === 'ttcf') return g('font', 'TrueType font', 'ttf', 'font/ttf');
  if (starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (own === 'xls') return g('table', 'Excel 97–2003 workbook', 'xls', 'application/vnd.ms-excel');
    const word = own === 'doc' || own === 'dot';
    return g('hex', word ? 'Word 97–2003 document' : own === 'ppt' ? 'PowerPoint 97–2003 presentation' : 'Microsoft Office 97–2003 file', own || 'doc', 'application/x-ole-storage', {
      unsupported: 'Old binary Office files (.doc, .ppt) cannot be shown here. Save them as .docx or .pptx first.',
    });
  }
  if (ascii(b, 0, 2) === 'BM' && b.length > 26 && (b[14] === 12 || b[14] === 40 || b[14] === 56 || b[14] === 108 || b[14] === 124))
    return g('image', 'BMP image', 'bmp', 'image/bmp');
  if (starts(b, [0x00, 0x00, 0x01, 0x00]) && b[4]! > 0 && b[5] === 0) return g('image', 'ICO icon', 'ico', 'image/x-icon');
  if (starts(b, [0x00, 0x00, 0x02, 0x00]) && b[4]! > 0 && b[5] === 0) return g('image', 'Cursor', 'ico', 'image/x-icon');
  if (starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a])) {
    if (/^(cr2|nef|arw|dng|orf|rw2|pef|srw|raf)$/.test(own))
      return g('hex', 'Camera raw photo', own, 'image/x-raw', { unsupported: 'Camera raw photos cannot be shown here.' });
    return g('image', 'TIFF image', 'tif', 'image/tiff');
  }
  if (ascii(b, 0, 4) === 'PAR1')
    return g('hex', 'Parquet data', 'parquet', 'application/vnd.apache.parquet', { unsupported: 'Parquet files cannot be shown as a table here yet.' });
  if (ascii(b, 0, 6) === 'ARROW1')
    return g('hex', 'Arrow data', 'arrow', 'application/vnd.apache.arrow.file', { unsupported: 'Arrow files cannot be shown as a table here yet.' });
  if (ascii(b, 60, 8) === 'BOOKMOBI') return g('document', 'Kindle e-book', 'mobi', 'application/x-mobipocket-ebook');
  if (own === 'tga' && b[2] !== undefined && [1, 2, 3, 9, 10, 11].includes(b[2])) return g('image', 'TGA image', 'tga', 'image/x-tga');
  return null;
}

// ── Text ───────────────────────────────────────────────────────────────────

/** Decodes a sample as an editor would and says whether it looks like text. */
export function decodeSample(b: Uint8Array): { text: string; encoding: string; binary: boolean } {
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16LE', binary: false };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16BE', binary: false };
  const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  const body = b.subarray(bom ? 3 : 0);
  // UTF-16 without a BOM: zero bytes in every other position.
  let evenZeros = 0;
  let oddZeros = 0;
  const n = Math.min(body.length, 4096);
  for (let i = 0; i < n; i++) {
    if (body[i] !== 0) continue;
    if (i % 2) oddZeros++;
    else evenZeros++;
  }
  if (n >= 8 && oddZeros > n / 4 && evenZeros < n / 50) return { text: new TextDecoder('utf-16le').decode(body), encoding: 'UTF-16LE', binary: false };
  if (n >= 8 && evenZeros > n / 4 && oddZeros < n / 50) return { text: new TextDecoder('utf-16be').decode(body), encoding: 'UTF-16BE', binary: false };
  let text: string;
  let encoding = 'UTF-8';
  try {
    // The sample may end inside a multi-byte character: decode in streaming mode.
    text = new TextDecoder('utf-8', { fatal: true }).decode(body, { stream: true });
  } catch {
    text = new TextDecoder('windows-1252').decode(body);
    encoding = 'Windows-1252';
  }
  let control = 0;
  const m = Math.min(text.length, 8192);
  for (let i = 0; i < m; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) return { text, encoding, binary: true };
    if (c < 9 || (c > 13 && c < 32) || c === 127) control++;
  }
  return { text, encoding, binary: m > 0 && control / m > 0.05 };
}

/** The delimiter that splits the first lines into the most consistent number of fields, with a confidence. */
export function tableShape(text: string): { delimiter: string; columns: number; confidence: number } | null {
  const lines: string[] = [];
  let inQuotes = false;
  let start = 0;
  for (let i = 0; i < text.length && lines.length < 40; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === '\n' && !inQuotes) {
      lines.push(text.slice(start, i));
      start = i + 1;
    }
  }
  // The last line of a sample may be cut short; use it only when it is all we have.
  if (lines.length < 2 && start < text.length) lines.push(text.slice(start));
  const filled = lines.filter((l) => l.trim() !== '');
  if (filled.length < 2) return null;
  let best: { delimiter: string; columns: number; confidence: number } | null = null;
  for (const d of [',', '\t', ';', '|']) {
    const counts = filled.map((l) => l.replace(/"[^"]*"/g, '').split(d).length);
    const first = counts[0]!;
    if (first < 2) continue;
    const same = counts.filter((n) => n === first).length / counts.length;
    if (!best || same > best.confidence || (same === best.confidence && first > best.columns)) {
      best = { delimiter: d, columns: first, confidence: same };
    }
  }
  return best;
}

const TEXT_EXT: Record<string, Guess> = {};
const reg = (exts: string[], guess: Guess) => {
  for (const e of exts) TEXT_EXT[e] = { ...guess, ext: guess.ext || e };
};
reg(['csv'], g('table', 'CSV', 'csv', 'text/csv'));
reg(['tsv', 'tab'], g('table', 'TSV', 'tsv', 'text/tab-separated-values'));
reg(['json', 'jsonc', 'webmanifest', 'har', 'map'], g('data', 'JSON', 'json', 'application/json'));
reg(['geojson'], g('data', 'GeoJSON', 'geojson', 'application/geo+json'));
reg(['ndjson', 'jsonl'], g('data', 'NDJSON', 'ndjson', 'application/x-ndjson'));
reg(['yaml', 'yml'], g('data', 'YAML', 'yaml', 'application/yaml'));
reg(['toml'], g('data', 'TOML', 'toml', 'application/toml'));
reg(['xml', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'plist', 'kml', 'gpx', 'opf', 'ncx', 'xlf', 'resx', 'xaml', 'csproj'], g('data', 'XML', '', 'application/xml'));
reg(['md', 'markdown', 'mdown', 'mkd', 'mdx'], g('markdown', 'Markdown', 'md', 'text/markdown'));
reg(['srt'], g('subtitle', 'SubRip subtitles', 'srt', 'application/x-subrip'));
reg(['vtt'], g('subtitle', 'WebVTT subtitles', 'vtt', 'text/vtt'));
reg(['ass', 'ssa'], g('subtitle', 'ASS subtitles', 'ass', 'text/x-ssa'));
reg(['svg'], g('image', 'SVG image', 'svg', 'image/svg+xml'));
reg(['fb2'], g('document', 'FictionBook e-book', 'fb2', 'application/x-fictionbook+xml'));
reg(['html', 'htm', 'xhtml'], g('text', 'HTML', 'html', 'text/html'));
reg(['rtf'], g('text', 'Rich Text', 'rtf', 'application/rtf'));

/** Source-code extensions → language label. The text viewer picks a highlighter from the extension. */
export const CODE_LANGS: Record<string, string> = {
  js: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  jsx: 'JavaScript (JSX)',
  ts: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  tsx: 'TypeScript (TSX)',
  py: 'Python',
  pyw: 'Python',
  rb: 'Ruby',
  php: 'PHP',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  scala: 'Scala',
  groovy: 'Groovy',
  gradle: 'Gradle',
  c: 'C',
  h: 'C header',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++ header',
  hh: 'C++ header',
  cs: 'C#',
  go: 'Go',
  rs: 'Rust',
  swift: 'Swift',
  m: 'Objective-C',
  dart: 'Dart',
  lua: 'Lua',
  pl: 'Perl',
  r: 'R',
  jl: 'Julia',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  fish: 'Shell',
  ps1: 'PowerShell',
  psm1: 'PowerShell',
  bat: 'Batch',
  cmd: 'Batch',
  sql: 'SQL',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'Sass',
  less: 'Less',
  html: 'HTML',
  htm: 'HTML',
  xhtml: 'HTML',
  vue: 'Vue',
  svelte: 'Svelte',
  xml: 'XML',
  svg: 'SVG',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  cfg: 'INI',
  conf: 'Config',
  properties: 'Properties',
  env: 'Env',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  mk: 'Makefile',
  cmake: 'CMake',
  tex: 'LaTeX',
  sty: 'LaTeX',
  cls: 'LaTeX',
  bib: 'BibTeX',
  diff: 'Diff',
  patch: 'Diff',
  proto: 'Protocol Buffers',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  hs: 'Haskell',
  elm: 'Elm',
  erl: 'Erlang',
  ex: 'Elixir',
  exs: 'Elixir',
  clj: 'Clojure',
  lisp: 'Lisp',
  scm: 'Scheme',
  ml: 'OCaml',
  fs: 'F#',
  vb: 'Visual Basic',
  pas: 'Pascal',
  f90: 'Fortran',
  asm: 'Assembly',
  s: 'Assembly',
  nim: 'Nim',
  zig: 'Zig',
  v: 'Verilog',
  vhd: 'VHDL',
  sol: 'Solidity',
  tf: 'Terraform',
  hcl: 'HCL',
  nginx: 'Nginx',
  log: 'Log',
};

function textGuess(text: string, own: string, name: string): Guess {
  const known = TEXT_EXT[own];
  const head = text.trimStart().slice(0, 2048);
  const lower = head.toLowerCase();
  if (lower.startsWith('<svg') || (lower.startsWith('<?xml') && /<svg[\s>]/.test(lower)))
    return g('image', 'SVG image', 'svg', 'image/svg+xml');
  if (/<fictionbook[\s>]/i.test(head)) return g('document', 'FictionBook e-book', 'fb2', 'application/x-fictionbook+xml');
  if (head.startsWith('WEBVTT')) return g('subtitle', 'WebVTT subtitles', 'vtt', 'text/vtt');
  if (/^\[script info\]/i.test(head)) return g('subtitle', 'ASS subtitles', 'ass', 'text/x-ssa');
  if (/^\d+\r?\n\d\d:\d\d:\d\d[,.]\d{1,3} --> \d\d:\d\d:\d\d/.test(head)) return g('subtitle', 'SubRip subtitles', 'srt', 'application/x-subrip');
  if (head.startsWith('{\\rtf')) return g('text', 'Rich Text', 'rtf', 'application/rtf');
  if (known) {
    if (known.kind === 'data' && known.format === 'JSON' && /"type"\s*:\s*"(FeatureCollection|Feature)"/.test(head))
      return g('data', 'GeoJSON', 'geojson', 'application/geo+json');
    return known;
  }
  if (CODE_LANGS[own]) return g('text', CODE_LANGS[own]!, own, 'text/plain');
  const base = name.toLowerCase();
  if (base === 'dockerfile' || base === 'makefile' || base.startsWith('.')) return g('text', 'Text', own || 'txt', 'text/plain');
  if (/^\s*[{[]/.test(head)) {
    const lines = text.split('\n').filter((l) => l.trim()).slice(0, 5);
    if (lines.length > 1 && lines.every((l) => /^\s*\{.*\}\s*$/.test(l))) return g('data', 'NDJSON', 'ndjson', 'application/x-ndjson');
    if (/^\s*(\{\s*"|\[\s*[{["\d\-tfn\]])/.test(head)) {
      if (/"type"\s*:\s*"(FeatureCollection|Feature)"/.test(head)) return g('data', 'GeoJSON', 'geojson', 'application/geo+json');
      return g('data', 'JSON', 'json', 'application/json');
    }
  }
  if (lower.startsWith('<?xml')) return g('data', 'XML', 'xml', 'application/xml');
  if (/^<!doctype html|^<html[\s>]/.test(lower)) return g('text', 'HTML', 'html', 'text/html');
  if (/^---\r?\n[\w-]+:/.test(head) && own !== 'md') return g('data', 'YAML', 'yaml', 'application/yaml');
  const shape = tableShape(text);
  if (shape && shape.confidence >= 0.9 && (shape.columns >= 3 || (shape.columns >= 2 && shape.delimiter !== ','))) {
    return shape.delimiter === '\t' ? g('table', 'TSV', 'tsv', 'text/tab-separated-values') : g('table', 'CSV', 'csv', 'text/csv');
  }
  if (/^#{1,6} \S/m.test(head) && /(\n|^)(\* |- |\d+\. |```|> )/.test(head)) return g('markdown', 'Markdown', 'md', 'text/markdown');
  return g('text', own === 'log' ? 'Log' : 'Plain text', own || 'txt', 'text/plain');
}

/** What `bytes` (the start of a file) and `tail` (its last bytes) are, given the file's name. */
export function sniffBytes(bytes: Uint8Array, tail: Uint8Array, name: string, size: number): Sniffed {
  const own = extOf(name);
  if (size === 0) return { kind: 'text', format: 'Empty file', ext: own || 'txt', mime: 'text/plain', mismatch: false };
  const bin = binaryGuess(bytes, tail, own);
  if (bin) return { ...bin, mismatch: isMismatch(own, bin.ext) };
  const sample = decodeSample(bytes);
  if (sample.binary) {
    return { kind: 'hex', format: own ? `${own.toUpperCase()} file (binary)` : 'Binary file', ext: own || 'bin', mime: 'application/octet-stream', mismatch: false };
  }
  const t = textGuess(sample.text, own, name);
  return { ...t, encoding: sample.encoding, mismatch: isMismatch(own, t.ext) && !(t.kind === 'text' && !TEXT_EXT[own]) };
}

/** Reads the first 64 KB (and the last 64 KB, for ZIP directories) and sniffs. */
export async function sniffFile(file: Blob & { name?: string }): Promise<Sniffed> {
  const head = new Uint8Array(await file.slice(0, SAMPLE).arrayBuffer());
  const tail = file.size > SAMPLE ? new Uint8Array(await file.slice(Math.max(SAMPLE, file.size - SAMPLE)).arrayBuffer()) : new Uint8Array(0);
  return sniffBytes(head, tail, file.name ?? '', file.size);
}

/** A name + type stand-in for matching a file against tool `accept` lists by what it really is. */
export function sniffedAlias(s: Sniffed): { name: string; type: string } {
  return { name: `file.${s.ext}`, type: s.mime };
}
