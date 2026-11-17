/** Document information dictionary and XMP metadata. */
import {
  decodePDFRawStream,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
} from '@cantoo/pdf-lib';
import { pruneUnreachable } from '../cleanup';
import type { MetadataInfo, MetadataSpec, PdfMetadata } from '../types';

const N = (s: string) => PDFName.of(s);

function infoDict(doc: PDFDocument): PDFDict | undefined {
  const info = doc.context.trailerInfo.Info;
  const dict = info ? doc.context.lookup(info) : undefined;
  return dict instanceof PDFDict ? dict : undefined;
}

function text(dict: PDFDict | undefined, key: string): string {
  const v = dict?.lookup(N(key));
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  if (v instanceof PDFName) return v.decodeText();
  return '';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DDTHH:mm" in local time, as <input type="datetime-local"> wants. */
function toLocalInput(d: Date | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function date(dict: PDFDict | undefined, key: string): Date | undefined {
  const v = dict?.lookup(N(key));
  if (v instanceof PDFString) return v.decodeDate();
  if (v instanceof PDFHexString) return v.decodeDate();
  return undefined;
}

function safeDate(dict: PDFDict | undefined, key: string): string {
  try {
    return toLocalInput(date(dict, key));
  } catch {
    return '';
  }
}

export function readMetadata(doc: PDFDocument): MetadataInfo {
  const info = infoDict(doc);
  return {
    title: text(info, 'Title'),
    author: text(info, 'Author'),
    subject: text(info, 'Subject'),
    keywords: text(info, 'Keywords'),
    creator: text(info, 'Creator'),
    producer: text(info, 'Producer'),
    creationDate: safeDate(info, 'CreationDate'),
    modDate: safeDate(info, 'ModDate'),
    hasXmp: doc.catalog.lookup(N('Metadata')) instanceof PDFStream,
    pageCount: doc.getPageCount(),
  };
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function xmpDate(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${local.length === 16 ? `${local}:00` : local}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** A fresh XMP packet mirroring the info dictionary; keeps a PDF/A identification if the old packet had one. */
function buildXmp(v: PdfMetadata, previous: string): string {
  const part = /pdfaid:part(?:>|=")(\d)/.exec(previous)?.[1];
  const conformance = /pdfaid:conformance(?:>|=")([A-Za-z])/.exec(previous)?.[1];
  const props: string[] = [];
  if (v.title) props.push(`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(v.title)}</rdf:li></rdf:Alt></dc:title>`);
  if (v.author) props.push(`<dc:creator><rdf:Seq><rdf:li>${escapeXml(v.author)}</rdf:li></rdf:Seq></dc:creator>`);
  if (v.subject) props.push(`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(v.subject)}</rdf:li></rdf:Alt></dc:description>`);
  if (v.keywords) props.push(`<pdf:Keywords>${escapeXml(v.keywords)}</pdf:Keywords>`);
  if (v.producer) props.push(`<pdf:Producer>${escapeXml(v.producer)}</pdf:Producer>`);
  if (v.creator) props.push(`<xmp:CreatorTool>${escapeXml(v.creator)}</xmp:CreatorTool>`);
  const created = v.creationDate ? xmpDate(v.creationDate) : '';
  const modified = v.modDate ? xmpDate(v.modDate) : '';
  if (created) props.push(`<xmp:CreateDate>${created}</xmp:CreateDate>`);
  if (modified) props.push(`<xmp:ModifyDate>${modified}</xmp:ModifyDate>`, `<xmp:MetadataDate>${modified}</xmp:MetadataDate>`);
  if (part) props.push(`<pdfaid:part>${part}</pdfaid:part>`);
  if (conformance) props.push(`<pdfaid:conformance>${conformance}</pdfaid:conformance>`);
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
    ...props,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
}

export function writeMetadata(doc: PDFDocument, spec: MetadataSpec): void {
  const ctx = doc.context;
  const catalog = doc.catalog;

  if (spec.removeAll) {
    ctx.trailerInfo.Info = undefined;
    catalog.delete(N('Metadata'));
    catalog.delete(N('PieceInfo'));
    for (const page of doc.getPages()) {
      page.node.delete(N('Metadata'));
      page.node.delete(N('PieceInfo'));
    }
    pruneUnreachable(doc);
    return;
  }

  const v = spec.values;
  let info = infoDict(doc);
  if (!info) {
    info = ctx.obj({});
    ctx.trailerInfo.Info = ctx.register(info);
  }
  const setText = (key: string, value: string) => {
    if (value.trim()) info.set(N(key), PDFHexString.fromText(value.trim()));
    else info.delete(N(key));
  };
  setText('Title', v.title);
  setText('Author', v.author);
  setText('Subject', v.subject);
  setText('Keywords', v.keywords);
  setText('Creator', v.creator);
  setText('Producer', v.producer);
  const setDate = (key: string, value: string) => {
    const d = value ? new Date(value) : null;
    if (d && !Number.isNaN(d.getTime())) info.set(N(key), PDFString.fromDate(d));
    else info.delete(N(key));
  };
  setDate('CreationDate', v.creationDate);
  setDate('ModDate', v.modDate);

  // Readers prefer XMP over the info dictionary, so an old packet would hide the edit.
  const old = catalog.lookup(N('Metadata'));
  let previous = '';
  if (old instanceof PDFStream) {
    try {
      previous = new TextDecoder().decode(decodeStream(old));
    } catch {
      previous = '';
    }
  }
  const xmp = ctx.stream(new TextEncoder().encode(buildXmp(v, previous)), { Type: 'Metadata', Subtype: 'XML' });
  catalog.set(N('Metadata'), ctx.register(xmp));
  pruneUnreachable(doc);
}

function decodeStream(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  return stream.getContents();
}
