'use client';

import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import {
  Cancel01Icon,
  DragDropVerticalIcon,
  File02Icon,
  FileAudioIcon,
  FileVideoIcon,
  PdfIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useRef, useState } from 'react';
import { StatusBadge, type StatusKind } from '@/components/kit/status-badge';
import { Button } from '@/components/ui/button';
import { extensionOf, formatBytes } from '@/lib/files';
import { collapseOut } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { FileStatus, InputFile } from './types';

const STATUS: Record<FileStatus['state'], { kind: StatusKind; label: string; mark?: 'check' | 'cross' }> = {
  ready: { kind: 'neutral', label: 'Ready' },
  queued: { kind: 'neutral', label: 'Queued' },
  running: { kind: 'info', label: 'Working' },
  done: { kind: 'success', label: 'Done', mark: 'check' },
  error: { kind: 'danger', label: 'Failed', mark: 'cross' },
  cancelled: { kind: 'warning', label: 'Cancelled' },
};

/**
 * Rows that have finished their entrance. A row rises in once when its file is
 * added; it must not replay when the list re-mounts (for example when a second
 * file switches the list to its reorderable form).
 */
const entered = new WeakSet<InputFile>();

/** A small preview for images; the object URL lives exactly as long as the row. */
function FileThumb({ file }: { file: File }) {
  const img = useRef<HTMLImageElement>(null);
  const isImage = file.type.startsWith('image/') && file.type !== 'image/tiff';
  useEffect(() => {
    if (!isImage || !img.current) return;
    const u = URL.createObjectURL(file);
    img.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);

  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={img}
        alt=""
        onError={(e) => {
          e.currentTarget.style.visibility = 'hidden';
        }}
        className="size-9 shrink-0 rounded-md border bg-muted object-cover"
      />
    );
  }
  const ext = extensionOf(file.name);
  const icon = file.type.startsWith('video/')
    ? FileVideoIcon
    : file.type.startsWith('audio/')
      ? FileAudioIcon
      : ext === 'pdf'
        ? PdfIcon
        : File02Icon;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
      <HugeiconsIcon icon={icon} strokeWidth={1.8} className="size-4" />
    </span>
  );
}

function Row({
  item,
  status,
  disabled,
  onRemove,
  handle,
}: {
  item: InputFile;
  status: FileStatus;
  disabled: boolean;
  onRemove: (id: string) => void;
  handle?: React.ReactNode;
}) {
  const s = STATUS[status.state];
  const pct = status.state === 'running' && status.progress ? Math.round(status.progress * 100) : null;
  const row = useRef<HTMLDivElement>(null);
  const [removing, setRemoving] = useState(false);
  // Read once per render from a module-level set (never mutated during render).
  const fresh = !entered.has(item);
  useEffect(() => {
    const t = setTimeout(() => entered.add(item), 400);
    return () => clearTimeout(t);
  }, [item]);

  const remove = () => {
    if (removing) return;
    setRemoving(true);
    // The row closes its gap smoothly, then the file is dropped from the list.
    void collapseOut(row.current?.closest('li')).then(() => onRemove(item.id));
  };

  return (
    <div
      ref={row}
      data-file-state={status.state}
      className={cn(
        'flex min-w-0 items-center gap-3 px-3 py-2.5 in-[li:first-child]:rounded-t-[calc(var(--radius-xl)-1px)] in-[li:last-child]:rounded-b-[calc(var(--radius-xl)-1px)]',
        fresh && 'animate-rise',
        status.state === 'error' && 'row-failed',
      )}
    >
      {handle}
      <FileThumb file={item.file} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={item.file.name}>
          {item.file.name}
        </p>
        <p className="font-mono text-[0.7rem] text-muted-foreground">{formatBytes(item.file.size)}</p>
        {status.state === 'error' && status.error ? (
          <p role="alert" className="mt-0.5 animate-fade text-xs/relaxed text-destructive">
            {status.error}
          </p>
        ) : null}
      </div>
      <StatusBadge
        key={status.state}
        kind={s.kind}
        live={status.state === 'running'}
        mark={s.mark}
        className="min-w-[4.5rem] justify-end"
      >
        {pct !== null ? (
          <span className="tween-num" data-suffix="%" style={{ '--tween-to': pct } as React.CSSProperties}>
            <span className="sr-only">{pct}%</span>
          </span>
        ) : (
          s.label
        )}
      </StatusBadge>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${item.file.name}`}
        disabled={disabled || removing}
        onClick={remove}
        className="text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>
    </div>
  );
}

/** The added files with status, removal and (optionally) drag-to-reorder. */
export function FileList({
  files,
  statuses,
  disabled = false,
  reorderable = false,
  onRemove,
  onMove,
}: {
  files: InputFile[];
  statuses: Record<string, FileStatus>;
  disabled?: boolean;
  reorderable?: boolean;
  onRemove: (id: string) => void;
  onMove: (from: number, to: number) => void;
}) {
  const statusOf = (id: string): FileStatus => statuses[id] ?? { state: 'ready' };

  if (!reorderable || files.length < 2) {
    return (
      <ul className="divide-y rounded-xl border bg-card">
        {files.map((f) => (
          <li key={f.id}>
            <Row item={f} status={statusOf(f.id)} disabled={disabled} onRemove={onRemove} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <DragDropContext
      onDragEnd={(r) => {
        if (r.destination) onMove(r.source.index, r.destination.index);
      }}
    >
      <Droppable droppableId="workbench-files" isDropDisabled={disabled}>
        {(drop) => (
          <ul
            ref={drop.innerRef}
            {...drop.droppableProps}
            className="divide-y rounded-xl border bg-card"
            aria-label="Files, in order. Drag or use the handle with Space and the arrow keys to reorder."
          >
            {files.map((f, index) => (
              <Draggable key={f.id} draggableId={f.id} index={index} isDragDisabled={disabled}>
                {(drag, snapshot) => (
                  <li
                    ref={drag.innerRef}
                    {...drag.draggableProps}
                    className={cn(
                      'bg-card first:rounded-t-xl last:rounded-b-xl',
                      snapshot.isDragging && 'rounded-xl border shadow-lg',
                    )}
                  >
                    <Row
                      item={f}
                      status={statusOf(f.id)}
                      disabled={disabled}
                      onRemove={onRemove}
                      handle={
                        <span
                          {...drag.dragHandleProps}
                          aria-label={`Reorder ${f.file.name}`}
                          className="-ml-1 grid h-9 w-5 shrink-0 cursor-grab place-items-center rounded text-faint outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 active:cursor-grabbing"
                        >
                          <span className="font-mono text-[0.65rem] tabular-nums sr-only">{index + 1}</span>
                          <HugeiconsIcon icon={DragDropVerticalIcon} strokeWidth={2} className="size-4" />
                        </span>
                      }
                    />
                  </li>
                )}
              </Draggable>
            ))}
            {drop.placeholder}
          </ul>
        )}
      </Droppable>
    </DragDropContext>
  );
}
