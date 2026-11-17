/**
 * Browser-to-browser file transfer over a WebRTC data channel. Signalling is
 * done by hand: the offer and the answer are compressed SDP codes the two
 * people copy, paste or scan. Data is encrypted by DTLS end to end; nothing
 * passes through a server of ours. Without STUN only host candidates exist,
 * so peers must reach each other directly (same network or same device).
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

export const STUN_HOST = 'stun.l.google.com';
const PREFIX = 'MMP2P1.';
export const CHUNK = 64 * 1024;
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;

export function config(stun: boolean): RTCConfiguration {
  return { iceServers: stun ? [{ urls: `stun:${STUN_HOST}:19302` }] : [] };
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** SDP → short, copyable code (deflate + base64url). */
export function encodeSignal(desc: RTCSessionDescriptionInit): string {
  return PREFIX + b64url(deflateSync(strToU8(JSON.stringify({ t: desc.type, s: desc.sdp })), { level: 9 }));
}

export function decodeSignal(code: string): RTCSessionDescriptionInit {
  const c = code.trim().replace(/\s+/g, '');
  if (!c.startsWith(PREFIX)) throw new Error('This is not a Metamorpher connection code.');
  try {
    const o = JSON.parse(strFromU8(inflateSync(unb64url(c.slice(PREFIX.length))))) as { t: RTCSdpType; s: string };
    return { type: o.t, sdp: o.s };
  } catch {
    throw new Error('This code is damaged. Copy the whole code again.');
  }
}

/** Resolves once ICE gathering is complete (non-trickle signalling), or after `ms`. */
export function gathered(pc: RTCPeerConnection, ms = 6000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(t);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export function candidateKinds(sdp: string | undefined): string[] {
  return [...new Set([...(sdp ?? '').matchAll(/a=candidate:\S+ \d \S+ \d+ \S+ \d+ typ (\w+)/g)].map((m) => m[1] as string))];
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type Header = { type: 'file'; id: string; name: string; size: number; mime: string; sha256: string };
export type Done = { type: 'end'; id: string };

/** Sends files one after another with backpressure; `onProgress(sentBytes)` per chunk. */
export async function sendFiles(
  ch: RTCDataChannel,
  files: File[],
  onFile: (index: number, header: Header) => void,
  onProgress: (index: number, sent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  ch.bufferedAmountLowThreshold = LOW_WATER;
  const drain = () =>
    new Promise<void>((resolve, reject) => {
      if (ch.bufferedAmount <= HIGH_WATER) return resolve();
      const onLow = () => {
        ch.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };
      ch.addEventListener('bufferedamountlow', onLow);
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    });
  for (let i = 0; i < files.length; i++) {
    const f = files[i] as File;
    const header: Header = { type: 'file', id: `${Date.now()}-${i}`, name: f.name, size: f.size, mime: f.type || 'application/octet-stream', sha256: await sha256Hex(f) };
    onFile(i, header);
    ch.send(JSON.stringify(header));
    let sent = 0;
    // Read in 4 MB slices to keep memory flat for big files.
    for (let off = 0; off < f.size; off += 4 * CHUNK * 16) {
      const slice = new Uint8Array(await f.slice(off, Math.min(f.size, off + 4 * CHUNK * 16)).arrayBuffer());
      for (let o = 0; o < slice.length; o += CHUNK) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (ch.readyState !== 'open') throw new Error('The connection closed during the transfer.');
        await drain();
        ch.send(slice.subarray(o, Math.min(slice.length, o + CHUNK)));
        sent += Math.min(CHUNK, slice.length - o);
        onProgress(i, sent);
      }
    }
    ch.send(JSON.stringify({ type: 'end', id: header.id } satisfies Done));
  }
}
