'use client';

import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { type Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type CodeEditorHandle = {
  /** Moves the cursor to a 1-based line and scrolls it into view. */
  goToLine(line: number): void;
  focus(): void;
};

export type EditorDiagnostic = { line: number; severity: 'error' | 'warning'; message: string };

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--viz-2)' },
  { tag: [t.tagName, t.typeName], color: 'var(--primary)' },
  { tag: t.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: [t.bracket, t.paren, t.squareBracket], color: 'var(--viz-3)' },
  { tag: [t.string, t.atom], color: 'var(--success)' },
  { tag: t.number, color: 'var(--warning)' },
  { tag: t.variableName, color: 'var(--viz-2)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'var(--card)', color: 'var(--foreground)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace', lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--primary) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in oklch, var(--primary) 12%, transparent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent) !important' },
  '.cm-panels': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--warning) 30%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)' },
});

const COMMANDS = [
  'section{}', 'subsection{}', 'textbf{}', 'textit{}', 'emph{}', 'underline{}', 'href{}{}', 'url{}', 'item ', 'begin{itemize}',
  'begin{enumerate}', 'begin{tabularx}{\\linewidth}{@{}X r@{}}', 'end{}', 'usepackage{}', 'documentclass{}', 'vspace{}', 'hspace{}',
  'hfill', 'newline', 'small', 'large', 'Large', 'LARGE', 'huge', 'Huge', 'textcolor{}{}', 'color{}', 'faEnvelope', 'faPhone',
  'faGithub', 'faLinkedin', 'faGlobe', 'faMapMarker*', 'switchcolumn', 'columnratio{}', 'titleformat{}', 'setlist{}', 'geometry{}',
  'definecolor{}{HTML}{}', 'textsc{}', 'scshape', 'bfseries', 'itshape', 'centering', 'raggedright', 'par', 'noindent',
];

function complete(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\\[A-Za-z]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return { from: word.from + 1, options: COMMANDS.map((c) => ({ label: c, type: 'keyword' })) };
}

/** CodeMirror 6 with LaTeX highlighting, line numbers, search (Ctrl+F), brackets and diagnostics. */
export const CodeEditor = forwardRef<
  CodeEditorHandle,
  { value: string; onChange: (v: string) => void; diagnostics: EditorDiagnostic[]; readOnly?: boolean; label: string }
>(function CodeEditor({ value, onChange, diagnostics, readOnly = false, label }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const v = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          lintGutter(),
          history(),
          drawSelection(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          autocompletion({ override: [complete], activateOnTyping: true }),
          StreamLanguage.define(stex),
          syntaxHighlighting(highlight),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) change.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The document is synced below; the editor is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outside changes (template, upload, form → LaTeX) replace the document.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc;
    const list: Diagnostic[] = diagnostics
      .filter((d) => d.line >= 1 && d.line <= doc.lines)
      .map((d) => {
        const line = doc.line(d.line);
        return { from: line.from, to: Math.max(line.from, line.to), severity: d.severity, message: d.message };
      });
    v.dispatch(setDiagnostics(v.state, list));
  }, [diagnostics, value]);

  useImperativeHandle(ref, () => ({
    goToLine(n: number) {
      const v = view.current;
      if (!v) return;
      const line = v.state.doc.line(Math.min(Math.max(1, n), v.state.doc.lines));
      v.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
      v.focus();
    },
    focus() {
      view.current?.focus();
    },
  }));

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
});
