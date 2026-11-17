'use client';

import { Camera01Icon, FileAddIcon, Link01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { qrPngDataUrl } from '@/components/business/qr';
import { CopyButton } from '@/components/kit/copy-button';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { SwitchRow } from '@/components/pdf-stage';
import { type ResultNote, ResultRows } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ResultFile } from '@/components/workbench';
import { formatBytes, newId } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import { candidateKinds, config, decodeSignal, type Done, encodeSignal, gathered, type Header, sendFiles, sha256Hex, STUN_HOST } from './rtc';

type Role = 'send' | 'receive';
type Progress = { name: string; size: number; done: number; verified?: boolean | null };

function useCamera(onCode: (text: string) => void) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let live = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!live || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const { default: jsQR } = await import('jsqr');
        const canvas = document.createElement('canvas');
        const tick = () => {
          const v = video.current;
          if (!live || !v) return;
          if (v.videoWidth) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0);
              const r = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
              if (r?.data) {
                onCode(r.data);
                setOn(false);
                return;
              }
            }
          }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch {
        toast.error('The camera is not available. Paste the code instead.');
        setOn(false);
      }
    })();
    return () => {
      live = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on, onCode]);
  return { video, on, setOn };
}

function CodeBox({ code, label }: { code: string; label: string }) {
  const qr = useMemo(() => {
    try {
      return qrPngDataUrl(code, { ecc: 'L', px: 4, border: 2 });
    } catch {
      return null;
    }
  }, [code]);
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <div className="flex min-w-0 flex-col gap-2">
        <Textarea readOnly value={code} aria-label={label} className="min-h-24 font-mono text-[0.65rem] break-all" onFocus={(e) => e.currentTarget.select()} data-code />
        <CopyButton value={code} label="Copy code" showLabel className="self-start" />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr ? <img src={qr} alt="The code as a QR code" className="size-40 rounded border bg-white p-1 [image-rendering:pixelated]" /> : null}
    </div>
  );
}

export default function P2pShare(_props: ToolProps) {
  const [role, setRole] = useState<Role>('send');
  const [stun, setStun] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [myCode, setMyCode] = useState('');
  const [theirCode, setTheirCode] = useState('');
  const [state, setState] = useState<string>('idle');
  const [kinds, setKinds] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [received, setReceived] = useState<ResultFile[]>([]);
  const [notes, setNotes] = useState<Record<string, ResultNote[]>>({});
  const [speed, setSpeed] = useState(0);
  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const abort = useRef<AbortController | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  });
  const { video: cameraVideo, on: cameraOn, setOn: setCameraOn } = useCamera((text) => setTheirCode(text));

  useEffect(
    () => () => {
      abort.current?.abort();
      pc.current?.close();
    },
    [],
  );
  // Object URLs of received files live until the page closes (the list only grows).
  const receivedRef = useRef(received);
  useEffect(() => {
    receivedRef.current = received;
  });
  useEffect(() => () => receivedRef.current.forEach((r) => URL.revokeObjectURL(r.url)), []);

  function reset() {
    abort.current?.abort();
    pc.current?.close();
    pc.current = null;
    channel.current = null;
    setMyCode('');
    setTheirCode('');
    setState('idle');
    setKinds([]);
    setProgress([]);
    setSpeed(0);
  }

  function watch(conn: RTCPeerConnection) {
    conn.addEventListener('connectionstatechange', () => setState(conn.connectionState));
    conn.addEventListener('iceconnectionstatechange', () => {
      if (conn.iceConnectionState === 'failed') toast.error(stun ? 'Could not connect. A network in between may block direct connections.' : 'Could not connect. On different networks, turn on the STUN helper on both sides.');
    });
  }

  async function startSend() {
    if (!files.length) return;
    reset();
    const conn = new RTCPeerConnection(config(stun));
    pc.current = conn;
    watch(conn);
    const ch = conn.createDataChannel('files', { ordered: true });
    ch.binaryType = 'arraybuffer';
    channel.current = ch;
    ch.addEventListener('open', () => void runSend(ch));
    await conn.setLocalDescription(await conn.createOffer());
    setState('gathering');
    await gathered(conn);
    setKinds(candidateKinds(conn.localDescription?.sdp));
    setMyCode(encodeSignal(conn.localDescription as RTCSessionDescriptionInit));
    setState('waiting for answer');
  }

  async function acceptAnswer() {
    try {
      const desc = decodeSignal(theirCode);
      if (desc.type !== 'answer') throw new Error('This is a sending code. Paste the code the receiver shows.');
      await pc.current?.setRemoteDescription(desc);
      setState('connecting');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'This code could not be used.');
    }
  }

  async function runSend(ch: RTCDataChannel) {
    const list = filesRef.current;
    const controller = new AbortController();
    abort.current = controller;
    setProgress(list.map((f) => ({ name: f.name, size: f.size, done: 0 })));
    const t0 = performance.now();
    let total = 0;
    try {
      await sendFiles(
        ch,
        list,
        () => undefined,
        (i, sent) => {
          setProgress((p) => p.map((x, j) => (j === i ? { ...x, done: sent } : x)));
          total = list.slice(0, i).reduce((a, f) => a + f.size, 0) + sent;
          setSpeed(total / ((performance.now() - t0) / 1000));
        },
        controller.signal,
      );
      setState('sent');
      toast.success(`Sent ${list.length} ${list.length === 1 ? 'file' : 'files'}.`);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) toast.error(err instanceof Error ? err.message : 'The transfer stopped.');
    }
  }

  async function startReceive() {
    try {
      const desc = decodeSignal(theirCode);
      if (desc.type !== 'offer') throw new Error('This is an answer code. Paste the code the sender shows.');
      pc.current?.close();
      const conn = new RTCPeerConnection(config(stun));
      pc.current = conn;
      watch(conn);
      conn.addEventListener('datachannel', (e) => receiveOn(e.channel));
      await conn.setRemoteDescription(desc);
      await conn.setLocalDescription(await conn.createAnswer());
      setState('gathering');
      await gathered(conn);
      setKinds(candidateKinds(conn.localDescription?.sdp));
      setMyCode(encodeSignal(conn.localDescription as RTCSessionDescriptionInit));
      setState('waiting for sender');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'This code could not be used.');
    }
  }

  function receiveOn(ch: RTCDataChannel) {
    ch.binaryType = 'arraybuffer';
    channel.current = ch;
    let current: { header: Header; parts: ArrayBuffer[]; got: number; index: number } | null = null;
    let index = -1;
    const t0 = performance.now();
    let total = 0;
    ch.addEventListener('message', (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data) as Header | Done;
        if (msg.type === 'file') {
          index += 1;
          current = { header: msg, parts: [], got: 0, index };
          const i = index;
          setProgress((p) => [...p.slice(0, i), { name: msg.name, size: msg.size, done: 0 }]);
        } else if (msg.type === 'end' && current) {
          const c = current;
          current = null;
          const blob = new Blob(c.parts, { type: c.header.mime });
          void sha256Hex(blob).then((hash) => {
            const ok = hash === c.header.sha256 && blob.size === c.header.size;
            const id = newId('p2p');
            setReceived((r) => [...r, { id, name: c.header.name, blob, url: URL.createObjectURL(blob) }]);
            setNotes((n) => ({
              ...n,
              [id]: [ok ? { kind: 'ok', text: `SHA-256 matches the sender's (${hash.slice(0, 16)}…).` } : { kind: 'error', text: 'The checksum does not match: the file is damaged. Send it again.' }],
            }));
            setProgress((p) => p.map((x, j) => (j === c.index ? { ...x, done: x.size, verified: ok } : x)));
          });
        }
        return;
      }
      if (!current) return;
      const buf = e.data as ArrayBuffer;
      current.parts.push(buf);
      current.got += buf.byteLength;
      total += buf.byteLength;
      const c = current;
      if (c.got === c.header.size || c.parts.length % 16 === 0) {
        setProgress((p) => p.map((x, j) => (j === c.index ? { ...x, done: c.got } : x)));
        setSpeed(total / ((performance.now() - t0) / 1000));
      }
    });
  }

  const connected = state === 'connected' || state === 'sent';
  const stunNote = `Needed only across different networks: it tells each browser its public address. Turning it on makes both browsers contact ${STUN_HOST} (Google). Your files never go there; they still travel directly and encrypted.`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Role>
          label="Role"
          value={role}
          options={[
            { value: 'send', label: 'Send files' },
            { value: 'receive', label: 'Receive files' },
          ]}
          onChange={(r) => {
            reset();
            setRole(r);
          }}
        />
        <p className="text-xs text-muted-foreground" data-p2p-state>
          Status: <span className="font-medium text-foreground">{state}</span>
          {kinds.length ? ` · candidates: ${kinds.join(', ')}` : ''}
          {speed ? ` · ${formatBytes(speed)}/s` : ''}
        </p>
      </div>

      <SectionCard title="Connection help (optional)" contentClassName="flex flex-col gap-2">
        <SwitchRow id="p2p-stun" label={`Use a STUN server (${STUN_HOST})`} checked={stun} onChange={(v) => setStun(v)} hint={stunNote} />
        <p className="text-[0.7rem]/relaxed text-muted-foreground">
          Off (default): the two devices must be on the same network (or be two tabs here). Both sides should use the same setting. There is no relay server, so some networks (mobile carriers, strict firewalls) cannot connect.
        </p>
      </SectionCard>

      {role === 'send' ? (
        <>
          <SectionCard
            title="1. Files"
            description={files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'}, ${formatBytes(files.reduce((a, f) => a + f.size, 0))}` : 'Choose what to send.'}
            contentClassName="flex flex-col gap-2"
          >
            <Button type="button" variant="outline" size="sm" className="self-start" disabled={!!myCode} onClick={() => picker.current?.click()}>
              <HugeiconsIcon icon={FileAddIcon} strokeWidth={2} />
              Choose files
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-label="Files to send"
              onChange={(e) => {
                setFiles([...(e.currentTarget.files ?? [])]);
                e.currentTarget.value = '';
              }}
            />
            {files.length ? (
              <ul className="text-xs text-muted-foreground">
                {files.map((f) => (
                  <li key={f.name + f.size}>
                    {f.name} · {formatBytes(f.size)}
                  </li>
                ))}
              </ul>
            ) : null}
          </SectionCard>
          <SectionCard title="2. Give this code to the receiver" contentClassName="flex flex-col gap-3">
            {myCode ? <CodeBox code={myCode} label="Sending code" /> : (
              <Button type="button" size="sm" className="self-start" disabled={!files.length} onClick={() => void startSend()}>
                <HugeiconsIcon icon={Link01Icon} strokeWidth={2} />
                Create the sending code
              </Button>
            )}
          </SectionCard>
          <SectionCard title="3. Paste the receiver's answer" contentClassName="flex flex-col gap-2">
            <Textarea aria-label="Answer code" value={theirCode} onChange={(e) => setTheirCode(e.currentTarget.value)} placeholder="MMP2P1.…" className="min-h-20 font-mono text-[0.65rem]" disabled={!myCode || connected} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={!myCode || !theirCode.trim() || connected} onClick={() => void acceptAnswer()}>
                Connect and send
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={!myCode || connected} onClick={() => setCameraOn(!cameraOn)}>
                <HugeiconsIcon icon={Camera01Icon} strokeWidth={2} />
                {cameraOn ? 'Stop camera' : 'Scan with camera'}
              </Button>
            </div>
          </SectionCard>
        </>
      ) : (
        <>
          <SectionCard title="1. Paste or scan the sender's code" contentClassName="flex flex-col gap-2">
            <Textarea aria-label="Sending code" value={theirCode} onChange={(e) => setTheirCode(e.currentTarget.value)} placeholder="MMP2P1.…" className="min-h-20 font-mono text-[0.65rem]" disabled={!!myCode} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={!theirCode.trim() || !!myCode} onClick={() => void startReceive()}>
                Create the answer
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={!!myCode} onClick={() => setCameraOn(!cameraOn)}>
                <HugeiconsIcon icon={Camera01Icon} strokeWidth={2} />
                {cameraOn ? 'Stop camera' : 'Scan with camera'}
              </Button>
            </div>
          </SectionCard>
          <SectionCard title="2. Give this answer to the sender" contentClassName="flex flex-col gap-3">
            {myCode ? <CodeBox code={myCode} label="Answer code" /> : <p className="text-xs text-muted-foreground">The answer appears here.</p>}
          </SectionCard>
        </>
      )}

      {cameraOn ? (
        <div className="overflow-hidden rounded-xl border bg-black">
          <video ref={cameraVideo} muted playsInline className="mx-auto max-h-80" aria-label="Camera preview for scanning a code" />
        </div>
      ) : null}

      {progress.length ? (
        <SectionCard title={role === 'send' ? 'Sending' : 'Receiving'} contentClassName="flex flex-col gap-2">
          {progress.map((p, i) => (
            <div key={i} className="flex flex-col gap-1" data-transfer>
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {formatBytes(p.done)} / {formatBytes(p.size)}
                  {p.verified === true ? ' ✓' : p.verified === false ? ' ✗' : ''}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${p.size ? (p.done / p.size) * 100 : 100}%` }} />
              </div>
            </div>
          ))}
        </SectionCard>
      ) : null}

      {received.length ? <ResultRows title="Received" results={received} notesFor={(r) => notes[r.id] ?? []} zipName="received.zip" /> : null}
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={reset}>
        Start over
      </Button>
    </div>
  );
}
