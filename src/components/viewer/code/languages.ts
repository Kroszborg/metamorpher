import type { StreamParser } from '@codemirror/language';

type Load = () => Promise<StreamParser<unknown>>;
const p = <T>(x: StreamParser<T>) => x as StreamParser<unknown>;

/** Syntax highlighters (CodeMirror legacy modes, MIT), loaded only when a file needs one. */
const BY_LANG: Record<string, { label: string; load: Load }> = {
  javascript: { label: 'JavaScript', load: () => import('@codemirror/legacy-modes/mode/javascript').then((m) => p(m.javascript)) },
  typescript: { label: 'TypeScript', load: () => import('@codemirror/legacy-modes/mode/javascript').then((m) => p(m.typescript)) },
  json: { label: 'JSON', load: () => import('@codemirror/legacy-modes/mode/javascript').then((m) => p(m.json)) },
  python: { label: 'Python', load: () => import('@codemirror/legacy-modes/mode/python').then((m) => p(m.python)) },
  ruby: { label: 'Ruby', load: () => import('@codemirror/legacy-modes/mode/ruby').then((m) => p(m.ruby)) },
  java: { label: 'Java', load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => p(m.java)) },
  kotlin: { label: 'Kotlin', load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => p(m.kotlin)) },
  scala: { label: 'Scala', load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => p(m.scala)) },
  c: { label: 'C', load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => p(m.c)) },
  cpp: { label: 'C++', load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => p(m.cpp)) },
  csharp: { label: 'C#', load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => p(m.csharp)) },
  dart: { label: 'Dart', load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => p(m.dart)) },
  objc: { label: 'Objective-C', load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => p(m.objectiveC)) },
  go: { label: 'Go', load: () => import('@codemirror/legacy-modes/mode/go').then((m) => p(m.go)) },
  rust: { label: 'Rust', load: () => import('@codemirror/legacy-modes/mode/rust').then((m) => p(m.rust)) },
  swift: { label: 'Swift', load: () => import('@codemirror/legacy-modes/mode/swift').then((m) => p(m.swift)) },
  lua: { label: 'Lua', load: () => import('@codemirror/legacy-modes/mode/lua').then((m) => p(m.lua)) },
  perl: { label: 'Perl', load: () => import('@codemirror/legacy-modes/mode/perl').then((m) => p(m.perl)) },
  r: { label: 'R', load: () => import('@codemirror/legacy-modes/mode/r').then((m) => p(m.r)) },
  julia: { label: 'Julia', load: () => import('@codemirror/legacy-modes/mode/julia').then((m) => p(m.julia)) },
  shell: { label: 'Shell', load: () => import('@codemirror/legacy-modes/mode/shell').then((m) => p(m.shell)) },
  powershell: { label: 'PowerShell', load: () => import('@codemirror/legacy-modes/mode/powershell').then((m) => p(m.powerShell)) },
  sql: { label: 'SQL', load: () => import('@codemirror/legacy-modes/mode/sql').then((m) => p(m.standardSQL)) },
  css: { label: 'CSS', load: () => import('@codemirror/legacy-modes/mode/css').then((m) => p(m.css)) },
  scss: { label: 'SCSS', load: () => import('@codemirror/legacy-modes/mode/css').then((m) => p(m.sCSS)) },
  less: { label: 'Less', load: () => import('@codemirror/legacy-modes/mode/css').then((m) => p(m.less)) },
  sass: { label: 'Sass', load: () => import('@codemirror/legacy-modes/mode/sass').then((m) => p(m.sass)) },
  html: { label: 'HTML', load: () => import('@codemirror/legacy-modes/mode/xml').then((m) => p(m.html)) },
  xml: { label: 'XML', load: () => import('@codemirror/legacy-modes/mode/xml').then((m) => p(m.xml)) },
  yaml: { label: 'YAML', load: () => import('@codemirror/legacy-modes/mode/yaml').then((m) => p(m.yaml)) },
  toml: { label: 'TOML', load: () => import('@codemirror/legacy-modes/mode/toml').then((m) => p(m.toml)) },
  ini: { label: 'INI / properties', load: () => import('@codemirror/legacy-modes/mode/properties').then((m) => p(m.properties)) },
  dockerfile: { label: 'Dockerfile', load: () => import('@codemirror/legacy-modes/mode/dockerfile').then((m) => p(m.dockerFile)) },
  cmake: { label: 'CMake', load: () => import('@codemirror/legacy-modes/mode/cmake').then((m) => p(m.cmake)) },
  latex: { label: 'LaTeX', load: () => import('@codemirror/legacy-modes/mode/stex').then((m) => p(m.stex)) },
  diff: { label: 'Diff', load: () => import('@codemirror/legacy-modes/mode/diff').then((m) => p(m.diff)) },
  protobuf: { label: 'Protocol Buffers', load: () => import('@codemirror/legacy-modes/mode/protobuf').then((m) => p(m.protobuf)) },
  haskell: { label: 'Haskell', load: () => import('@codemirror/legacy-modes/mode/haskell').then((m) => p(m.haskell)) },
  elm: { label: 'Elm', load: () => import('@codemirror/legacy-modes/mode/elm').then((m) => p(m.elm)) },
  erlang: { label: 'Erlang', load: () => import('@codemirror/legacy-modes/mode/erlang').then((m) => p(m.erlang)) },
  clojure: { label: 'Clojure', load: () => import('@codemirror/legacy-modes/mode/clojure').then((m) => p(m.clojure)) },
  lisp: { label: 'Common Lisp', load: () => import('@codemirror/legacy-modes/mode/commonlisp').then((m) => p(m.commonLisp)) },
  scheme: { label: 'Scheme', load: () => import('@codemirror/legacy-modes/mode/scheme').then((m) => p(m.scheme)) },
  ocaml: { label: 'OCaml', load: () => import('@codemirror/legacy-modes/mode/mllike').then((m) => p(m.oCaml)) },
  fsharp: { label: 'F#', load: () => import('@codemirror/legacy-modes/mode/mllike').then((m) => p(m.fSharp)) },
  vb: { label: 'Visual Basic', load: () => import('@codemirror/legacy-modes/mode/vb').then((m) => p(m.vb)) },
  pascal: { label: 'Pascal', load: () => import('@codemirror/legacy-modes/mode/pascal').then((m) => p(m.pascal)) },
  fortran: { label: 'Fortran', load: () => import('@codemirror/legacy-modes/mode/fortran').then((m) => p(m.fortran)) },
  asm: { label: 'Assembly', load: () => import('@codemirror/legacy-modes/mode/gas').then((m) => p(m.gas)) },
  nginx: { label: 'Nginx', load: () => import('@codemirror/legacy-modes/mode/nginx').then((m) => p(m.nginx)) },
  verilog: { label: 'Verilog', load: () => import('@codemirror/legacy-modes/mode/verilog').then((m) => p(m.verilog)) },
  vhdl: { label: 'VHDL', load: () => import('@codemirror/legacy-modes/mode/vhdl').then((m) => p(m.vhdl)) },
  tcl: { label: 'Tcl', load: () => import('@codemirror/legacy-modes/mode/tcl').then((m) => p(m.tcl)) },
  groovy: { label: 'Groovy', load: () => import('@codemirror/legacy-modes/mode/groovy').then((m) => p(m.groovy)) },
  octave: { label: 'MATLAB / Octave', load: () => import('@codemirror/legacy-modes/mode/octave').then((m) => p(m.octave)) },
};

const BY_EXT: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json', geojson: 'json', webmanifest: 'json', har: 'json', ipynb: 'json', map: 'json', ndjson: 'json', jsonl: 'json',
  py: 'python', pyw: 'python', pyi: 'python',
  rb: 'ruby', gemspec: 'ruby',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', sc: 'scala',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', ino: 'cpp', cs: 'csharp', dart: 'dart', m: 'objc', mm: 'objc',
  go: 'go', rs: 'rust', swift: 'swift', lua: 'lua', pl: 'perl', pm: 'perl', r: 'r', jl: 'julia',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell', ps1: 'powershell', psm1: 'powershell',
  sql: 'sql', css: 'css', scss: 'scss', less: 'less', sass: 'sass',
  html: 'html', htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html',
  xml: 'xml', svg: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', rss: 'xml', atom: 'xml', plist: 'xml', kml: 'xml', gpx: 'xml', csproj: 'xml', xaml: 'xml', fb2: 'xml', opf: 'xml',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini', editorconfig: 'ini', gitconfig: 'ini',
  dockerfile: 'dockerfile', cmake: 'cmake', tex: 'latex', sty: 'latex', cls: 'latex', bib: 'latex',
  diff: 'diff', patch: 'diff', proto: 'protobuf', hs: 'haskell', elm: 'elm', erl: 'erlang', ex: 'erlang', exs: 'erlang',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure', lisp: 'lisp', el: 'lisp', scm: 'scheme', rkt: 'scheme', ml: 'ocaml', mli: 'ocaml', fs: 'fsharp', fsx: 'fsharp',
  vb: 'vb', bas: 'vb', pas: 'pascal', f90: 'fortran', f: 'fortran', asm: 'asm', s: 'asm', nginx: 'nginx', v: 'verilog', sv: 'verilog', vhd: 'vhdl', vhdl: 'vhdl',
  tcl: 'tcl', groovy: 'groovy', gradle: 'groovy', matlab: 'octave',
};

export const LANGUAGE_OPTIONS = [
  { value: 'plain', label: 'Plain text' },
  ...Object.entries(BY_LANG)
    .map(([value, l]) => ({ value, label: l.label }))
    .sort((a, b) => a.label.localeCompare(b.label)),
];

/** The highlighter id for a file name ("plain" when none fits). */
export function languageFor(name: string, ext: string): string {
  const base = name.toLowerCase().split(/[\\/]/).pop() ?? '';
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'cmakelists.txt') return 'cmake';
  if (base === 'makefile' || base === '.bashrc' || base === '.zshrc' || base === '.profile') return 'shell';
  if (base === '.gitignore' || base === '.npmrc') return 'ini';
  return BY_EXT[ext] ?? 'plain';
}

export function loadLanguage(id: string): Promise<StreamParser<unknown>> | null {
  return BY_LANG[id]?.load() ?? null;
}

export function languageLabel(id: string): string {
  return BY_LANG[id]?.label ?? 'Plain text';
}
