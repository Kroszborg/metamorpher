/** Structural clean-up: unreachable objects and JavaScript actions. */
import { PDFArray, PDFDict, type PDFDocument, PDFName, type PDFObject, PDFRef, PDFStream } from '@cantoo/pdf-lib';

/**
 * Deletes every indirect object that nothing reachable from the trailer refers
 * to. pdf-lib writes orphans too, so without this, removed annotations, old
 * metadata or scripts would still be inside the saved file.
 */
export function pruneUnreachable(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Set<PDFRef>();
  const stack: (PDFObject | undefined)[] = [
    ctx.trailerInfo.Root,
    ctx.trailerInfo.Info,
    ctx.trailerInfo.Encrypt,
    ctx.trailerInfo.ID,
  ];
  while (stack.length) {
    const obj = stack.pop();
    if (!obj) continue;
    if (obj instanceof PDFRef) {
      if (seen.has(obj)) continue;
      seen.add(obj);
      stack.push(ctx.lookup(obj));
    } else if (obj instanceof PDFDict) {
      for (const [, v] of obj.entries()) stack.push(v);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i += 1) stack.push(obj.get(i));
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref)) {
      ctx.delete(ref);
      removed += 1;
    }
  }
  return removed;
}

const JS = PDFName.of('JavaScript');
const S = PDFName.of('S');
const A = PDFName.of('A');
const AA = PDFName.of('AA');
const NEXT = PDFName.of('Next');

function isJsAction(ctx: PDFDocument['context'], action: PDFObject | undefined, depth = 0): boolean {
  if (depth > 32) return false;
  const dict = action ? ctx.lookup(action) : undefined;
  if (!(dict instanceof PDFDict)) return false;
  if (dict.get(S) === JS || dict.has(PDFName.of('JS'))) return true;
  // Follow /Next chains: one script anywhere in the chain removes the whole action.
  const next = dict.get(NEXT);
  const nextObj = next ? ctx.lookup(next) : undefined;
  if (nextObj instanceof PDFArray) {
    for (let i = 0; i < nextObj.size(); i += 1) if (isJsAction(ctx, nextObj.get(i), depth + 1)) return true;
    return false;
  }
  return isJsAction(ctx, next, depth + 1);
}

function stripDict(ctx: PDFDocument['context'], dict: PDFDict): void {
  dict.delete(AA);
  if (isJsAction(ctx, dict.get(A))) dict.delete(A);
}

/** Removes document, page, annotation, field and outline JavaScript, plus XFA (which carries scripts). */
export function removeJavaScript(doc: PDFDocument): void {
  const ctx = doc.context;
  const catalog = doc.catalog;
  const names = catalog.lookup(PDFName.of('Names'));
  if (names instanceof PDFDict) names.delete(JS);
  catalog.delete(AA);
  if (isJsAction(ctx, catalog.get(PDFName.of('OpenAction')))) catalog.delete(PDFName.of('OpenAction'));

  for (const page of doc.getPages()) {
    page.node.delete(AA);
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = annots.lookup(i);
      if (annot instanceof PDFDict) stripDict(ctx, annot);
    }
  }

  const acroForm = catalog.lookup(PDFName.of('AcroForm'));
  if (acroForm instanceof PDFDict) {
    acroForm.delete(PDFName.of('XFA'));
    const fields = acroForm.lookup(PDFName.of('Fields'));
    const stack: PDFObject[] = [];
    if (fields instanceof PDFArray) for (let i = 0; i < fields.size(); i += 1) stack.push(fields.get(i));
    const seen = new Set<PDFObject>();
    while (stack.length) {
      const item = stack.pop()!;
      const field = ctx.lookup(item);
      if (!(field instanceof PDFDict) || seen.has(field)) continue;
      seen.add(field);
      stripDict(ctx, field);
      const kids = field.lookup(PDFName.of('Kids'));
      if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i += 1) stack.push(kids.get(i));
    }
  }

  // Outline items can run scripts when clicked.
  const outlines = catalog.lookup(PDFName.of('Outlines'));
  const stack: PDFObject[] = [];
  if (outlines instanceof PDFDict) {
    const first = outlines.get(PDFName.of('First'));
    if (first) stack.push(first);
  }
  const visited = new Set<PDFObject>();
  while (stack.length) {
    const item = ctx.lookup(stack.pop()!);
    if (!(item instanceof PDFDict) || visited.has(item)) continue;
    visited.add(item);
    stripDict(ctx, item);
    for (const key of ['First', 'Next']) {
      const v = item.get(PDFName.of(key));
      if (v) stack.push(v);
    }
  }
}
