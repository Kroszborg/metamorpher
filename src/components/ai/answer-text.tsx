import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Splits a run of plain text into text and inline nodes (the chat uses it for citation chips). */
export type InlineSplitter = (text: string, key: string) => ReactNode[];

const INLINE = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1|`([^`\n]+)`|(?<![\w*])([*_])(?=\S)([^*_\n]+?)(?<=\S)\4(?![\w*])/g;

/** Bold, italic and code inside one line. Unbalanced markers (an answer still streaming) stay as typed. */
function inline(text: string, key: string, split?: InlineSplitter): ReactNode[] {
  const leaf = (s: string, k: string): ReactNode[] => (split ? split(s, k) : [s]);
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(...leaf(text.slice(last, at), `${key}t${n}`));
    const k = `${key}m${n++}`;
    if (m[2] !== undefined) {
      out.push(
        <strong key={k} className="font-semibold text-foreground">
          {inline(m[2], k, split)}
        </strong>,
      );
    } else if (m[3] !== undefined) {
      out.push(
        <code key={k} className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">
          {m[3]}
        </code>,
      );
    } else {
      out.push(<em key={k}>{inline(m[5] ?? '', k, split)}</em>);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(...leaf(text.slice(last), `${key}t${n}`));
  return out;
}

/**
 * A model's answer, shown as light Markdown: headings, bullet and numbered
 * lists, rules, bold, italic and code. It builds React nodes line by line, so
 * nothing in the answer is ever treated as HTML.
 */
export function AnswerText({ text, split, className, ...rest }: { text: string; split?: InlineSplitter; className?: string } & Record<`data-${string}`, string>) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let blank = false;
  lines.forEach((raw, i) => {
    const key = `l${i}`;
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      blank = blocks.length > 0;
      return;
    }
    const gap = blank ? 'mt-3' : blocks.length ? 'mt-1' : '';
    blank = false;
    const indent = Math.min(3, Math.floor((/^\s*/.exec(line)?.[0].replace(/\t/g, '  ').length ?? 0) / 2));
    const pad = { paddingLeft: `${indent * 1.1}rem` };
    let m: RegExpExecArray | null;
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={key} className="my-3 border-border" />);
    } else if ((m = /^\s*(#{1,6})\s+(.*?)\s*#*$/.exec(line))) {
      blocks.push(
        <p key={key} className={cn('font-semibold text-foreground', m[1]!.length <= 2 ? 'text-[1.05em]' : '', blocks.length ? 'mt-3' : '')}>
          {inline(m[2]!, key, split)}
        </p>,
      );
    } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      blocks.push(
        <div key={key} className={cn('flex gap-2', gap)} style={pad}>
          <span aria-hidden className="mt-[0.6em] size-1 shrink-0 rounded-full bg-muted-foreground" />
          <span className="min-w-0">{inline(m[1]!, key, split)}</span>
        </div>,
      );
    } else if ((m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line))) {
      blocks.push(
        <div key={key} className={cn('flex gap-2', gap)} style={pad}>
          <span className="shrink-0 tabular-nums text-muted-foreground">{m[1]}.</span>
          <span className="min-w-0">{inline(m[2]!, key, split)}</span>
        </div>,
      );
    } else {
      blocks.push(
        <p key={key} className={gap} style={indent ? pad : undefined}>
          {inline(line.trimStart(), key, split)}
        </p>,
      );
    }
  });
  return (
    <div className={cn('break-words', className)} {...rest}>
      {blocks.map((b, i) => (
        <Fragment key={i}>{b}</Fragment>
      ))}
    </div>
  );
}
