/** Stylesheets for documents the typeset engine lays out (CSS that MuPDF's HTML engine understands). */

export type ThemeOptions = {
  /** Body size in points. */
  fontSize: number;
  font: 'sans' | 'serif' | 'mono';
  /** Line height as a multiple of the font size. */
  lineHeight?: number;
};

const FAMILY = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' } as const;

/** A clean, GitHub-like document style: headings, lists, tables, code, quotes, images. */
export function documentCss({ fontSize, font, lineHeight = 1.45 }: ThemeOptions): string {
  const code = Math.max(7, fontSize * 0.86).toFixed(2);
  return `
body{font-family:${FAMILY[font]};font-size:${fontSize}pt;line-height:${lineHeight};color:#1f2328;margin:0}
h1,h2,h3,h4,h5,h6{font-weight:bold;line-height:1.25;margin:1.15em 0 0.5em;page-break-after:avoid}
h1{font-size:2em;border-bottom:0.75pt solid #d0d7de;padding-bottom:0.2em}
h2{font-size:1.5em;border-bottom:0.75pt solid #d8dee4;padding-bottom:0.18em}
h3{font-size:1.25em}
h4{font-size:1.05em}
h5{font-size:1em}
h6{font-size:0.92em;color:#59636e}
body>h1:first-child,body>h2:first-child{margin-top:0}
p{margin:0 0 0.75em}
a{color:#0969da;text-decoration:none}
ul,ol{margin:0 0 0.75em;padding-left:1.7em}
li{margin:0.12em 0}
li>ul,li>ol{margin:0.12em 0 0}
ul,ul ul,ul ul ul{list-style-type:disc}
li.task{list-style-type:none}
dl{margin:0 0 0.75em}
dt{font-weight:bold;margin-top:0.4em}
dd{margin:0 0 0.4em 1.6em}
code,kbd,samp,tt{font-family:monospace;font-size:0.88em}
code{background-color:#eff1f3;padding:0 0.2em}
kbd{border:0.75pt solid #d0d7de;background-color:#f6f8fa;padding:0 0.25em}
pre{font-family:monospace;font-size:${code}pt;line-height:1.38;background-color:#f6f8fa;border:0.75pt solid #d8dee4;padding:0.6em 0.8em;margin:0 0 0.9em;white-space:pre-wrap}
pre code{background-color:transparent;padding:0;font-size:1em}
blockquote{margin:0 0 0.9em;padding:0 0 0 0.9em;border-left:2.5pt solid #d0d7de;color:#59636e}
hr{border:none;border-top:0.75pt solid #d0d7de;margin:1.2em 0}
table{border-collapse:collapse;margin:0 0 0.9em}
th,td{border:0.75pt solid #d0d7de;padding:0.25em 0.6em;vertical-align:baseline}
th{background-color:#f6f8fa;font-weight:bold}
img{max-width:100%}
figure{margin:0 0 0.9em}
figcaption{font-size:0.9em;color:#59636e}
mark{background-color:#fff8c5}
del,s,strike{text-decoration:line-through}
sub{vertical-align:sub;font-size:0.8em}
sup{vertical-align:super;font-size:0.8em}
.mm-missing-image{color:#9a6700;font-style:italic}
`;
}
