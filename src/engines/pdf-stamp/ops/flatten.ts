/**
 * Burns annotation appearances into the page content (PDF 32000-1 §12.5.5:
 * the appearance BBox, transformed by its Matrix, is fitted to the annotation
 * Rect), then removes the annotations. Form fields get appearances generated
 * first where they lack one.
 */
import {
  drawObject,
  PDFArray,
  PDFBool,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFNumber,
  type PDFObject,
  type PDFOperator,
  PDFRef,
  PDFStream,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
} from '@cantoo/pdf-lib';
import { pruneUnreachable, removeJavaScript } from '../cleanup';
import { cm, drawOver, graphicsState } from '../document';
import { type Box, IDENTITY, type Matrix, normalizeBox, transformBox } from '../geometry';
import type { FlattenSpec } from '../types';
import { fixMultilineAutoSize } from './forms';

const N = (s: string) => PDFName.of(s);

function numbers(arr: PDFObjectLike, count: number): number[] | null {
  if (!(arr instanceof PDFArray) || arr.size() < count) return null;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const v = arr.lookup(i);
    if (!(v instanceof PDFNumber)) return null;
    out.push(v.asNumber());
  }
  return out;
}
type PDFObjectLike = PDFObject | undefined;

/** The normal appearance to draw for an annotation, as a registered stream ref. */
function normalAppearance(doc: PDFDocument, annot: PDFDict): PDFRef | null {
  const ap = annot.lookup(N('AP'));
  if (!(ap instanceof PDFDict)) return null;
  const raw = ap.get(N('N'));
  let target: PDFObjectLike = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  let ref = raw instanceof PDFRef ? raw : null;
  if (target instanceof PDFDict && !(target instanceof PDFStream)) {
    // A state dictionary (check boxes, radio buttons): pick the current /AS.
    const as = annot.get(N('AS'));
    if (!(as instanceof PDFName)) return null;
    const state = target.get(as);
    if (!state) return null;
    ref = state instanceof PDFRef ? state : null;
    target = state instanceof PDFRef ? doc.context.lookup(state) : state;
  }
  if (!(target instanceof PDFStream)) return null;
  return ref ?? doc.context.register(target);
}

/** Operators that draw `apRef` fitted to `rect`. */
function placeAppearance(doc: PDFDocument, apRef: PDFRef, rect: Box, key: PDFName): PDFOperator[] | null {
  const stream = doc.context.lookup(apRef);
  if (!(stream instanceof PDFStream)) return null;
  const dict = stream.dict;
  dict.set(N('Type'), N('XObject'));
  dict.set(N('Subtype'), N('Form'));
  const bboxNums = numbers(dict.lookup(N('BBox')), 4);
  if (!bboxNums) return null;
  const bbox = normalizeBox(bboxNums[0]!, bboxNums[1]!, bboxNums[2]!, bboxNums[3]!);
  const matrix = (numbers(dict.lookup(N('Matrix')), 6) as Matrix | null) ?? IDENTITY;
  const t = transformBox(matrix, bbox);
  if (t.width <= 0 || t.height <= 0 || rect.width <= 0 || rect.height <= 0) return null;
  const sx = rect.width / t.width;
  const sy = rect.height / t.height;
  const fit: Matrix = [sx, 0, 0, sy, rect.x - t.x * sx, rect.y - t.y * sy];
  return [pushGraphicsState(), cm(fit), drawObject(key), popGraphicsState()];
}

export type FlattenResult = { annotations: number; fields: number };

export async function flatten(doc: PDFDocument, spec: FlattenSpec): Promise<FlattenResult> {
  const ctx = doc.context;
  const catalog = doc.catalog;
  const acroForm = catalog.lookup(N('AcroForm'));
  let fieldCount = 0;
  let dr: PDFDict | undefined;

  if (spec.forms && acroForm instanceof PDFDict) {
    const resources = acroForm.lookup(N('DR'));
    if (resources instanceof PDFDict) dr = resources;
    try {
      const form = doc.getForm();
      const fields = form.getFields();
      fieldCount = fields.length;
      const needAppearances = acroForm.lookup(N('NeedAppearances'));
      const regenerateAll = needAppearances instanceof PDFBool && needAppearances.asBoolean();
      const helvetica = await doc.embedFont(StandardFonts.Helvetica);
      for (const field of fields) {
        try {
          if (regenerateAll || field.needsAppearancesUpdate()) {
            fixMultilineAutoSize(field);
            field.defaultUpdateAppearances(helvetica);
          }
        } catch {
          // Keep whatever appearance the field already has (for example, text outside WinAnsi).
        }
      }
    } catch {
      // A malformed form: flatten whatever widgets have appearances.
    }
  }

  let annotationCount = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots || annots.size() === 0) continue;
    const keep: PDFObjectLike[] = [];
    const ops: PDFOperator[] = [];
    for (let i = 0; i < annots.size(); i += 1) {
      const entry = annots.get(i);
      const annot = ctx.lookup(entry);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = annot.get(N('Subtype'));
      const isWidget = subtype === N('Widget');
      const isLink = subtype === N('Link');
      const isPopup = subtype === N('Popup');
      const burn = isWidget ? spec.forms : isLink ? !spec.keepLinks : spec.annotations;
      if (!burn) {
        keep.push(entry);
        continue;
      }
      annotationCount += 1;
      if (isPopup) continue;
      const flags = annot.lookup(N('F'));
      const f = flags instanceof PDFNumber ? flags.asNumber() : 0;
      if (f & (1 << 1) || f & (1 << 5)) continue; // Hidden or NoView
      const rectNums = numbers(annot.lookup(N('Rect')), 4);
      const apRef = normalAppearance(doc, annot);
      if (!rectNums || !apRef) continue;
      if (isWidget && dr) {
        const ap = ctx.lookup(apRef);
        if (ap instanceof PDFStream && !ap.dict.has(N('Resources'))) ap.dict.set(N('Resources'), dr);
      }
      const rect = normalizeBox(rectNums[0]!, rectNums[1]!, rectNums[2]!, rectNums[3]!);
      const key = page.node.newXObject('MmAnnot', apRef);
      const place = placeAppearance(doc, apRef, rect, key);
      if (!place) continue;
      const ca = annot.lookup(N('CA'));
      const opacity = ca instanceof PDFNumber ? ca.asNumber() : 1;
      if (opacity < 1) ops.push(pushGraphicsState(), ...graphicsState(page, { opacity }), ...place, popGraphicsState());
      else ops.push(...place);
    }
    if (ops.length) drawOver(page, ops);
    if (keep.length === 0) page.node.delete(N('Annots'));
    else if (keep.length !== annots.size()) {
      const next = PDFArray.withContext(ctx);
      for (const k of keep) if (k) next.push(k);
      page.node.set(N('Annots'), next);
    }
  }

  if (spec.forms && acroForm) catalog.delete(N('AcroForm'));
  if (spec.removeJavaScript) removeJavaScript(doc);
  pruneUnreachable(doc);
  return { annotations: annotationCount, fields: fieldCount };
}
