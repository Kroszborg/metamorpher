'use client';

import { foldGutter, HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { tags as t } from '@lezer/highlight';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { cn } from '@/lib/utils';
import { loadLanguage } from './languages';

export type CodeViewHandle = {
  search(): void;
  gotoLine(): void;
  /** Selects a 1-based line (and column range) and scrolls it into view. */
  reveal(line: number, from?: number, to?: number): void;
  focus(): void;
};

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--viz-2)' },
  { tag: [t.tagName, t.typeName, t.className, t.namespace], color: 'var(--primary)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--viz-3)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--success)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--warning)' },
  { tag: [t.definition(t.variableName), t.function(t.variableName)], color: 'var(--foreground)', fontWeight: '600' },
  { tag: [t.heading], fontWeight: '700', color: 'var(--primary)' },
  { tag: [t.inserted], color: 'var(--success)' },
  { tag: [t.deleted], color: 'var(--destructive)' },
  { tag: t.invalid, color: 'var(--destructive)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'var(--background)', color: 'var(--foreground)' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.6',
  },
  '.cm-content': { caretColor: 'var(--foreground)' },
  '.cm-gutters': { backgroundColor: 'var(--card)', color: 'var(--faint)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--primary) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in oklch, var(--primary) 12%, transparent)', color: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 28%, transparent) !important',
  },
  '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--foreground)', borderColor: 'var(--border)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 8px', fontSize: '12px' },
  '.cm-panel input, .cm-panel button, .cm-textfield': {
    fontSize: '12px',
    borderRadius: '6px',
    border: '1px solid var(--input)',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    padding: '2px 6px',
  },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--muted)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--warning) 28%, transparent)', borderRadius: '2px' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklch, var(--primary) 45%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklch, var(--primary) 14%, transparent)' },
  '.cm-foldGutter span': { color: 'var(--muted-foreground)' },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)' },
});

/**
 * A read-only CodeMirror 6 view: syntax highlighting (lazy per language), line
 * numbers, wrapping, search (Ctrl+F) and go to line. Text can be selected and
 * copied, never edited.
 */
export const CodeView = forwardRef<
  CodeViewHandle,
  { text: string; language: string; wrap?: boolean; numbers?: boolean; label: string; className?: string }
>(function CodeView({ text, language, wrap = false, numbers = true, label, className }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const gutter = useRef(new Compartment());

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const v = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: '',
        extensions: [
          gutter.current.of([]),
          highlightActiveLine(),
          drawSelection(),
          highlightSelectionMatches(),
          search({ top: true }),
          // Edit commands refuse to run on a read-only state; movement, selection and search work.
          keymap.of([...searchKeymap, ...defaultKeymap]),
          EditorState.readOnly.of(true),
          syntaxHighlighting(highlight),
          lang.current.of([]),
          wrapping.current.of([]),
          theme,
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': 'true' }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, [label]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: EditorSelection.cursor(0) });
    v.scrollDOM.scrollTop = 0;
  }, [text]);

  useEffect(() => {
    view.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  useEffect(() => {
    view.current?.dispatch({
      effects: gutter.current.reconfigure(numbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : []),
    });
  }, [numbers]);

  useEffect(() => {
    let live = true;
    const load = loadLanguage(language);
    if (!load) {
      view.current?.dispatch({ effects: lang.current.reconfigure([]) });
      return;
    }
    load.then(
      (parser) => {
        if (live) view.current?.dispatch({ effects: lang.current.reconfigure(StreamLanguage.define(parser)) });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [language]);

  useImperativeHandle(
    ref,
    () => ({
      search: () => {
        const v = view.current;
        if (v) openSearchPanel(v);
      },
      gotoLine: () => {
        const v = view.current;
        if (v) gotoLine(v);
      },
      reveal: (line, from, to) => {
        const v = view.current;
        if (!v) return;
        const l = v.state.doc.line(Math.max(1, Math.min(v.state.doc.lines, line)));
        const a = from !== undefined ? Math.min(l.to, l.from + from) : l.from;
        const b = to !== undefined ? Math.min(l.to, l.from + to) : a;
        v.dispatch({ selection: EditorSelection.range(a, b), effects: EditorView.scrollIntoView(a, { y: 'center' }) });
        v.focus();
      },
      focus: () => view.current?.focus(),
    }),
    [],
  );

  return <div ref={host} className={cn('h-full min-h-0 overflow-hidden', className)} />;
});
