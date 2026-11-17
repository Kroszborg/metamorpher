/** Indian GST: state codes and GSTIN validation (format and check character). */

export type GstState = { code: string; name: string; /** Union territory without a legislature: UTGST instead of SGST. */ ut?: boolean };

export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh', ut: true },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', ut: true },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep', ut: true },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands', ut: true },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh', ut: true },
  { code: '97', name: 'Other Territory', ut: true },
  { code: '96', name: 'Other Country (export)' },
];

const byCode = new Map(GST_STATES.map((s) => [s.code, s]));

export function gstState(code: string): GstState | undefined {
  return byCode.get(code);
}

export function stateLabel(code: string): string {
  const s = byCode.get(code);
  return s ? `${s.name} (${s.code})` : '';
}

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The 15th character of a GSTIN from its first 14 (GSTN's mod-36 Luhn variant). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i] as string);
    if (v < 0) return '';
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36] as string;
}

export type GstinCheck =
  | { ok: true; state: string; pan: string }
  | { ok: false; error: string };

/** Normalises (upper case, no spaces) and validates a regular GSTIN. */
export function checkGstin(raw: string): GstinCheck {
  const g = normalizeGstin(raw);
  if (g.length !== 15) return { ok: false, error: `A GSTIN has 15 characters (this has ${g.length}).` };
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][Z][0-9A-Z]$/.test(g)) {
    if (!/^[0-9]{2}/.test(g)) return { ok: false, error: 'The first two characters must be the state code.' };
    if (!/^.{2}[A-Z]{5}[0-9]{4}[A-Z]/.test(g)) return { ok: false, error: 'Characters 3–12 must be a PAN (5 letters, 4 digits, 1 letter).' };
    if (g[13] !== 'Z') return { ok: false, error: 'The 14th character of a regular GSTIN is Z.' };
    return { ok: false, error: 'This is not in the GSTIN format.' };
  }
  const state = g.slice(0, 2);
  if (!byCode.has(state) || state === '96') return { ok: false, error: `${state} is not a GST state code.` };
  const expected = gstinCheckChar(g.slice(0, 14));
  if (g[14] !== expected) return { ok: false, error: `The check character does not match (expected ${expected}). Look for a typo.` };
  return { ok: true, state, pan: g.slice(2, 12) };
}

export function normalizeGstin(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

/** HSN (goods, 4/6/8 digits) or SAC (services, 6 digits starting 99). */
export function checkHsn(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return 'HSN/SAC codes are digits only.';
  if (![4, 6, 8].includes(v.length)) return 'HSN/SAC codes have 4, 6 or 8 digits.';
  return null;
}
