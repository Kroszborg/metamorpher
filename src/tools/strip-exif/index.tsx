'use client';

import { Alert02Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useMemo, useState } from 'react';
import { ImageWorkbench, type NameClaimer, type Note, type Reporter, RunNotes, SwitchField, useRunNotes } from '@/components/image';
import { SectionCard } from '@/components/kit/section-card';
import { perFile } from '@/components/workbench';
import { createImageEngine, imageErrorMessage, type MetadataReport, type SourceFormat } from '@/engines/image';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';

type Options = { keepIcc: boolean; report?: Reporter; claim?: NameClaimer };

/** What removal means for each format: all of these leave the image data untouched. */
const LOSSLESS: Partial<Record<SourceFormat, string>> = {
  jpeg: 'Lossless: the compressed image data is copied byte for byte; only metadata segments are dropped.',
  png: 'Lossless: the image chunks are copied unchanged; text, EXIF and time chunks are dropped.',
  webp: 'Lossless: the image chunks are copied unchanged; EXIF, XMP and unknown chunks are dropped.',
  gif: 'Lossless: frames and animation are copied unchanged; comments and application blocks are dropped.',
  heic: 'Lossless: the EXIF and XMP blocks are blanked in place; the image data is not touched.',
  avif: 'Lossless: the EXIF and XMP blocks are blanked in place; the image data is not touched.',
  bmp: 'BMP files carry no metadata; the file is returned unchanged.',
  ico: 'ICO files carry no metadata; the file is returned unchanged.',
};

type Finding = { label: string; value: string; warn?: boolean };

function gpsText(g: { latitude: number; longitude: number; altitude?: number }): string {
  const lat = `${Math.abs(g.latitude).toFixed(5)}° ${g.latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(g.longitude).toFixed(5)}° ${g.longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}${g.altitude !== undefined ? ` · ${Math.round(g.altitude)} m` : ''}`;
}

/** EXIF dates are "YYYY:MM:DD HH:MM:SS". */
const exifDate = (d: string) => d.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');

export function findings(r: MetadataReport): Finding[] {
  const out: Finding[] = [];
  const e = r.exif;
  if (e?.gps) out.push({ label: 'Location', value: gpsText(e.gps), warn: true });
  else if (e?.hasGps) out.push({ label: 'Location', value: 'GPS tags (no usable position)', warn: true });
  if (r.xmpGps) out.push({ label: 'Location (XMP)', value: 'GPS position in XMP', warn: true });
  if (e?.make || e?.model) out.push({ label: 'Camera', value: [e.make, e.model].filter(Boolean).join(' ') });
  if (e?.lens) out.push({ label: 'Lens', value: e.lens });
  if (e?.dateTaken) out.push({ label: 'Taken', value: exifDate(e.dateTaken) });
  if (e?.dateModified && e.dateModified !== e.dateTaken) out.push({ label: 'Modified', value: exifDate(e.dateModified) });
  if (e?.software) out.push({ label: 'Software', value: e.software });
  for (const [label, v] of [
    ['Artist', e?.artist],
    ['Owner', e?.ownerName],
    ['Copyright', e?.copyright],
    ['Description', e?.description],
    ['Serial number', e?.serialNumber],
  ] as const) {
    if (v) out.push({ label, value: v, warn: label === 'Owner' || label === 'Serial number' || label === 'Artist' });
  }
  if (e) {
    const extra = [e.hasMakerNote && 'maker notes', e.hasThumbnail && 'a thumbnail'].filter(Boolean).join(' and ');
    out.push({ label: 'EXIF', value: `${e.tagCount} tags${extra ? `, with ${extra}` : ''}` });
  }
  if (r.xmp) out.push({ label: 'XMP', value: 'Adobe XMP packet' });
  if (r.iptc) out.push({ label: 'IPTC', value: 'Photoshop / IPTC block' });
  for (const c of r.comments) out.push({ label: 'Comment', value: c.slice(0, 120) });
  for (const t of r.text) out.push({ label: t.key || 'Text', value: t.value.slice(0, 120) });
  for (const o of r.other) out.push({ label: 'Other', value: o });
  if (r.trailingBytes > 0) {
    out.push({ label: 'After the image', value: `${r.trailingBytes.toLocaleString()} bytes (secondary images or junk)` });
  }
  return out;
}

const job = perFile<Options>(async ({ id, file }, o, ctx) => {
  const { image } = ctx.engines;
  ctx.onProgress(0.3, 'Removing metadata');
  const r = await image.stripMetadata(file, { keepIcc: o.keepIcc }, ctx.signal);
  // Check the result independently: read it back and look for anything left.
  const after = await image.readMetadata(r.blob, ctx.signal);
  const left = findings(after).filter((f) => f.label !== 'EXIF' || (after.exif?.tagCount ?? 0) > 1);
  const notes: Note[] = [];
  notes.push({ text: r.removed.length ? `Removed: ${r.removed.join(', ')}.` : 'No metadata to remove.' });
  if (r.keptOrientation) notes.push({ text: `Kept only the orientation tag (${r.keptOrientation}) so the photo stays upright.` });
  if (after.icc) notes.push({ text: `Kept the colour profile (${after.icc}).` });
  if (left.length) notes.push({ text: `Still present: ${left.map((f) => f.label).join(', ')}.`, tone: 'warn' });
  else notes.push({ text: 'Checked: no EXIF, GPS, XMP, IPTC or comments remain.' });
  o.report?.({ id, name: file.name }, notes);
  return { name: o.claim?.(file.name) ?? file.name, blob: r.blob };
});

/** Its own worker, so reading reports never interferes with a running job. */
const reader = createImageEngine();

type Read = { report?: MetadataReport; error?: string };

function useReports(files: File[]): Map<File, Read> {
  const [reads, setReads] = useState<Map<File, Read>>(new Map());
  useEffect(() => {
    let live = true;
    (async () => {
      for (const f of files) {
        if (!live) return;
        if (reads.has(f)) continue;
        let entry: Read;
        try {
          entry = { report: await reader.readMetadata(f) };
        } catch (err) {
          entry = { error: imageErrorMessage(err) };
        }
        if (live) setReads((prev) => new Map(prev).set(f, entry));
      }
    })();
    return () => {
      live = false;
    };
  }, [files, reads]);
  return reads;
}

function FoundCard({ files }: { files: File[] }) {
  const reads = useReports(files);
  return (
    <SectionCard
      title="Found metadata"
      description="What each image carries now. Location and personal details are highlighted."
      contentClassName="p-0"
    >
      <ul className="divide-y">
        {files.map((f, i) => {
          const read = reads.get(f);
          const list = read?.report ? findings(read.report) : [];
          const format = read?.report?.format;
          const supported = read?.report?.supported;
          return (
            <li key={`${f.name}-${i}`} className="flex min-w-0 flex-col gap-1.5 px-5 py-3">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <p className="truncate text-sm font-medium" title={f.name}>
                  {f.name}
                </p>
                {read?.report ? (
                  <span className="shrink-0 text-[0.7rem] text-muted-foreground">
                    {list.length ? `${list.length} ${list.length === 1 ? 'item' : 'items'}` : 'Nothing found'}
                  </span>
                ) : null}
              </div>
              {!read ? (
                <p className="text-xs text-muted-foreground">Reading…</p>
              ) : read.error ? (
                <p className="text-xs text-destructive">{read.error}</p>
              ) : (
                <>
                  {list.length ? (
                    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs/relaxed">
                      {list.map((x, k) => (
                        <div key={k} className="contents">
                          <dt className={cn('text-muted-foreground', x.warn && 'text-warning')}>
                            {x.warn ? <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mr-1 inline size-3 align-[-1px]" /> : null}
                            {x.label}
                          </dt>
                          <dd className="truncate" title={x.value}>
                            {x.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-3.5" />
                      No metadata found.
                    </p>
                  )}
                  {read.report?.icc ? (
                    <p className="text-[0.7rem] text-muted-foreground">Colour profile: {read.report.icc}</p>
                  ) : null}
                  <p className={cn('text-[0.7rem]/relaxed', supported ? 'text-muted-foreground' : 'text-destructive')}>
                    {supported && format
                      ? LOSSLESS[format]
                      : 'This format is not supported here. Convert it to PNG or JPG first, which drops its metadata.'}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

export default function StripExif({ tool }: ToolProps) {
  const [keepIcc, setKeepIcc] = useState(true);
  const notes = useRunNotes();
  const options = useMemo<Options>(() => ({ keepIcc, report: notes.report, claim: notes.claim }), [keepIcc, notes.report, notes.claim]);

  return (
    <ImageWorkbench
      job={job}
      options={options}
      accept={tool.accept}
      runLabel="Remove metadata"
      zipName="clean-images.zip"
      onRun={notes.clear}
      below={<RunNotes entries={notes.entries} title="Removed" />}
      preview={(wb) => <FilesFound files={wb.files.map((f) => f.file)} />}
      optionsPanel={
        <>
          <SwitchField
            id="se-icc"
            label="Keep the colour profile"
            checked={keepIcc}
            onChange={setKeepIcc}
            hint="A profile says how to show the colours (Display P3, Adobe RGB) and holds nothing personal. Removing it can make wide-gamut photos look dull."
          />
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Removes EXIF (camera, dates, GPS location, serial numbers, thumbnails), XMP, IPTC, comments and text
            chunks without re-encoding, so image quality is untouched. The orientation is kept so photos stay upright.
          </p>
        </>
      }
    />
  );
}

/** Keeps the File[] identity stable between renders with the same files. */
function FilesFound({ files }: { files: File[] }) {
  const key = files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the list's content
  const stable = useMemo(() => files, [key]);
  return <FoundCard files={stable} />;
}
