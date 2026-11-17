/**
 * LaTeX résumé templates, written for this project (AGPL-3.0-or-later like
 * the rest of Metamorpher; no third-party template code). Each template is a
 * generator: the shipped starting document is the generator applied to the
 * example résumé, and "form → LaTeX" applies it to the user's form.
 * Everything compiles with pdfLaTeX and the bundled package subset.
 */
import { BULLET, parseInline, safeHref } from '../inline';
import type { Entry, Resume, Section } from '../model';

export type LatexTemplateId = 'classic' | 'banking' | 'sidebar' | 'deedy' | 'academic';

export type LatexTemplate = { id: LatexTemplateId; label: string; hint: string; build: (r: Resume) => string };

/** Escapes text for LaTeX (UTF-8 input; T1 fonts). */
export function tex(text: string): string {
  return text
    .replace(/\\/g, '\u0000')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\u0000/g, '\\textbackslash{}')
    .replace(/–/g, '--')
    .replace(/—/g, '---')
    .replace(/→/g, '$\\rightarrow$')
    .replace(/₹/g, 'Rs.~')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '\\ldots{}')
    .replace(/•/g, '\\textbullet{}');
}

/** **bold**, *italic* and [label](link) as LaTeX. */
export function texInline(text: string): string {
  return parseInline(text)
    .map((s) => {
      if (s.href) {
        const h = safeHref(s.href);
        return h ? `\\href{${h.replace(/([%#\\])/g, '\\$1')}}{${tex(s.text)}}` : tex(s.text);
      }
      if (s.bold) return `\\textbf{${tex(s.text)}}`;
      if (s.italic) return `\\textit{${tex(s.text)}}`;
      return tex(s.text);
    })
    .join('');
}

function url(raw: string): string {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v) || /^mailto:/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  return `https://${v}`;
}

function href(raw: string, label = raw): string {
  return `\\href{${url(raw).replace(/([%#\\])/g, '\\$1')}}{${tex(label.trim())}}`;
}

function filled(e: Entry): boolean {
  return !!(e.title.trim() || e.org.trim() || e.text.trim() || e.url.trim() || e.start.trim() || e.end.trim());
}

function visible(r: Resume): Section[] {
  return r.sections.filter((s) => !s.hidden && s.entries.some(filled)).map((s) => ({ ...s, entries: s.entries.filter(filled) }));
}

function dates(e: Entry): string {
  const a = e.start.trim();
  const b = e.end.trim();
  return tex(a && b ? `${a} – ${b}` : a || b);
}

/** Bullet lines → itemize; other lines → paragraphs. */
function body(text: string, list = 'itemize'): string {
  const out: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) out.push(`\\begin{${list}}\n${items.map((i) => `  \\item ${texInline(i)}`).join('\n')}\n\\end{${list}}`);
    items = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = BULLET.exec(line);
    if (m) {
      items.push(m[1] as string);
      continue;
    }
    flush();
    if (line) out.push(`${texInline(line)}\\par`);
  }
  flush();
  return out.join('\n');
}

function contacts(r: Resume): { icon: string; text: string }[] {
  const p = r.profile;
  const out: { icon: string; text: string }[] = [];
  if (p.email.trim()) out.push({ icon: 'faEnvelope', text: href(p.email) });
  if (p.phone.trim()) out.push({ icon: 'faPhone', text: tex(p.phone.trim()) });
  if (p.location.trim()) out.push({ icon: 'faMapMarker*', text: tex(p.location.trim()) });
  if (p.website.trim()) out.push({ icon: 'faGlobe', text: href(p.website) });
  if (p.linkedin.trim()) out.push({ icon: 'faLinkedin', text: href(p.linkedin) });
  if (p.github.trim()) out.push({ icon: 'faGithub', text: href(p.github) });
  return out;
}

function colour(hex: string): string {
  return hex.replace('#', '').toUpperCase();
}

const PREAMBLE = (r: Resume, font: string, extra = '') => `\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
${font}
\\usepackage[${r.paper === 'letter' ? 'letterpaper' : 'a4paper'},margin=0.65in]{geometry}
\\usepackage[dvipsnames]{xcolor}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{tabularx}
\\usepackage[hidelinks,pdfusetitle]{hyperref}
\\input{glyphtounicode}
\\pdfgentounicode=1
\\definecolor{accent}{HTML}{${colour(r.accent)}}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlist[itemize]{leftmargin=1.1em,itemsep=1pt,topsep=2pt,parsep=0pt,label=\\textbullet}
${extra}`;

function meta(r: Resume): string {
  const name = tex(r.profile.name.trim() || 'Your Name');
  const headline = r.profile.headline.trim() ? ` -- ${tex(r.profile.headline.trim())}` : '';
  return `\\title{${name}${headline}}\n\\author{${name}}\n\\date{}`;
}

// ── Classic: one column, small caps rules (ATS-safe) ─────────────────────

function classic(r: Resume): string {
  const p = r.profile;
  const parts = contacts(r).map((c) => c.text);
  let out = `% Classic one-column résumé (Metamorpher template, AGPL-3.0-or-later).
% Plain one-column layout that applicant tracking systems read well.
\\documentclass[11pt]{article}
${PREAMBLE(r, '\\usepackage{lmodern}', `\\titleformat{\\section}{\\large\\scshape\\raggedright}{}{0pt}{}[\\vspace{1pt}\\titlerule]
\\titlespacing*{\\section}{0pt}{9pt}{5pt}
\\newcommand{\\entry}[4]{%
  \\begin{tabularx}{\\linewidth}{@{}>{\\raggedright\\arraybackslash}X r@{}}
    \\textbf{#1} & #2 \\\\
    \\textit{\\small #3} & \\textit{\\small #4}
  \\end{tabularx}\\par}`)}
${meta(r)}

\\begin{document}

\\begin{center}
  {\\Huge\\scshape ${tex(p.name.trim() || 'Your Name')}}\\\\[3pt]
${p.headline.trim() ? `  {\\large ${tex(p.headline.trim())}}\\\\[3pt]\n` : ''}  \\small ${parts.join(' $|$ ')}
\\end{center}
`;
  for (const s of visible(r)) {
    out += `\n\\section{${tex(s.title)}}\n`;
    out += sectionBody(s, (e) => `\\entry{${tex(e.title.trim() || e.org.trim())}}{${dates(e)}}{${tex(e.title.trim() ? e.org.trim() : '')}${e.url.trim() ? `${e.org.trim() ? ' -- ' : ''}${href(e.url)}` : ''}}{${tex(e.location.trim())}}`);
  }
  return `${out}\n\\end{document}\n`;
}

/** Shared section bodies: summary, skills, links, and entries through `entry`. */
function sectionBody(s: Section, entry: (e: Entry) => string, skillsSep = '\\\\'): string {
  if (s.kind === 'summary') return `${s.entries.map((e) => body(e.text)).join('\n')}\n`;
  if (s.kind === 'skills') {
    return `${s.entries.map((e) => `${e.title.trim() ? `\\textbf{${tex(e.title.trim())}:} ` : ''}${texInline(e.text.replace(/\s*\n\s*/g, ', ').trim())}`).join(` ${skillsSep}\n`)}\n`;
  }
  if (s.kind === 'links') {
    return `${s.entries.map((e) => `${e.title.trim() ? `\\textbf{${tex(e.title.trim())}:} ` : ''}${href(e.url || e.text)}`).join(` ${skillsSep}\n`)}\n`;
  }
  return s.entries.map((e) => `${entry(e)}\n${e.text.trim() ? `${body(e.text)}\n` : ''}\\vspace{4pt}\n`).join('');
}

// ── Banking: dates in a left margin column, accent rules (moderncv-like) ──

function banking(r: Resume): string {
  const p = r.profile;
  const c = contacts(r);
  let out = `% Banking-style CV with a date column (Metamorpher template, AGPL-3.0-or-later).
% Written for Metamorpher in the spirit of moderncv's classic look; no moderncv code.
\\documentclass[10pt]{article}
${PREAMBLE(r, '\\usepackage{tgheros}\n\\renewcommand{\\familydefault}{\\sfdefault}', `\\usepackage{fontawesome5}
\\usepackage{etoolbox}
\\newlength{\\datecol}\\AtBeginDocument{\\setlength{\\datecol}{0.17\\linewidth}}
\\titleformat{\\section}{\\color{accent}\\Large}{}{0pt}{\\makebox[\\datecol][r]{\\color{accent}\\rule[0.3ex]{0.9\\datecol}{2.5pt}}\\hspace{0.6em}}
\\titlespacing*{\\section}{0pt}{10pt}{5pt}
\\newcommand{\\cventry}[5]{%
  \\begin{tabularx}{\\linewidth}{@{}>{\\raggedleft\\arraybackslash\\color{gray}\\small}p{\\datecol} @{\\hspace{0.6em}} X@{}}
    #1 & \\textbf{#2}\\ifblank{#3}{}{, \\textit{#3}}\\ifblank{#4}{}{\\hfill{\\small\\color{gray}#4}}\\ifblank{#5}{}{\\par\\vspace{1pt}#5} \\\\
  \\end{tabularx}\\par}`)}
${meta(r)}

\\begin{document}

{\\fontsize{30}{34}\\selectfont\\color{accent} ${tex(p.name.trim() || 'Your Name')}}\\par
${p.headline.trim() ? `\\vspace{3pt}{\\Large\\color{gray} ${tex(p.headline.trim())}}\\par\n` : ''}\\vspace{6pt}
{\\raggedright\\small ${c.map((x) => `\\${x.icon.replace('*', '')}\\ ${x.text}`).join(' \\quad ')}\\par}
\\vspace{4pt}
`;
  for (const s of visible(r)) {
    out += `\n\\section{${tex(s.title)}}\n`;
    if (s.kind === 'summary' || s.kind === 'skills' || s.kind === 'links') {
      out += `{\\leftskip=\\dimexpr\\datecol+0.6em\\relax\n${sectionBody(s, () => '')}\\par}\n`;
      continue;
    }
    out += s.entries
      .map((e) => {
        const details = e.text.trim() ? `\n${body(e.text)}` : '';
        return `\\cventry{${dates(e)}}{${tex(e.title.trim() || e.org.trim())}}{${tex(e.title.trim() ? e.org.trim() : '')}${e.url.trim() ? ` ${href(e.url)}` : ''}}{${tex(e.location.trim())}}{${details}}\n\\vspace{3pt}\n`;
      })
      .join('');
  }
  return `${out}\n\\end{document}\n`;
}

// ── Sidebar: two columns with paracol (AltaCV-like) ──────────────────────

const SIDE = new Set(['skills', 'links', 'education']);

function sidebar(r: Resume): string {
  const p = r.profile;
  const c = contacts(r);
  const secs = visible(r);
  const side = secs.filter((s) => SIDE.has(s.kind));
  const main = secs.filter((s) => !SIDE.has(s.kind));
  const entry = (e: Entry) =>
    `{\\large\\bfseries ${tex(e.title.trim() || e.org.trim())}}\\\\\n${e.title.trim() && e.org.trim() ? `{\\color{accent}\\bfseries ${tex(e.org.trim())}}\\\\\n` : ''}{\\small\\color{gray}${dates(e) ? `\\faCalendar*[regular]~${dates(e)}` : ''}${e.location.trim() ? `\\hspace{1em}\\faMapMarker*~${tex(e.location.trim())}` : ''}${e.url.trim() ? `\\hspace{1em}\\faLink~${href(e.url)}` : ''}}\\par`;
  const sideEntry = (e: Entry) =>
    `\\textbf{${tex(e.title.trim() || e.org.trim())}}\\\\\n${e.title.trim() && e.org.trim() ? `${tex(e.org.trim())}\\\\\n` : ''}{\\small\\color{gray}${dates(e)}${e.location.trim() ? ` \\textbar{} ${tex(e.location.trim())}` : ''}}\\par`;
  let out = `% Two-column CV with a sidebar (Metamorpher template, AGPL-3.0-or-later).
% Written for Metamorpher in the spirit of AltaCV; uses paracol so both columns break across pages.
\\documentclass[10pt]{article}
${PREAMBLE(r, '\\usepackage{tgheros}\n\\renewcommand{\\familydefault}{\\sfdefault}', `\\usepackage{fontawesome5}
\\usepackage{paracol}
\\geometry{margin=0.55in}
\\columnratio{0.33}
\\setlength{\\columnsep}{1.6em}
\\titleformat{\\section}{\\color{accent}\\large\\bfseries}{}{0pt}{\\MakeUppercase}[\\vspace{-6pt}{\\color{accent}\\rule{\\linewidth}{1pt}}]
\\titlespacing*{\\section}{0pt}{10pt}{6pt}`)}
${meta(r)}

\\begin{document}

{\\fontsize{26}{30}\\selectfont\\bfseries ${tex(p.name.trim() || 'Your Name')}}\\par
${p.headline.trim() ? `\\vspace{2pt}{\\large\\color{accent} ${tex(p.headline.trim())}}\\par\n` : ''}\\vspace{4pt}
{\\raggedright\\small ${c.map((x) => `\\mbox{\\textcolor{accent}{\\${x.icon}}~${x.text}}`).join('\\hspace{1.2em plus 0.5em}\n')}\\par}
\\vspace{2pt}

\\begin{paracol}{2}
`;
  for (const s of side) out += `\n\\section{${tex(s.title)}}\n${sectionBody(s, sideEntry, '\\\\[2pt]')}`;
  out += `\n\\switchcolumn\n`;
  for (const s of main) out += `\n\\section{${tex(s.title)}}\n${sectionBody(s, entry)}`;
  return `${out}\n\\end{paracol}\n\\end{document}\n`;
}

// ── Deedy-like: light/bold name header, narrow left column ───────────────

function deedy(r: Resume): string {
  const p = r.profile;
  const words = (p.name.trim() || 'Your Name').split(/\s+/);
  const last = words.length > 1 ? (words.pop() as string) : '';
  const first = words.join(' ');
  const c = contacts(r).map((x) => x.text);
  const secs = visible(r);
  const left = secs.filter((s) => SIDE.has(s.kind));
  const right = secs.filter((s) => !SIDE.has(s.kind));
  const entry = (e: Entry) =>
    `{\\large ${tex(e.org.trim() || e.title.trim())}}${e.location.trim() ? ` {\\small\\color{gray}| ${tex(e.location.trim())}}` : ''}\\\\\n${e.org.trim() && e.title.trim() ? `{\\color{accent}\\small\\MakeUppercase{${tex(e.title.trim())}}}` : ''}${dates(e) ? ` {\\small\\color{gray}\\hfill ${dates(e)}}` : ''}${e.url.trim() ? `\\\\\n{\\small ${href(e.url)}}` : ''}\\par`;
  const sideEntry = (e: Entry) =>
    `\\textbf{${tex(e.title.trim() || e.org.trim())}}\\\\\n${e.title.trim() && e.org.trim() ? `${tex(e.org.trim())}\\\\\n` : ''}{\\small\\color{gray}${dates(e)}}\\par`;
  let out = `% Deedy-style résumé (Metamorpher template, AGPL-3.0-or-later).
% Original layout in the spirit of Deedy Resume, rebuilt for pdfLaTeX; no Deedy code.
\\documentclass[10pt]{article}
${PREAMBLE(r, '\\usepackage{tgheros}\n\\renewcommand{\\familydefault}{\\sfdefault}', `\\usepackage{paracol}
\\geometry{margin=0.5in}
\\columnratio{0.3}
\\setlength{\\columnsep}{1.5em}
\\titleformat{\\section}{\\color{gray}\\Large}{}{0pt}{\\MakeUppercase}
\\titlespacing*{\\section}{0pt}{8pt}{4pt}`)}
${meta(r)}

\\begin{document}

\\begin{center}
{\\fontsize{32}{36}\\selectfont\\color{gray}${tex(first)}${last ? ` \\textbf{\\color{black}${tex(last)}}` : ''}}\\\\[6pt]
{\\small ${c.join(' \\textbar{} ')}}
\\end{center}
\\vspace{2pt}

\\begin{paracol}{2}
`;
  for (const s of left) out += `\n\\section{${tex(s.title)}}\n${sectionBody(s, sideEntry, '\\\\[2pt]')}`;
  out += `\n\\switchcolumn\n`;
  for (const s of right) out += `\n\\section{${tex(s.title)}}\n${sectionBody(s, entry)}`;
  return `${out}\n\\end{paracol}\n\\end{document}\n`;
}

// ── Academic CV: serif, numbered publications ────────────────────────────

function academic(r: Resume): string {
  const p = r.profile;
  const c = contacts(r).map((x) => x.text);
  let out = `% Academic CV (Metamorpher template, AGPL-3.0-or-later).
% Serif one-column CV; a "Publications" custom section becomes a numbered list.
\\documentclass[11pt]{article}
${PREAMBLE(r, '\\usepackage{tgpagella}', `\\geometry{margin=1in}
\\titleformat{\\section}{\\color{accent}\\large\\bfseries}{}{0pt}{}[{\\color{accent}\\titlerule[0.6pt]}]
\\titlespacing*{\\section}{0pt}{12pt}{6pt}
\\setlist[enumerate]{leftmargin=2em,itemsep=3pt,label={[\\arabic*]}}`)}
${meta(r)}

\\begin{document}

{\\LARGE\\bfseries ${tex(p.name.trim() || 'Your Name')}}\\par
${p.headline.trim() ? `\\vspace{2pt}{\\itshape ${tex(p.headline.trim())}}\\par\n` : ''}\\vspace{4pt}
{\\raggedright\\small ${c.join(' \\quad ')}\\par}
`;
  for (const s of visible(r)) {
    out += `\n\\section{${tex(s.title)}}\n`;
    if (/publication|paper/i.test(s.title)) {
      out += `\\begin{enumerate}\n${s.entries.map((e) => `  \\item ${tex([e.title, e.org, e.start].map((x) => x.trim()).filter(Boolean).join('. '))}${e.url.trim() ? ` ${href(e.url)}` : ''}${e.text.trim() ? `\\\\ ${tex(e.text.trim().replace(/\n/g, ' '))}` : ''}`).join('\n')}\n\\end{enumerate}\n`;
      continue;
    }
    out += sectionBody(
      s,
      (e) =>
        `\\begin{tabularx}{\\linewidth}{@{}>{\\raggedright\\arraybackslash}X r@{}}\\textbf{${tex(e.title.trim() || e.org.trim())}}${e.title.trim() && e.org.trim() ? `, ${tex(e.org.trim())}` : ''}${e.location.trim() ? `, ${tex(e.location.trim())}` : ''} & ${dates(e)}\\end{tabularx}${e.url.trim() ? `\\\\ ${href(e.url)}` : ''}\\par`,
    );
  }
  return `${out}\n\\end{document}\n`;
}

export const LATEX_TEMPLATES: readonly LatexTemplate[] = [
  { id: 'classic', label: 'Classic', hint: 'One column, small-caps rules; reads well in applicant tracking systems.', build: classic },
  { id: 'banking', label: 'Banking', hint: 'Dates in a margin column, accent rules (moderncv-like).', build: banking },
  { id: 'sidebar', label: 'Sidebar', hint: 'Two columns with icons (AltaCV-like); both columns break across pages.', build: sidebar },
  { id: 'deedy', label: 'Deedy-style', hint: 'Big two-tone name, narrow left column.', build: deedy },
  { id: 'academic', label: 'Academic CV', hint: 'Serif, numbered publications.', build: academic },
];

/** Packages the bundled TeX tree provides (shown in the editor). */
export const AVAILABLE_PACKAGES = [
  'amsmath', 'amssymb', 'array', 'babel (english)', 'bookmark', 'calc', 'enumitem', 'etoolbox', 'fancyhdr',
  'fontawesome5', 'fontenc', 'geometry', 'graphicx', 'helvet', 'hyperref', 'ifthen', 'inputenc', 'lmodern', 'marvosym',
  'mathpazo', 'microtype', 'multicol', 'needspace', 'paracol', 'parskip', 'ragged2e', 'setspace', 'tabularx', 'tgheros',
  'tex-gyre (pagella, termes, heros…)', 'titlesec', 'titling', 'url', 'xcolor', 'xparse',
] as const;
