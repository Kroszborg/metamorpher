/** QR payload formats: plain text/URL, Wi-Fi (ZXing WIFI: scheme), vCard 3.0 and UPI. */
import { upiLink } from '@/components/business/qr';

export type Kind = 'text' | 'wifi' | 'vcard' | 'upi';

export type Wifi = { ssid: string; password: string; security: 'WPA' | 'WEP' | 'nopass'; hidden: boolean };
export type VCard = { first: string; last: string; org: string; title: string; phone: string; email: string; url: string; address: string; note: string };
export type Upi = { vpa: string; name: string; amount: string; note: string };

/** Backslash-escapes the characters the WIFI: scheme reserves. */
function wifiEsc(s: string): string {
  return s.replace(/([\\;,:"])/g, '\\$1');
}

export function wifiPayload(w: Wifi): string {
  const parts = [`T:${w.security}`, `S:${wifiEsc(w.ssid)}`];
  if (w.security !== 'nopass') parts.push(`P:${wifiEsc(w.password)}`);
  if (w.hidden) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

/** vCard text values escape backslash, comma, semicolon and newlines. */
function vEsc(s: string): string {
  return s.replace(/([\\,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
}

export function vcardPayload(v: VCard): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(v.last)};${vEsc(v.first)};;;`, `FN:${vEsc(`${v.first} ${v.last}`.trim())}`];
  if (v.org.trim()) lines.push(`ORG:${vEsc(v.org.trim())}`);
  if (v.title.trim()) lines.push(`TITLE:${vEsc(v.title.trim())}`);
  if (v.phone.trim()) lines.push(`TEL;TYPE=CELL:${v.phone.trim()}`);
  if (v.email.trim()) lines.push(`EMAIL:${v.email.trim()}`);
  if (v.url.trim()) lines.push(`URL:${v.url.trim()}`);
  if (v.address.trim()) lines.push(`ADR;TYPE=WORK:;;${vEsc(v.address.trim())};;;;`);
  if (v.note.trim()) lines.push(`NOTE:${vEsc(v.note.trim())}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function upiPayload(u: Upi): string {
  const amount = Number(u.amount);
  return upiLink({ vpa: u.vpa, name: u.name, amount: Number.isFinite(amount) && amount > 0 ? amount : undefined, note: u.note });
}
