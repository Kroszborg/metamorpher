'use client';

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  LeftToRightListNumberIcon,
  Search01Icon,
  TextWrapIcon,
} from '@hugeicons/core-free-icons';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { formatBytes } from '@/lib/files';
import { ChipButton, IconButton, Toolbar, ToolbarSelect, ToolbarSep, ViewerLoading, ViewerProblem } from '../bits';
import { CodeView, type CodeViewHandle } from '../code/code-view';
import { LANGUAGE_OPTIONS, languageFor } from '../code/languages';
import { type Shortcut, useShortcuts, type ViewerProps } from '../context';
import { encodingFromSniff, ENCODINGS, type Encoding, type Part, partCount, readPart } from './parts';

const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl + F', label: 'Search (in the text)' },
  { keys: 'Enter  Shift + Enter', label: 'Next or previous match' },
  { keys: 'Ctrl + Alt + G', label: 'Go to line' },
  { keys: 'Ctrl + A', label: 'Select all' },
];

export default function TextViewer({ file, sniff }: ViewerProps) {
  const [encoding, setEncoding] = useState<Encoding>(encodingFromSniff(sniff.encoding));
  const [language, setLanguage] = useState(() => languageFor(file.name, sniff.ext));
  const [wrap, setWrap] = useState(sniff.ext === 'txt' || sniff.ext === 'md' || sniff.format === 'Plain text');
  const [numbers, setNumbers] = useState(true);
  const [part, setPart] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; part: Part } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const code = useRef<CodeViewHandle>(null);
  useShortcuts(SHORTCUTS);
  const parts = partCount(file.size);
  const key = `${encoding}:${part}`;

  useEffect(() => {
    let live = true;
    readPart(file, part, encoding).then(
      (p) => live && setLoaded({ key, part: p }),
      (err: unknown) => live && setError(err instanceof Error ? err.message : 'The file could not be read.'),
    );
    return () => {
      live = false;
    };
  }, [file, part, encoding, key]);

  if (error) return <ViewerProblem title="This file could not be read">{error}</ViewerProblem>;
  const current = loaded?.part;
  const stale = loaded?.key !== key;
  const lines = current ? countLines(current.text) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <ToolbarSelect label="Language" value={language} onChange={setLanguage} options={LANGUAGE_OPTIONS} />
        <ToolbarSelect label="Encoding" value={encoding} onChange={setEncoding} options={ENCODINGS} />
        <ToolbarSep />
        <IconButton icon={TextWrapIcon} label="Wrap long lines" pressed={wrap} onClick={() => setWrap((v) => !v)} />
        <IconButton icon={LeftToRightListNumberIcon} label="Line numbers" pressed={numbers} onClick={() => setNumbers((v) => !v)} />
        <IconButton icon={Search01Icon} label="Search (Ctrl+F)" onClick={() => code.current?.search()} />
        <ChipButton onClick={() => code.current?.gotoLine()} title="Go to line (Ctrl+Alt+G)">
          Go to line
        </ChipButton>
        <IconButton
          icon={Copy01Icon}
          label={parts > 1 ? 'Copy this part' : 'Copy all'}
          onClick={() =>
            current &&
            navigator.clipboard.writeText(current.text).then(
              () => toast.success(`Copied ${lines.toLocaleString()} lines`),
              () => toast.error('Copy failed.'),
            )
          }
        />
      </Toolbar>
      <div className="relative min-h-0 flex-1">
        {current ? (
          <CodeView ref={code} text={current.text} language={language} wrap={wrap} numbers={numbers} label={`Text of ${file.name}`} />
        ) : (
          <ViewerLoading label="Reading the text…" />
        )}
        {stale && current ? <div className="pointer-events-none absolute inset-0 bg-background/40" /> : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {lines.toLocaleString()} line{lines === 1 ? '' : 's'} · {current ? current.text.length.toLocaleString() : 0} characters
          {parts > 1 && current ? ` · bytes ${formatBytes(current.start)}–${formatBytes(current.end)} of ${formatBytes(file.size)}` : ''}
        </span>
        {parts > 1 ? (
          <span className="flex items-center gap-1">
            <IconButton
              icon={ArrowLeft01Icon}
              label="Previous part"
              className="h-7 min-w-7"
              disabled={part === 0}
              onClick={() => setPart((p) => Math.max(0, p - 1))}
            />
            <label className="flex items-center gap-1">
              Part
              <input
                type="number"
                min={1}
                max={parts}
                value={part + 1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setPart(Math.max(0, Math.min(parts - 1, Math.round(v) - 1)));
                }}
                className="h-7 w-16 rounded-md border border-input bg-background px-1.5 text-center text-xs tabular-nums text-foreground"
                aria-label="Part number"
              />
              of {parts.toLocaleString()}
            </label>
            <IconButton
              icon={ArrowRight01Icon}
              label="Next part"
              className="h-7 min-w-7"
              disabled={part >= parts - 1}
              onClick={() => setPart((p) => Math.min(parts - 1, p + 1))}
            />
          </span>
        ) : null}
      </footer>
    </div>
  );
}

function countLines(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
  return text.endsWith('\n') ? n - 1 : n;
}
