import { dataUrlBlob, findResource, imageDataUrl, isRemote, type Resources } from './images';

export type PreparedHtml = {
  /** Sanitised body HTML: images inlined, page breaks the engine understands. */
  body: string;
  /** The document's own CSS (from <style> elements), remote references removed. */
  css: string;
  title?: string;
  lang?: string;
  images: number;
  /** Images with http(s) addresses: never downloaded. */
  remoteImages: number;
  /** Relative image references with no matching added file. */
  missingImages: string[];
  /** Images that could not be decoded. */
  brokenImages: number;
};

export type PrepareOptions = {
  resources: Resources;
  /** Keep the page's <style> elements and style attributes (HTML to PDF); false: the theme only. */
  keepStyles: boolean;
};

const FORBID_TAGS = [
  'script', 'noscript', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'option', 'textarea', 'video', 'audio', 'source', 'track', 'canvas', 'template', 'dialog',
];

/** Removes what cannot be shown or would reach the network: @import, @font-face, url(...) other than data:. */
function cleanCss(css: string): string {
  return css
    .replace(/@import[^;]*;/gi, '')
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    // Hollow and square bullets have no glyph in the layout fonts.
    .replace(/(list-style(?:-type)?\s*:\s*)(circle|square)\b/gi, '$1disc')
    .replace(/url\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi, 'none');
}

/** Page breaks in stylesheets become break elements (markPageBreaks); drop the declarations themselves. */
function stripBreaks(css: string): string {
  return css.replace(/(?:page-)?break-(?:before|after)\s*:\s*(?:always|page|left|right|recto|verso)\s*(?:!important)?\s*;?/gi, '');
}

function placeholder(doc: Document, text: string): HTMLElement {
  const span = doc.createElement('span');
  span.className = 'mm-missing-image';
  span.textContent = `[${text}]`;
  return span;
}

/** Inserts engine page breaks for `page-break-before/after` and `break-before/after: page`. */
function markPageBreaks(doc: Document, root: HTMLElement, sheetCss: string): void {
  const before = new Set<Element>();
  const after = new Set<Element>();
  const isBreak = (v: string) => /^(always|page|left|right|recto|verso)$/i.test(v.trim());
  for (const el of root.querySelectorAll<HTMLElement>('[style]')) {
    const s = el.style;
    if (isBreak(s.getPropertyValue('page-break-before')) || isBreak(s.getPropertyValue('break-before'))) before.add(el);
    if (isBreak(s.getPropertyValue('page-break-after')) || isBreak(s.getPropertyValue('break-after'))) after.add(el);
    // The engine's own break element replaces these (MuPDF only honours some of them, inconsistently).
    for (const prop of ['page-break-before', 'break-before', 'page-break-after', 'break-after']) {
      if (isBreak(s.getPropertyValue(prop))) s.removeProperty(prop);
    }
  }
  if (sheetCss.trim() && typeof CSSStyleSheet !== 'undefined') {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(sheetCss);
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const b = isBreak(rule.style.getPropertyValue('page-break-before')) || isBreak(rule.style.getPropertyValue('break-before'));
        const a = isBreak(rule.style.getPropertyValue('page-break-after')) || isBreak(rule.style.getPropertyValue('break-after'));
        if (!a && !b) continue;
        try {
          for (const el of root.querySelectorAll(rule.selectorText)) (b ? before : after).add(el);
        } catch {
          // a selector the DOM cannot query (pseudo-elements): skip
        }
      }
    } catch {
      // unparsable CSS: no breaks from it
    }
  }
  // The engine's page break: the break, then an empty block (see PAGE_BREAK in the engine).
  const brk = () => {
    const d = doc.createElement('div');
    d.className = 'mm-page-break';
    const after = doc.createElement('div');
    after.className = 'mm-after-break';
    const frag = doc.createDocumentFragment();
    frag.append(d, after);
    return frag;
  };
  for (const el of before) {
    // No blank first page for a break at the very start.
    if (el.previousElementSibling || el.parentElement !== root) el.before(brk());
  }
  for (const el of after) if (el.nextSibling) el.after(brk());
}

/**
 * Turns an HTML document (or fragment) into what the layout engine gets:
 * sanitised, no scripts or forms, images inlined as data: URLs from the
 * document itself or from added files, never from the network.
 */
export async function prepareHtml(source: string, { resources, keepStyles }: PrepareOptions): Promise<PreparedHtml> {
  const DOMPurify = (await import('dompurify')).default;
  // A DOMParser document is inert: nothing runs and nothing loads.
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const title = parsed.title.trim() || undefined;
  const lang = parsed.documentElement.getAttribute('lang')?.trim() || undefined;
  const css = keepStyles ? cleanCss([...parsed.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n')) : '';

  const body = DOMPurify.sanitize(parsed.body?.innerHTML ?? '', {
    RETURN_DOM: true,
    FORBID_TAGS,
    FORBID_ATTR: ['srcset', 'sizes', 'background', 'ping', 'action', 'formaction', ...(keepStyles ? [] : ['style'])],
    ALLOW_DATA_ATTR: false,
  }) as HTMLElement;
  const doc = body.ownerDocument;

  // Inline SVG: drawn to a picture (the engine does not lay out SVG).
  for (const svg of [...body.querySelectorAll('svg')]) {
    if (svg.parentElement?.closest('svg')) continue;
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const xml = new XMLSerializer().serializeToString(svg);
    const url = await imageDataUrl(new Blob([xml], { type: 'image/svg+xml' }));
    if (url) {
      const img = doc.createElement('img');
      img.src = url;
      const w = svg.getAttribute('width');
      if (w && /^\d+(\.\d+)?(px)?$/.test(w)) img.setAttribute('width', String(parseFloat(w)));
      svg.replaceWith(img);
    } else svg.remove();
  }

  let images = 0;
  let remoteImages = 0;
  let brokenImages = 0;
  const missing = new Set<string>();
  for (const img of [...body.querySelectorAll('img')]) {
    const src = img.getAttribute('src')?.trim() ?? '';
    const alt = img.getAttribute('alt')?.trim();
    if (!src) {
      img.remove();
      continue;
    }
    if (isRemote(src)) {
      remoteImages += 1;
      img.replaceWith(placeholder(doc, `${alt ? `${alt}: ` : ''}remote image not included`));
      continue;
    }
    const blob = src.startsWith('data:') ? await dataUrlBlob(src) : (findResource(src, resources) ?? null);
    if (!blob) {
      if (!src.startsWith('data:')) missing.add(src.split(/[\\/]/).pop() ?? src);
      img.replaceWith(placeholder(doc, `${alt ? `${alt}: ` : ''}image ${src.startsWith('data:') ? 'could not be read' : `“${src}” not added`}`));
      continue;
    }
    const url = await imageDataUrl(blob);
    if (!url) {
      brokenImages += 1;
      img.replaceWith(placeholder(doc, `${alt ? `${alt}: ` : ''}image could not be decoded`));
      continue;
    }
    img.setAttribute('src', url);
    images += 1;
  }

  // Remote CSS backgrounds in style attributes.
  if (keepStyles) {
    for (const el of body.querySelectorAll<HTMLElement>('[style]')) {
      const s = el.getAttribute('style') ?? '';
      if (/url\(/i.test(s)) el.setAttribute('style', cleanCss(s));
    }
  }

  markPageBreaks(doc, body, css);
  return { body: body.innerHTML, css: stripBreaks(css), title, lang, images, remoteImages, missingImages: [...missing], brokenImages };
}
