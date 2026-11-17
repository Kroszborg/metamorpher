/** A document model (from a PDF) → a Word .docx file, written as plain OOXML. */
import { zipSync, strToU8 } from 'fflate';
import type { DocModel, DocTable, Para, Run } from '@/engines/pdf-extract';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/** Escapes text for XML and drops characters XML cannot hold. */
export function xmlText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

/** PostScript-ish font names from PDFs → names Word knows. */
export function wordFont(name: string): string {
  const n = name.replace(/[-_,].*$/, '');
  if (/^TimesNewRoman|^Times/i.test(n)) return 'Times New Roman';
  if (/^Arial|^Helvetica|^NimbusSans|^LiberationSans/i.test(n)) return 'Arial';
  if (/^CourierNew|^Courier|^NimbusMono|^LiberationMono/i.test(n)) return 'Courier New';
  if (/^Calibri/i.test(n)) return 'Calibri';
  if (/^Cambria/i.test(n)) return 'Cambria';
  if (/^Georgia/i.test(n)) return 'Georgia';
  if (/^Verdana/i.test(n)) return 'Verdana';
  if (/^Symbol/i.test(n)) return 'Symbol';
  return n.replace(/([a-z])([A-Z])/g, '$1 $2') || 'Arial';
}

const twip = (pt: number) => Math.round(pt * 20);
const emu = (pt: number) => Math.round(pt * 12700);

export function writeDocx(model: DocModel): Blob {
  const bodyFont = wordFont(model.bodyFont);
  const bodyHalfPts = Math.round(model.bodySize * 2);
  const rels: string[] = [];
  const media: Record<string, Uint8Array> = {};
  let relId = 10;
  const contentW = model.page.width - model.page.margin.left - model.page.margin.right;
  const headingSizes = new Map<number, number>();
  for (const b of model.blocks) if (b.kind === 'para' && b.level > 0 && !headingSizes.has(b.level)) headingSizes.set(b.level, b.size);

  const runXml = (r: Run, styleSize: number): string => {
    const props: string[] = [];
    const font = wordFont(r.font);
    if (font !== bodyFont) props.push(`<w:rFonts w:ascii="${xmlText(font)}" w:hAnsi="${xmlText(font)}" w:cs="${xmlText(font)}"/>`);
    if (r.bold) props.push('<w:b/>');
    if (r.italic) props.push('<w:i/>');
    if (r.color && r.color !== '#000000') props.push(`<w:color w:val="${r.color.slice(1).toUpperCase()}"/>`);
    const hp = Math.round(r.size * 2);
    if (Math.abs(hp - styleSize) >= 1) props.push(`<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>`);
    const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
    return `<w:r>${rPr}<w:t xml:space="preserve">${xmlText(r.text)}</w:t></w:r>`;
  };

  const paraXml = (p: Para): string => {
    const pPr: string[] = [];
    if (p.level > 0) pPr.push(`<w:pStyle w:val="Heading${p.level}"/>`);
    if (p.align !== 'left') pPr.push(`<w:jc w:val="${p.align === 'justify' ? 'both' : p.align}"/>`);
    if (p.indent > 4) pPr.push(p.list ? `<w:ind w:left="${twip(p.indent + 18)}" w:hanging="${twip(18)}"/>` : `<w:ind w:left="${twip(p.indent)}"/>`);
    const styleSize = p.level > 0 ? Math.round((headingSizes.get(p.level) ?? model.bodySize) * 2) : bodyHalfPts;
    let runs = '';
    for (const r of p.runs) {
      if (!r.text) continue;
      if (r.link && /^(https?:|mailto:|www\.)/i.test(r.link)) {
        const id = `rId${relId++}`;
        const target = r.link.startsWith('www.') ? `https://${r.link}` : r.link;
        rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlText(target)}" TargetMode="External"/>`);
        runs += `<w:hyperlink r:id="${id}">${runXml({ ...r, color: '#0563C1' }, styleSize)}</w:hyperlink>`;
      } else runs += runXml(r, styleSize);
    }
    return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${runs}</w:p>`;
  };

  const tableXml = (t: DocTable): string => {
    const border = '<w:top w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>';
    const colW = Math.max(400, Math.floor(twip(contentW) / Math.max(1, t.columns)));
    const rows = t.rows.map((row, r) => {
      const used = row.reduce((n, c) => n + c.colSpan, 0);
      const cells = [...row, ...Array.from({ length: Math.max(0, t.columns - used) }, () => ({ text: '', colSpan: 1, bold: false }))];
      const header = r === 0 && t.header;
      const tcs = cells
        .map((c) => {
          const bold = c.bold || header;
          const run = c.text ? `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlText(c.text)}</w:t></w:r>` : '';
          const span = c.colSpan > 1 ? `<w:gridSpan w:val="${c.colSpan}"/>` : '';
          const shade = header ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '';
          return `<w:tc><w:tcPr><w:tcW w:w="${colW * c.colSpan}" w:type="dxa"/>${span}${shade}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run}</w:p></w:tc>`;
        })
        .join('');
      return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tcs}</w:tr>`;
    });
    return `<w:tbl><w:tblPr><w:tblW w:w="${colW * t.columns}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: t.columns }, () => `<w:gridCol w:w="${colW}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`;
  };

  let imageN = 0;
  const body: string[] = [];
  for (const b of model.blocks) {
    if (b.kind === 'page-break') body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    else if (b.kind === 'para') body.push(paraXml(b));
    else if (b.kind === 'table') body.push(tableXml(b));
    else {
      imageN += 1;
      const ext = b.mime === 'image/png' ? 'png' : 'jpeg';
      const name = `image${imageN}.${ext}`;
      media[`word/media/${name}`] = b.bytes;
      const id = `rId${relId++}`;
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
      const scale = Math.min(1, contentW / Math.max(1, b.width));
      const cx = emu(b.width * scale);
      const cy = emu(b.height * scale);
      body.push(
        `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageN}" name="Picture ${imageN}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${imageN}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      );
    }
  }
  const m = model.page.margin;
  const sect = `<w:sectPr><w:pgSz w:w="${twip(model.page.width)}" w:h="${twip(model.page.height)}"${model.page.width > model.page.height ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${twip(m.top)}" w:right="${twip(m.right)}" w:bottom="${twip(m.bottom)}" w:left="${twip(m.left)}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const documentXml = `${XML_HEAD}<w:document ${NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;

  const heading = (level: number) => {
    const size = Math.round((headingSizes.get(level) ?? model.bodySize * (1.6 - level * 0.15)) * 2);
    return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${level === 1 ? 240 : 160}" w:after="80"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  };
  const stylesXml = `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${xmlText(bodyFont)}" w:hAnsi="${xmlText(bodyFont)}" w:cs="${xmlText(bodyFont)}" w:eastAsia="${xmlText(bodyFont)}"/><w:sz w:val="${bodyHalfPts}"/><w:szCs w:val="${bodyHalfPts}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${[1, 2, 3, 4].map(heading).join('')}<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml),
    'docProps/core.xml': strToU8(`${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${model.title ? `<dc:title>${xmlText(model.title)}</dc:title>` : ''}${model.author ? `<dc:creator>${xmlText(model.author)}</dc:creator>` : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`),
    'docProps/app.xml': strToU8(`${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Metamorpher</Application></Properties>`),
    ...media,
  };
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
