'use client';

import { Delete02Icon, PauseIcon, PlayIcon, StopIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ModelGate } from '@/components/ai/model-gate';
import { useLocalModel } from '@/components/ai/use-local-model';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { parsePageRanges } from '@/components/pdf-pages/page-range';
import { NoteLine } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dropzone, OptionField, OptionSelect, RunBar } from '@/components/workbench';
import { localAi } from '@/engines/ai';
import { isAbortError } from '@/engines/worker-host';
import { DocumentError, loadDocument, type LoadedDoc } from '@/lib/ai/documents';
import { baseName, downloadBlob, formatBytes, newId } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Entry =
  | { id: string; file: File; state: 'loading' }
  | { id: string; file: File; state: 'ready'; doc: LoadedDoc }
  | { id: string; file: File; state: 'error'; error: string; scanned: boolean };

type Format = 'mp3' | 'wav';
const RATE = 24_000;
const VOICES = [
  { value: 'af_heart', label: 'Heart · US English, female' },
  { value: 'af_bella', label: 'Bella · US English, female' },
  { value: 'am_michael', label: 'Michael · US English, male' },
  { value: 'am_fenrir', label: 'Fenrir · US English, male' },
  { value: 'bf_emma', label: 'Emma · UK English, female' },
  { value: 'bm_george', label: 'George · UK English, male' },
];

/** Sentences, then pieces of at most `max` characters (the speech model reads ~500 phonemes at a time). */
function sentencesOf(text: string): string[] {
  const clean = text
    .replace(/­/g, '')
    // A short line without end punctuation followed by a capital is a heading: end it as a sentence.
    .replace(/^([^\n.!?:;]{1,60}[^\s.!?:;,])[ \t]*\n(?=\s*[A-Z])/gm, '$1.\n')
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!clean) return [];
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
  const out: string[] = [];
  for (const { segment } of seg.segment(clean)) {
    const s = segment.trim();
    if (!s) continue;
    if (s.length <= 300) out.push(s);
    else for (const part of s.match(/[^,;:]{1,280}(?:[,;:]|$)|.{1,280}/g) ?? [s]) if (part.trim()) out.push(part.trim());
  }
  return out;
}

function chunk(sentences: string[], max = 260): string[] {
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > max) {
      out.push(cur);
      cur = '';
    }
    cur += (cur ? ' ' : '') + s;
  }
  if (cur) out.push(cur);
  return out;
}

function wavFromInt16(parts: Int16Array[], rate: number): Blob {
  const samples = parts.reduce((n, p) => n + p.length, 0);
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples * 2, true);
  return new Blob([header, ...parts.map((p) => p.buffer as ArrayBuffer)], { type: 'audio/wav' });
}

function toInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i] ?? 0)) * 0x7fff;
  return out;
}

// ── Live reading with the browser's own voices ─────────────────────────────

function subscribeVoices(cb: () => void): () => void {
  if (typeof speechSynthesis === 'undefined') return () => {};
  speechSynthesis.addEventListener('voiceschanged', cb);
  return () => speechSynthesis.removeEventListener('voiceschanged', cb);
}
let voiceCache: { key: string; list: SpeechSynthesisVoice[] } = { key: '', list: [] };
/** Only voices installed on this device: online voices would send the text to the browser maker. */
function localVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return voiceCache.list;
  const all = speechSynthesis.getVoices().filter((v) => v.localService);
  const key = all.map((v) => v.voiceURI).join('|');
  if (key !== voiceCache.key) voiceCache = { key, list: all };
  return voiceCache.list;
}
const noVoices: SpeechSynthesisVoice[] = [];

function LiveReader({ sentences }: { sentences: string[] }) {
  const voices = useSyncExternalStore(subscribeVoices, localVoices, () => noVoices);
  const [voiceUri, setVoiceUri] = useState('');
  const [rate, setRate] = useState(1);
  const [at, setAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const playing = useRef(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => () => {
    playing.current = false;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }, []);

  const voice = voices.find((v) => v.voiceURI === voiceUri) ?? voices.find((v) => v.default) ?? voices[0];

  const speakFrom = (i: number) => {
    if (i >= sentences.length || !playing.current) {
      playing.current = false;
      setAt(null);
      return;
    }
    const u = new SpeechSynthesisUtterance(sentences[i]);
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => speakFrom(i + 1);
    u.onerror = () => {
      playing.current = false;
      setAt(null);
    };
    setAt(i);
    speechSynthesis.speak(u);
  };

  if (!supported) return <p className="text-xs text-muted-foreground">This browser cannot read text aloud.</p>;
  if (voices.length === 0) {
    return (
      <p className="text-xs/relaxed text-muted-foreground">
        No speech voices are installed on this device (online voices are not used, because they would send the text to
        the browser maker). Use “Save as audio” below instead.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionField label="System voice" htmlFor="pa-sysvoice">
          <OptionSelect
            id="pa-sysvoice"
            value={voice?.voiceURI ?? ''}
            options={voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` }))}
            onChange={setVoiceUri}
          />
        </OptionField>
        <OptionField label={`Speed ${rate.toFixed(1)}×`} htmlFor="pa-rate">
          <input id="pa-rate" type="range" min={0.6} max={2} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </OptionField>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {at === null ? (
          <Button
            size="sm"
            data-action="read-aloud"
            disabled={sentences.length === 0}
            onClick={() => {
              speechSynthesis.cancel();
              playing.current = true;
              setPaused(false);
              speakFrom(0);
            }}
          >
            <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
            Read aloud
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (paused) speechSynthesis.resume();
                else speechSynthesis.pause();
                setPaused(!paused);
              }}
            >
              <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} strokeWidth={2} />
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                playing.current = false;
                speechSynthesis.cancel();
                setAt(null);
              }}
            >
              <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
              Stop
            </Button>
            <span className="text-xs text-muted-foreground">
              Sentence {at + 1} of {sentences.length}
            </span>
          </>
        )}
      </div>
      {at !== null ? (
        <p data-reading className="rounded-lg bg-primary/10 px-3 py-2 text-sm/relaxed">
          {sentences[at]}
        </p>
      ) : null}
      <p className="text-[0.7rem]/relaxed text-muted-foreground">
        Uses the voices installed on this device; online voices are left out so the text never leaves it.
      </p>
    </div>
  );
}

export default function PdfToAudio({ tool }: ToolProps) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [pages, setPages] = useState('');
  const [voice, setVoice] = useState('af_heart');
  const [speed, setSpeed] = useState(1);
  const [format, setFormat] = useState<Format>('mp3');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string | undefined>();
  const [result, setResult] = useState<{ blob: Blob; name: string; url: string; seconds: number; took: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const model = useLocalModel('tts', 'kokoro-82m', 'pdf-to-audio');

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const addFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const id = newId('d');
    setEntry({ id, file, state: 'loading' });
    setResult(null);
    loadDocument(file, id).then(
      (doc) => setEntry((e) => (e?.id === id ? { id, file, state: 'ready', doc } : e)),
      (err: unknown) =>
        setEntry((e) =>
          e?.id === id
            ? { id, file, state: 'error', error: err instanceof Error ? err.message : 'This file could not be read.', scanned: err instanceof DocumentError && err.scanned }
            : e,
        ),
    );
  };

  const doc = entry?.state === 'ready' ? entry.doc : null;
  const range = doc ? parsePageRanges(pages, doc.pages.length) : null;
  const selected = doc
    ? range && range.ranges.length
      ? range.ranges.flatMap((r) => doc.pages.slice(r.start, r.end + 1))
      : doc.pages
    : [];
  const sentences = sentencesOf(selected.join('\n\n'));
  const chars = sentences.reduce((n, s) => n + s.length, 0);
  const estMinutes = chars / 900;

  const run = async () => {
    if (!doc || !model.plan || model.plan.device === null) return;
    const device = model.plan.device;
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(0);
    const started = performance.now();
    try {
      const pieces = chunk(sentences);
      const audio: Int16Array[] = [];
      const batch = 6;
      for (let i = 0; i < pieces.length; i += batch) {
        if (c.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        setNote(`Speaking part ${Math.min(pieces.length, i + 1)} of ${pieces.length}`);
        const samples = await localAi.speak(model.spec, pieces.slice(i, i + batch), {
          device,
          voice,
          speed,
          signal: c.signal,
          onSpoken: (k) => setProgress(Math.min(0.97, (i + k + 1) / pieces.length) * (format === 'mp3' ? 0.9 : 1)),
        });
        audio.push(toInt16(samples));
      }
      const wav = wavFromInt16(audio, RATE);
      const seconds = audio.reduce((n, a) => n + a.length, 0) / RATE;
      let blob: Blob = wav;
      if (format === 'mp3') {
        setNote('Encoding MP3');
        const { mediaEngine } = await import('@/engines/media');
        const r = await mediaEngine.convert(new File([wav], 'speech.wav', { type: 'audio/wav' }), { container: 'mp3', audio: { codec: 'mp3', bitrate: 96_000 } }, {
          signal: c.signal,
          onProgress: (f) => setProgress(0.9 + f * 0.1),
        });
        blob = r.blob;
      }
      const name = `${baseName(doc.name)}.${format}`;
      setResult({ blob, name, url: URL.createObjectURL(blob), seconds, took: (performance.now() - started) / 1000 });
      setProgress(1);
      setNote('Done');
    } catch (err) {
      if (isAbortError(err)) setNote('Cancelled');
      else setError(err instanceof Error ? err.message : 'The audio could not be made.');
    } finally {
      setRunning(false);
      ctrl.current = null;
    }
  };

  const reason = !entry
    ? 'Add a document to start.'
    : entry.state !== 'ready'
      ? entry.state === 'loading'
        ? 'Reading the document…'
        : 'This document cannot be read aloud.'
      : range?.error
        ? range.error
        : sentences.length === 0
          ? 'The selected pages have no text.'
          : model.status === 'ready'
            ? null
            : model.status === 'unsupported'
              ? 'This device cannot run the speech model.'
              : 'Download the voice model first.';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard
            title="Document"
            description="PDF, Word, Markdown or text. Read on this device."
            action={
              entry ? (
                <Button variant="ghost" size="sm" disabled={running} onClick={() => setEntry(null)}>
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  Clear
                </Button>
              ) : null
            }
            contentClassName="flex flex-col gap-3"
          >
            {entry ? (
              <div className="text-xs" data-doc-state={entry.state}>
                <p className="truncate font-medium">{entry.file.name}</p>
                {entry.state === 'ready' ? (
                  <p className="text-muted-foreground">
                    {entry.doc.pages.length} {entry.doc.unit === 'page' ? 'pages' : 'sections'} · {sentences.length} sentences selected · about{' '}
                    {Math.max(1, Math.round(estMinutes))} min of speech
                  </p>
                ) : entry.state === 'loading' ? (
                  <p className="text-muted-foreground">Reading text…</p>
                ) : (
                  <p role="alert" className="text-destructive">
                    {entry.error}{' '}
                    {entry.scanned ? (
                      <Link href="/tools/ocr-pdf" className="text-primary underline">
                        Open OCR
                      </Link>
                    ) : null}
                  </p>
                )}
              </div>
            ) : null}
            <Dropzone accept={tool.accept} multiple={false} compact={!!entry} onFiles={addFiles} disabled={running} />
            {doc && doc.unit === 'page' ? (
              <OptionField label="Pages" htmlFor="pa-pages" hint="Leave empty for all pages, or e.g. 1-3, 8.">
                <Input id="pa-pages" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="All pages" disabled={running} />
              </OptionField>
            ) : null}
          </SectionCard>

          {doc ? (
            <SectionCard title="Listen now" description="Reads the selected pages aloud with this device's voices.">
              <LiveReader sentences={sentences} />
            </SectionCard>
          ) : null}

          {result ? (
            <SectionCard title="Audio file" description={`${result.name} · ${Math.round(result.seconds)} s of speech · ${formatBytes(result.blob.size)}`}>
              <div className="flex flex-col gap-3">
                <audio controls src={result.url} className="w-full" data-audio-result />
                <NoteLine note={{ kind: 'ok', text: `Made on this device in ${result.took.toFixed(1)} s (${(result.seconds / Math.max(0.1, result.took)).toFixed(1)}× real time).` }} />
                <Button size="sm" className="self-start" onClick={() => downloadBlob(result.blob, result.name)} data-action="download-audio">
                  Download {format.toUpperCase()}
                </Button>
              </div>
            </SectionCard>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs/relaxed text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-0">
          <SectionCard title="Save as audio" contentClassName="flex flex-col gap-4">
            <fieldset disabled={running} className="flex min-w-0 flex-col gap-4">
              <ModelGate model={model} id="pa-model" label="Voice model" />
              <OptionField label="Voice" htmlFor="pa-voice" hint="English only. Other languages are read with an English accent.">
                <OptionSelect id="pa-voice" value={voice} options={VOICES} onChange={setVoice} />
              </OptionField>
              <OptionField label={`Speed ${speed.toFixed(1)}×`} htmlFor="pa-speed">
                <input id="pa-speed" type="range" min={0.7} max={1.4} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
              </OptionField>
              <OptionField label="Format">
                <Segmented<Format>
                  label="Format"
                  value={format}
                  options={[
                    { value: 'mp3', label: 'MP3' },
                    { value: 'wav', label: 'WAV' },
                  ]}
                  onChange={setFormat}
                />
              </OptionField>
              {doc ? (
                <p className={estMinutes > 10 ? 'text-[0.7rem]/relaxed text-warning' : 'text-[0.7rem]/relaxed text-muted-foreground'}>
                  About {Math.max(1, Math.round(estMinutes))} min of speech. The voice model runs on the CPU at roughly a fifth
                  of real time, so expect about {Math.max(1, Math.round(estMinutes * 5))} min to make the file
                  {estMinutes > 10 ? '; consider a page range' : ''}.
                </p>
              ) : null}
            </fieldset>
          </SectionCard>
          <RunBar
            label="Make audio file"
            running={running}
            progress={progress}
            note={note}
            disabledReason={reason}
            onRun={run}
            onCancel={() => ctrl.current?.abort()}
          />
        </div>
      </div>
    </div>
  );
}
