'use client';

import { Globe02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useMemo, useState } from 'react';
import { AiSettingsButton } from '@/components/ai/ai-settings-dialog';
import { ModelGate } from '@/components/ai/model-gate';
import { useLocalModel } from '@/components/ai/use-local-model';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { SwitchRow } from '@/components/pdf-stage';
import { type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, OptionSelect, perFile, useWorkbench } from '@/components/workbench';
import { type Device, localAi, type ModelSpec } from '@/engines/ai';
import { formatTime } from '@/engines/media/presets';
import { decodeWav, encodeWav, SAMPLE_RATE, type Segment, speechWindows, tidySegments, toSrt, toText, toVtt } from '@/lib/ai/audio';
import { hostOf, PROVIDERS, transcribeRemote } from '@/lib/ai/providers';
import { useAiSettings } from '@/lib/ai/settings';
import type { ProviderId } from '@/lib/ai/types';
import { baseName, formatBytes } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Engine = 'device' | 'cloud';
type Output = 'srt' | 'vtt' | 'txt' | 'all';
type Report = { notes: ResultNote[]; segments: Segment[]; name: string };

type Options = {
  engine: Engine;
  spec: ModelSpec;
  device: Device | null;
  cloud: { provider: ProviderId; apiKey: string } | null;
  language: string;
  output: Output;
  timestamps: boolean;
  onReport: (id: string, r: Report) => void;
};

const LANGUAGES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Detect automatically' },
  ...[
    ['en', 'English'],
    ['hi', 'Hindi'],
    ['es', 'Spanish'],
    ['fr', 'French'],
    ['de', 'German'],
    ['it', 'Italian'],
    ['pt', 'Portuguese'],
    ['nl', 'Dutch'],
    ['ru', 'Russian'],
    ['uk', 'Ukrainian'],
    ['pl', 'Polish'],
    ['tr', 'Turkish'],
    ['ar', 'Arabic'],
    ['bn', 'Bengali'],
    ['mr', 'Marathi'],
    ['ta', 'Tamil'],
    ['te', 'Telugu'],
    ['ur', 'Urdu'],
    ['zh', 'Chinese'],
    ['ja', 'Japanese'],
    ['ko', 'Korean'],
    ['id', 'Indonesian'],
    ['vi', 'Vietnamese'],
    ['sv', 'Swedish'],
  ].map(([value, label]) => ({ value: value as string, label: label as string })),
];

const TEXT = 'text/plain;charset=utf-8';

const job = perFile<Options>(async (input, o, ctx) => {
  const { file } = input;
  ctx.onProgress(0.01, 'Reading the audio track');
  const wav = await ctx.engines.media.convert(
    file,
    { container: 'wav', video: { discard: true }, audio: { codec: 'pcm', sampleRate: SAMPLE_RATE, channels: 1 } },
    { signal: ctx.signal, onProgress: (f) => ctx.onProgress(0.01 + f * 0.14, 'Decoding audio') },
  );
  const samples = decodeWav(await wav.blob.arrayBuffer());
  const duration = samples.length / SAMPLE_RATE;
  if (duration < 0.3) throw new Error('This file has no audio track, or it is too short to transcribe.');

  const segments: Segment[] = [];
  const report = (notes: ResultNote[]) => o.onReport(input.id, { notes, segments: tidySegments(segments), name: file.name });
  const started = performance.now();
  if (o.engine === 'device') {
    if (!o.device) throw new Error('This device cannot run the speech model.');
    const windows = speechWindows(samples);
    for (const w of windows) {
      if (ctx.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      ctx.onProgress(0.15 + 0.85 * (w.start / duration), `${formatTime(w.start, 0)} of ${formatTime(duration, 0)}`);
      if (w.silent) continue;
      const slice = samples.subarray(Math.floor(w.start * SAMPLE_RATE), Math.floor(w.end * SAMPLE_RATE));
      const r = await localAi.transcribe(o.spec, slice, o.language === 'auto' ? null : o.language, {
        device: o.device,
        signal: ctx.signal,
      });
      const chunks = r.chunks.length ? r.chunks : [{ start: 0, end: w.end - w.start, text: r.text }];
      for (const c of chunks) {
        segments.push({
          start: w.start + Math.min(c.start, w.end - w.start),
          end: w.start + Math.min(c.end ?? w.end - w.start, w.end - w.start),
          text: c.text,
        });
      }
      report([]);
    }
  } else {
    if (!o.cloud) throw new Error('Add a Groq or OpenAI API key in AI settings first.');
    // Pieces of up to 10 minutes (about 19 MB as 16 kHz WAV), under the providers' 25 MB limit.
    const windows = speechWindows(samples, SAMPLE_RATE, 480, 600);
    for (const [i, w] of windows.entries()) {
      ctx.onProgress(0.15 + 0.85 * (w.start / duration), `Part ${i + 1} of ${windows.length}`);
      if (w.silent) continue;
      const blob = encodeWav(samples.subarray(Math.floor(w.start * SAMPLE_RATE), Math.floor(w.end * SAMPLE_RATE)));
      const r = await transcribeRemote(o.cloud, blob, `${baseName(file.name)}-${i + 1}.wav`, {
        language: o.language === 'auto' ? undefined : o.language,
        signal: ctx.signal,
      });
      const segs = r.segments.length ? r.segments : [{ start: 0, end: w.end - w.start, text: r.text }];
      for (const s of segs) segments.push({ start: w.start + s.start, end: w.start + s.end, text: s.text });
      report([]);
    }
  }
  const tidy = tidySegments(segments);
  const secs = (performance.now() - started) / 1000;
  const notes: ResultNote[] = [
    tidy.length
      ? {
          kind: 'ok',
          text: `${formatTime(duration, 0)} of audio · ${tidy.length} segments · ${tidy.reduce((n, s) => n + s.text.split(/\s+/).length, 0).toLocaleString()} words · ${secs.toFixed(1)} s (${(duration / Math.max(0.1, secs)).toFixed(1)}× real time)`,
        }
      : { kind: 'warn', text: 'No speech was recognised.' },
  ];
  report(notes);

  const base = baseName(file.name);
  const outs = [];
  if (o.output === 'txt' || o.output === 'all') outs.push({ name: `${base}.txt`, blob: new Blob([toText(tidy, o.timestamps)], { type: TEXT }) });
  if (o.output === 'srt' || o.output === 'all') outs.push({ name: `${base}.srt`, blob: new Blob([toSrt(tidy)], { type: 'application/x-subrip;charset=utf-8' }) });
  if (o.output === 'vtt' || o.output === 'all') outs.push({ name: `${base}.vtt`, blob: new Blob([toVtt(tidy)], { type: 'text/vtt;charset=utf-8' }) });
  return outs;
});

export default function Transcribe({ tool }: ToolProps) {
  const [engine, setEngine] = useState<Engine>('device');
  const [language, setLanguage] = useState('auto');
  const [output, setOutput] = useState<Output>('srt');
  const [timestamps, setTimestamps] = useState(false);
  const [cloudId, setCloudId] = useState<ProviderId | null>(null);
  const [reports, setReports] = useState<Record<string, Report>>({});
  const model = useLocalModel('asr', 'whisper-tiny', 'transcribe');
  const settings = useAiSettings();
  const cloudChoices = (['groq', 'openai'] as const).filter((p) => settings.providers[p]?.apiKey.trim());
  const provider = cloudId && cloudChoices.includes(cloudId as 'groq' | 'openai') ? cloudId : (cloudChoices[0] ?? null);
  const cloud = provider ? { provider, apiKey: settings.providers[provider]?.apiKey.trim() ?? '' } : null;

  const onReport = useCallback((id: string, r: Report) => setReports((p) => ({ ...p, [id]: r })), []);
  const device = model.plan && model.plan.device ? model.plan.device : null;
  const options = useMemo<Options>(
    () => ({ engine, spec: model.spec, device, cloud, language, output, timestamps, onReport }),
    // `cloud` is rebuilt every render; its fields are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, model.spec, device, cloud?.provider, cloud?.apiKey, language, output, timestamps, onReport],
  );
  const wb = useWorkbench({ job, options, accept: tool.accept });
  const live = Object.values(reports).at(-1);

  const blocked =
    engine === 'device'
      ? model.status === 'ready'
        ? null
        : model.status === 'unsupported'
          ? 'This device cannot run the speech model.'
          : 'Download the speech model first.'
      : cloud
        ? null
        : 'Add a Groq or OpenAI API key in AI settings.';

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Transcribe"
      disabledReason={wb.files.length === 0 ? undefined : blocked}
      optionsPanel={
        <>
          <OptionField label="Recognise with">
            <Segmented<Engine>
              label="Recognise with"
              value={engine}
              options={[
                { value: 'device', label: 'On this device' },
                { value: 'cloud', label: 'My API key' },
              ]}
              onChange={setEngine}
            />
          </OptionField>
          {engine === 'device' ? (
            <ModelGate model={model} id="tr-model" label="Whisper model" />
          ) : (
            <>
              {cloudChoices.length > 1 ? (
                <OptionField label="Provider" htmlFor="tr-provider">
                  <OptionSelect<ProviderId>
                    id="tr-provider"
                    value={provider ?? 'groq'}
                    options={cloudChoices.map((p) => ({ value: p, label: `${PROVIDERS[p].label} · ${PROVIDERS[p].transcription?.model}` }))}
                    onChange={setCloudId}
                  />
                </OptionField>
              ) : null}
              {cloud ? (
                <p data-disclosure className="flex items-start gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-[0.7rem]/relaxed text-muted-foreground">
                  <HugeiconsIcon icon={Globe02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0 text-warning" />
                  <span>
                    The audio track only (converted here to 16 kHz mono WAV, about {formatBytes(SAMPLE_RATE * 2 * 60)} per
                    minute, sent in parts of up to 10 minutes) goes to{' '}
                    <strong className="text-foreground">{PROVIDERS[cloud.provider].label}</strong> ({hostOf({ provider: cloud.provider })},
                    model {PROVIDERS[cloud.provider].transcription?.model}) with your key. Video is never sent.
                  </span>
                </p>
              ) : (
                <p className="text-xs/relaxed text-muted-foreground">Cloud transcription uses a Groq or OpenAI key.</p>
              )}
              <AiSettingsButton label={cloud ? 'AI settings' : 'Add an API key'} />
            </>
          )}
          <OptionField label="Language" htmlFor="tr-lang" hint="Choosing the language helps with short clips and accents.">
            <OptionSelect id="tr-lang" value={language} options={LANGUAGES} onChange={setLanguage} />
          </OptionField>
          <OptionField label="Output">
            <Segmented<Output>
              label="Output"
              value={output}
              options={[
                { value: 'srt', label: 'SRT' },
                { value: 'vtt', label: 'VTT' },
                { value: 'txt', label: 'Text' },
                { value: 'all', label: 'All' },
              ]}
              onChange={setOutput}
            />
          </OptionField>
          {output === 'txt' || output === 'all' ? (
            <SwitchRow id="tr-ts" label="Timestamps in the text" checked={timestamps} onChange={setTimestamps} />
          ) : null}
        </>
      }
    >
      <ResultRows
        results={wb.results}
        zipName="transcripts.zip"
        notesFor={(r) => (r.sourceId ? (reports[r.sourceId]?.notes ?? []) : [])}
      />
      {live && live.segments.length > 0 ? (
        <SectionCard title="Transcript" description={live.name}>
          <div data-transcript className="flex max-h-96 flex-col gap-1 overflow-auto text-xs/relaxed">
            {live.segments.map((s, i) => (
              <p key={i}>
                <span className="mr-2 font-mono text-[0.65rem] text-faint">{formatTime(s.start, 1)}</span>
                {s.text}
              </p>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </ToolFrame>
  );
}
