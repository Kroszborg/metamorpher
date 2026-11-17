export { columnAlignment, detectDelimiter, parseCsv } from './csv';
export { DocToPdfTool, type PasteConfig } from './doc-tool';
export { prepareHtml, type PreparedHtml } from './html';
export { dataUrlBlob, findResource, imageDataUrl, isImageFile, isRemote, resourceMap, type Resources } from './images';
export { type DocJobOptions, type DocReport, docToPdfJob, type Prepared, resultNotes } from './job';
export { markdownToHtml, stripFrontMatter } from './markdown';
export { imageNotes, modelNotes, plural } from './notes';
export { defaultPageSetup, geometryOf, type PageSetup, PageSetupFields, type TextSize } from './options';
export { prepareDocx, prepareHtmlFile, prepareMarkdown, prepareText } from './prepare';
export { decodeText, looksBinary } from './text';

/** Body sizes in points for the text-size choice. */
export const BODY_SIZE = { small: 9.5, medium: 10.5, large: 12 } as const;
