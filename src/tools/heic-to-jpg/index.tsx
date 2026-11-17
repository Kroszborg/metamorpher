'use client';

import { useMemo, useState } from 'react';
import {
  ImageWorkbench,
  type NameClaimer,
  type Note,
  type Reporter,
  RunNotes,
  SwitchField,
  sourceNotes,
  useRunNotes,
} from '@/components/image';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, perFile, QualitySlider } from '@/components/workbench';
import { replaceExtension } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = {
  format: 'jpeg' | 'png';
  quality: number;
  keepDetails: boolean;
  keepLocation: boolean;
  report?: Reporter;
  claim?: NameClaimer;
};

const job = perFile<Options>(async ({ id, file }, o, ctx) => {
  ctx.onProgress(0.2, 'Decoding HEIC');
  const exif = o.format !== 'jpeg' || !o.keepDetails ? 'drop' : o.keepLocation ? 'keep' : 'keep-no-gps';
  const r = await ctx.engines.image.process(
    file,
    { output: { format: o.format, quality: o.quality, exif, colour: 'keep' } },
    ctx.signal,
    (f, note) => ctx.onProgress(0.2 + 0.8 * f, note),
  );
  const notes: Note[] = [...sourceNotes(r)];
  if (exif !== 'drop') {
    notes.push({
      text: r.exifCopied
        ? `Photo details copied${o.keepLocation ? ', including the location' : '; the location was left out'}.`
        : 'This photo has no EXIF details to copy.',
    });
  }
  o.report?.({ id, name: file.name }, notes);
  const name = replaceExtension(file.name, o.format === 'jpeg' ? 'jpg' : 'png');
  return { name: o.claim?.(name) ?? name, blob: r.blob };
});

export default function HeicToJpg({ tool }: ToolProps) {
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [quality, setQuality] = useState(0.9);
  const [keepDetails, setKeepDetails] = useState(true);
  const [keepLocation, setKeepLocation] = useState(false);
  const notes = useRunNotes();
  const options = useMemo<Options>(
    () => ({ format, quality, keepDetails, keepLocation, report: notes.report, claim: notes.claim }),
    [format, quality, keepDetails, keepLocation, notes.report, notes.claim],
  );

  return (
    <ImageWorkbench
      job={job}
      options={options}
      accept={tool.accept}
      runLabel={format === 'jpeg' ? 'Convert to JPG' : 'Convert to PNG'}
      zipName="converted-photos.zip"
      onRun={notes.clear}
      below={<RunNotes entries={notes.entries} />}
      optionsPanel={
        <>
          <OptionField label="Convert to">
            <Segmented
              label="Convert to"
              value={format}
              options={[
                { value: 'jpeg', label: 'JPG' },
                { value: 'png', label: 'PNG' },
              ]}
              onChange={setFormat}
            />
          </OptionField>
          {format === 'jpeg' ? (
            <>
              <OptionField label="Quality" htmlFor="heic-quality" hint="90% keeps photos indistinguishable from the original.">
                <QualitySlider id="heic-quality" value={quality} onChange={setQuality} />
              </OptionField>
              <SwitchField
                id="heic-details"
                label="Keep photo details"
                checked={keepDetails}
                onChange={setKeepDetails}
                hint="Date taken, camera and lens settings, copied into the JPG."
              />
              {keepDetails ? (
                <SwitchField
                  id="heic-location"
                  label="Include the location"
                  checked={keepLocation}
                  onChange={setKeepLocation}
                  hint="Off by default: GPS coordinates reveal where the photo was taken."
                />
              ) : null}
            </>
          ) : (
            <p className="text-[0.7rem]/relaxed text-muted-foreground">
              PNG is lossless and much larger. It keeps transparency; photo details are not copied.
            </p>
          )}
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Decoded on this device with libheif. The photo’s rotation is applied and its colour profile (Display P3 on
            iPhones) is kept, so colours look the same as in Photos.
          </p>
        </>
      }
    />
  );
}
