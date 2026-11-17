/** Pictures (one per slide) → a PowerPoint .pptx, written as plain OOXML. */
import { strToU8, zipSync } from 'fflate';
import { wordFont, xmlText } from './docx-writer';

export type SlidePicture = {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  /** Picture size in points (the PDF page). */
  width: number;
  height: number;
  /** Alternative text (the page's text), for screen readers and search. */
  alt?: string;
  /** Editable text boxes over the picture, in the picture's points (top-left origin). */
  texts?: SlideTextLine[];
};

export type SlideTextLine = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise. */
  rot: number;
  runs: { text: string; size: number; font: string; bold: boolean; italic: boolean; color: string }[];
};

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU = 12700;

const THEME = `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const MASTER = `${HEAD}<p:sldMaster ${NS_P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;

const LAYOUT = `${HEAD}<p:sldLayout ${NS_P} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

function rels(items: [string, string, string][]): Uint8Array {
  return strToU8(`${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`);
}

/**
 * One slide per picture. `slide` is the slide size in points: the pictures
 * are fitted inside it, centred (for "match the page", pass the first page's size).
 */
export function writePptx(pictures: SlidePicture[], slide: { width: number; height: number }, title?: string): Blob {
  // PowerPoint accepts slide sizes between 1 and 56 inches.
  const clamp = (v: number) => Math.min(56 * 72, Math.max(72, v));
  const sw = clamp(slide.width);
  const sh = clamp(slide.height);
  const cx = Math.round(sw * EMU);
  const cy = Math.round(sh * EMU);
  const files: Record<string, Uint8Array> = {};
  pictures.forEach((pic, i) => {
    const n = i + 1;
    const ext = pic.mime === 'image/png' ? 'png' : 'jpeg';
    files[`ppt/media/image${n}.${ext}`] = pic.bytes;
    const scale = Math.min(sw / pic.width, sh / pic.height);
    const w = pic.width * scale;
    const h = pic.height * scale;
    const x = Math.round(((sw - w) / 2) * EMU);
    const y = Math.round(((sh - h) / 2) * EMU);
    const alt = pic.alt ? ` descr="${xmlText(pic.alt.slice(0, 4000))}"` : '';
    // Text boxes: one per line, no wrapping or insets, so each line keeps its place on the page.
    const texts = (pic.texts ?? [])
      .map((t, k) => {
        const runs = t.runs
          .filter((r) => r.text)
          .map((r) => {
            const face = xmlText(wordFont(r.font));
            const sz = Math.max(100, Math.round(r.size * scale * 100));
            return `<a:r><a:rPr lang="en-US" sz="${sz}"${r.bold ? ' b="1"' : ''}${r.italic ? ' i="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${r.color.toUpperCase()}"/></a:solidFill><a:latin typeface="${face}"/><a:cs typeface="${face}"/></a:rPr><a:t>${xmlText(r.text)}</a:t></a:r>`;
          })
          .join('');
        if (!runs) return '';
        const size = Math.max(...t.runs.map((r) => r.size)) * scale;
        // The box starts a little above the glyphs: PowerPoint puts the ascent of the line below the box top.
        const bx = x + Math.round(t.x * scale * EMU);
        const by = y + Math.round((t.y * scale - size * 0.12) * EMU);
        const bw = Math.round(Math.max(t.w * scale * 1.04 + 2, 4) * EMU);
        const bh = Math.round(Math.max(t.h * scale, size * 1.2) * EMU);
        const rot = t.rot ? ` rot="${Math.round(t.rot * 60000)}"` : '';
        return `<p:sp><p:nvSpPr><p:cNvPr id="${k + 3}" name="Text ${k + 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm${rot}><a:off x="${bx}" y="${by}"/><a:ext cx="${bw}" cy="${bh}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef></a:pPr>${runs}</a:p></p:txBody></p:sp>`;
      })
      .join('');
    files[`ppt/slides/slide${n}.xml`] = strToU8(
      `${HEAD}<p:sld ${NS_P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${n}"${alt}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${Math.round(w * EMU)}" cy="${Math.round(h * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>${texts}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'image', `../media/image${n}.${ext}`],
    ]);
  });
  const n = pictures.length;
  files['[Content_Types].xml'] = strToU8(
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  );
  files['_rels/.rels'] = strToU8(
    `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  files['ppt/presentation.xml'] = strToU8(
    `${HEAD}<p:presentation ${NS_P} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`,
  );
  files['ppt/_rels/presentation.xml.rels'] = rels([
    ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ['rId2', 'theme', 'theme/theme1.xml'],
    ...Array.from({ length: n }, (_, i): [string, string, string] => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`]),
  ]);
  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(MASTER);
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([
    ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
    ['rId2', 'theme', '../theme/theme1.xml'],
  ]);
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(LAYOUT);
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]);
  files['ppt/theme/theme1.xml'] = strToU8(THEME);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['docProps/core.xml'] = strToU8(
    `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${title ? `<dc:title>${xmlText(title)}</dc:title>` : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  files['docProps/app.xml'] = strToU8(`${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Metamorpher</Application><Slides>${n}</Slides></Properties>`);
  return new Blob([zipSync(files, { level: 1 })], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
