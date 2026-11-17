'use client';

import { Calendar03Icon, Delete02Icon, SquareLock02Icon, TextIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useRef, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { BlobImage, CSS_FONT, PdfStage, StageItem, type StageView, todayString } from '@/components/pdf-stage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dropzone, OptionField, perFile, Results, RunBar, useWorkbench } from '@/components/workbench';
import { type OverlayContent, type OverlayItem, pdfStamp, type Placement, TEXT_BASELINE, TEXT_LINE } from '@/engines/pdf-stamp';
import { baseName, newId } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import { type Ink, measureHelvetica } from './ink';
import { SignatureMaker } from './signature-maker';

type Item = {
  id: string;
  /** The input file this item belongs to (a new file starts empty). */
  fileId: string;
  page: number;
  placement: Placement;
  content: OverlayContent;
  label: string;
};

type Saved = Ink & { id: string };

const job = perFile<Item[]>(async (input, items, ctx) => {
  const own: OverlayItem[] = items
    .filter((i) => i.fileId === input.id)
    .map(({ page, placement, content }) => ({ page, placement, content }));
  if (own.length === 0) throw new Error('Place a signature, date or text on the PDF first.');
  ctx.onProgress(0.1, 'Signing');
  const blob = await pdfStamp.placeOverlays(input.file, own, ctx.signal);
  return { name: `${baseName(input.file.name)}-signed.pdf`, blob };
});

const TEXT_SIZE = 12;

type TextContent = Extract<OverlayContent, { type: 'text' }>;

function TextBox({ placement, content }: { placement: Placement; content: TextContent }) {
  const { width, height } = placement;
  const size = height / TEXT_LINE;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="size-full overflow-visible">
      <text
        x={0}
        y={height - TEXT_BASELINE * size}
        fontSize={size}
        fill={content.color}
        fontFamily={CSS_FONT.helvetica}
        textLength={width}
        lengthAdjust="spacingAndGlyphs"
      >
        {content.text}
      </text>
    </svg>
  );
}

export default function SignPdf({ tool }: ToolProps) {
  const [items, setItems] = useState<Item[]>([]);
  const wb = useWorkbench({ job, options: items, accept: tool.accept, multiple: false });
  const input = wb.files[0] ?? null;
  const [pageState, setPageState] = useState<{ fileId: string | null; page: number }>({ fileId: null, page: 0 });
  const page = pageState.fileId === (input?.id ?? null) ? pageState.page : 0;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const view = useRef<StageView | null>(null);

  const own = input ? items.filter((i) => i.fileId === input.id) : [];
  const selected = own.find((i) => i.id === selectedId) ?? null;

  const update = (id: string, patch: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remove = (id: string) => {
    setItems((list) => list.filter((i) => i.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  };

  /** Adds an item of `width` × `height` points, centred on the visible page (staggered). */
  const place = (width: number, height: number, content: OverlayContent, label: string) => {
    const v = view.current;
    if (!input || !v) return;
    const fit = Math.min(1, (v.frame.width * 0.8) / width, (v.frame.height * 0.8) / height);
    const w = width * fit;
    const h = height * fit;
    // Below the last item placed on this page, so new items do not cover earlier ones.
    const prev = own.filter((i) => i.page === page).at(-1);
    let at: [number, number] = [v.width / 2, v.height * 0.6];
    if (prev) {
      const [px, py] = v.toView(prev.placement.cx, prev.placement.cy);
      const below = py + ((prev.placement.height + h) / 2 + 8) * v.scale;
      at = below + (h / 2) * v.scale < v.height ? [px, below] : [px, v.height * 0.2];
    }
    const [cx, cy] = v.toUser(at[0], at[1]);
    const item: Item = {
      id: newId('s'),
      fileId: input.id,
      page,
      placement: { cx, cy, width: w, height: h, rotation: 0 },
      content,
      label,
    };
    setItems((list) => [...list, item]);
    setSelectedId(item.id);
  };

  const placeInk = (ink: Ink) => {
    // Signatures start about 160 pt wide (a little over 5.5 cm).
    const width = 160;
    place(width, (width * ink.height) / ink.width, { type: 'image', image: ink.blob }, 'Signature');
  };

  const addSignature = (ink: Ink) => {
    setSaved((list) => [...list, { ...ink, id: newId('ink') }].slice(-6));
    placeInk(ink);
  };

  const placeText = (text: string, label: string) =>
    place(measureHelvetica(text, TEXT_SIZE), TEXT_SIZE * TEXT_LINE, { type: 'text', text, font: 'helvetica', color: '#111111' }, label);

  const setText = (item: Item, text: string) => {
    if (item.content.type !== 'text') return;
    const size = item.placement.height / TEXT_LINE;
    const width = Math.max(size, measureHelvetica(text || ' ', size));
    update(item.id, { content: { ...item.content, text }, placement: { ...item.placement, width } });
  };

  const disabledReason = !input
    ? 'Add a PDF to start.'
    : own.length === 0
      ? 'Place a signature, date or text on the page.'
      : own.some((i) => i.content.type === 'text' && !i.content.text.trim())
        ? 'A text item is empty.'
        : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionCard
          title="Document"
          description={input ? input.file.name : 'Files stay on this device. Nothing is uploaded.'}
          action={
            input ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  wb.reset();
                  setItems([]);
                  setSelectedId(null);
                }}
                disabled={wb.running}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                Clear
              </Button>
            ) : null
          }
          contentClassName="flex flex-col gap-2 p-3"
        >
          {input ? (
            <>
              <PdfStage
                file={input.file}
                page={page}
                onPageChange={(p) => {
                  setPageState({ fileId: input.id, page: p });
                  setSelectedId(null);
                }}
                onViewChange={(v) => {
                  view.current = v;
                }}
                onPagePointerDown={() => setSelectedId(null)}
                overlay={(v) =>
                  own
                    .filter((i) => i.page === page)
                    .map((item) => (
                      <StageItem
                        key={item.id}
                        view={v}
                        label={item.label}
                        placement={item.placement}
                        selected={item.id === selectedId}
                        onSelect={() => setSelectedId(item.id)}
                        onChange={(placement) => update(item.id, { placement })}
                        onDelete={() => remove(item.id)}
                      >
                        {item.content.type === 'image' ? (
                          <BlobImage blob={item.content.image} className="size-full" />
                        ) : (
                          <TextBox placement={item.placement} content={item.content} />
                        )}
                      </StageItem>
                    ))
                }
              />
              <p className="px-1 text-[0.7rem]/relaxed text-muted-foreground">
                Drag to move, drag a corner to resize, use the top handle to rotate. Arrow keys nudge the selected
                item; Delete removes it.
              </p>
            </>
          ) : (
            <Dropzone accept={tool.accept} multiple={false} disabled={wb.running} onFiles={wb.addFiles} />
          )}
        </SectionCard>

        <div className="flex flex-col gap-4 lg:sticky lg:top-0">
          <fieldset disabled={wb.running || !input} className="flex min-w-0 flex-col gap-4">
            <SectionCard title="Signature" contentClassName="flex flex-col gap-3">
              <SignatureMaker onCreate={addSignature} />
              {saved.length > 0 ? (
                <OptionField label="Your signatures" hint="Click one to place it again on this page.">
                  <div className="grid grid-cols-3 gap-1.5">
                    {saved.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        aria-label="Place this signature"
                        onClick={() => placeInk(s)}
                        className="grid h-12 place-items-center rounded-md border bg-white p-1 hover:border-primary/60"
                      >
                        <BlobImage blob={s.blob} className="max-h-full max-w-full object-contain" />
                      </button>
                    ))}
                  </div>
                </OptionField>
              ) : null}
            </SectionCard>
            <SectionCard title="Add to page" contentClassName="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => placeText(todayString(), 'Date')}>
                  <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} />
                  Date
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => placeText('Text', 'Text')}>
                  <HugeiconsIcon icon={TextIcon} strokeWidth={2} />
                  Text
                </Button>
              </div>
              {selected ? (
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">
                      Selected: {selected.label.toLowerCase()} on page {selected.page + 1}
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => remove(selected.id)}>
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                      Remove
                    </Button>
                  </div>
                  {selected.content.type === 'text' ? (
                    <>
                      <OptionField label="Text" htmlFor="sig-text">
                        <Input
                          id="sig-text"
                          value={selected.content.text}
                          maxLength={200}
                          onChange={(e) => setText(selected, e.currentTarget.value)}
                        />
                      </OptionField>
                      <OptionField label="Colour" htmlFor="sig-text-color">
                        <input
                          id="sig-text-color"
                          type="color"
                          value={selected.content.color}
                          onChange={(e) => {
                            const color = e.currentTarget.value;
                            if (selected.content.type === 'text') update(selected.id, { content: { ...selected.content, color } });
                          }}
                          className="h-7 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
                        />
                      </OptionField>
                    </>
                  ) : null}
                </div>
              ) : own.length > 0 ? (
                <p className="text-[0.7rem]/relaxed text-muted-foreground">
                  {own.length} {own.length === 1 ? 'item' : 'items'} placed on{' '}
                  {new Set(own.map((i) => i.page)).size === 1 ? '1 page' : `${new Set(own.map((i) => i.page)).size} pages`}.
                  Select one to edit it.
                </p>
              ) : null}
            </SectionCard>
          </fieldset>
          <RunBar
            label="Sign PDF"
            running={wb.running}
            progress={wb.progress}
            note={wb.note}
            disabledReason={disabledReason}
            onRun={wb.run}
            onCancel={wb.cancel}
          />
          <p className="flex items-center gap-1.5 px-1 text-[0.7rem] text-muted-foreground">
            <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-3.5 shrink-0" />
            Processed in your browser. Your files never leave this device.
          </p>
        </div>
      </div>
      <Results results={wb.results} />
    </div>
  );
}
