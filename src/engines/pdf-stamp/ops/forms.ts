/** AcroForm reading and filling. */
import {
  PDFBool,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  type PDFDocument,
  PDFDropdown,
  type PDFField,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFTextField,
  StandardFonts,
} from '@cantoo/pdf-lib';
import { normalizeBox } from '../geometry';
import type { FieldType, FieldValue, FieldWidget, FormField, FormInfo } from '../types';

function fieldType(field: PDFField): FieldType {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'list';
  if (field instanceof PDFSignature) return 'signature';
  if (field instanceof PDFButton) return 'button';
  return 'button';
}

function pageIndexByAnnot(doc: PDFDocument): Map<PDFRef, number> {
  const map = new Map<PDFRef, number>();
  doc.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i += 1) {
      const ref = annots.get(i);
      if (ref instanceof PDFRef) map.set(ref, index);
    }
  });
  return map;
}

export function readForm(doc: PDFDocument): FormInfo {
  const pageCount = doc.getPageCount();
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!(acro instanceof PDFDict)) return { fields: [], pageCount, xfaOnly: false };
  const hadXfa = acro.has(PDFName.of('XFA'));
  const form = doc.getForm();
  const pagesByRef = pageIndexByAnnot(doc);
  const pages = doc.getPages();
  const fields: FormField[] = [];

  for (const field of form.getFields()) {
    const type = fieldType(field);
    const widgets: FieldWidget[] = [];
    let options: string[] = [];
    let value: FieldValue = '';
    if (field instanceof PDFTextField) value = field.getText() ?? '';
    else if (field instanceof PDFCheckBox) value = field.isChecked();
    else if (field instanceof PDFRadioGroup) {
      options = field.getOptions();
      value = field.getSelected() ?? '';
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      options = field.getOptions();
      const selected = field.getSelected();
      value = field instanceof PDFOptionList && field.isMultiselect() ? selected : (selected[0] ?? '');
    }

    field.acroField.getWidgets().forEach((widget, i) => {
      const ref = doc.context.getObjectRef(widget.dict);
      let page = ref ? pagesByRef.get(ref) : undefined;
      if (page === undefined) {
        const p = widget.P();
        if (p) page = pages.findIndex((pg) => pg.ref === p);
      }
      if (page === undefined || page < 0) return;
      const r = widget.getRectangle();
      const rect = normalizeBox(r.x, r.y, r.x + r.width, r.y + r.height);
      widgets.push({ page, rect, option: type === 'radio' ? options[i] : undefined });
    });

    fields.push({
      name: field.getName(),
      type,
      value,
      options,
      readOnly: field.isReadOnly(),
      multiline: field instanceof PDFTextField ? field.isMultiline() : false,
      maxLength: field instanceof PDFTextField ? field.getMaxLength() : undefined,
      multiSelect: field instanceof PDFOptionList ? field.isMultiselect() : false,
      editable: field instanceof PDFDropdown ? field.isEditable() : false,
      widgets,
    });
  }
  return { fields, pageCount, xfaOnly: hadXfa && fields.length === 0 };
}

/**
 * pdf-lib's automatic font size ("0 Tf") wraps multiline text one giant word
 * per line, and forms saved by pdf-lib often carry such a size baked into /DA
 * (78 pt in a 90 pt box). Give multiline fields a readable fixed size when
 * theirs is automatic or too big for two lines.
 */
export function fixMultilineAutoSize(field: PDFField): void {
  if (!(field instanceof PDFTextField) || !field.isMultiline()) return;
  const da = field.acroField.getDefaultAppearance() ?? '';
  const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1] ?? 0);
  const height = field.acroField.getWidgets()[0]?.getRectangle().height ?? 40;
  if (size > 0 && size * 2.4 <= height) return;
  field.setFontSize(Math.max(6, Math.min(10, height * 0.6)));
}

/** Writes values and regenerates their appearances. Returns names that could not be drawn with Helvetica. */
export async function fillForm(doc: PDFDocument, values: Record<string, FieldValue>): Promise<string[]> {
  const form = doc.getForm();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const unencodable: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field || field.isReadOnly()) continue;
    if (field instanceof PDFTextField) {
      const text = typeof value === 'string' ? value : '';
      const max = field.getMaxLength();
      field.setText(max !== undefined ? text.slice(0, max) || undefined : text || undefined);
    } else if (field instanceof PDFCheckBox) {
      if (value === true) field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      if (typeof value === 'string' && value) field.select(value);
      else field.clear();
    } else if (field instanceof PDFDropdown) {
      const v = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
      if (v.length === 0) field.clear();
      else {
        const known = field.getOptions();
        if (v.some((x) => !known.includes(x)) && !field.isEditable()) continue;
        field.select(v);
      }
    } else if (field instanceof PDFOptionList) {
      const v = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
      if (v.length === 0) field.clear();
      else field.select(v);
    }
    try {
      fixMultilineAutoSize(field);
      field.defaultUpdateAppearances(helvetica);
    } catch {
      unencodable.push(name);
    }
  }
  if (unencodable.length) {
    // Let viewers draw these fields themselves.
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  }
  return unencodable;
}
