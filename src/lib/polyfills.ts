/**
 * Small polyfills for recent JavaScript built-ins that pdf.js 6 calls without
 * checking: Map/WeakMap `getOrInsert(Computed)`, `Promise.try`,
 * `Math.sumPrecise` and the Uint8Array base64/hex helpers. Current Chrome has
 * them; Firefox before 144 and Safari before 26 miss some, and pdf.js then
 * fails ("getOrInsertComputed is not a function"). Import this module before
 * pdf.js (main thread and its workers). Each one is only defined when missing.
 */

type AnyMap = {
  has(key: unknown): boolean;
  get(key: unknown): unknown;
  set(key: unknown, value: unknown): unknown;
};

function define(target: object, name: string, value: unknown) {
  if (name in target) return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
}

for (const proto of [Map.prototype, WeakMap.prototype]) {
  define(proto, 'getOrInsert', function getOrInsert(this: AnyMap, key: unknown, value: unknown) {
    if (!this.has(key)) this.set(key, value);
    return this.get(key);
  });
  define(proto, 'getOrInsertComputed', function getOrInsertComputed(this: AnyMap, key: unknown, compute: (k: unknown) => unknown) {
    if (!this.has(key)) this.set(key, compute(key));
    return this.get(key);
  });
}

define(Promise, 'try', function tryFn<T>(fn: (...args: unknown[]) => T | PromiseLike<T>, ...args: unknown[]) {
  return new Promise<T>((resolve) => resolve(fn(...args)));
});

// Neumaier summation: exact enough for pdf.js's use (bounding boxes and transforms).
define(Math, 'sumPrecise', function sumPrecise(values: Iterable<number>) {
  let sum = 0;
  let c = 0;
  let any = false;
  for (const v of values) {
    any = true;
    const t = sum + v;
    c += Math.abs(sum) >= Math.abs(v) ? sum - t + v : v - t + sum;
    sum = t;
  }
  return any ? sum + c : -0;
});

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

define(Uint8Array.prototype, 'toHex', function toHex(this: Uint8Array) {
  let s = '';
  for (const b of this) s += HEX[b];
  return s;
});

// Honours the standard options: libraries such as jose (used by the account
// server code in the same process) ask for { alphabet: 'base64url', omitPadding: true }.
function toBase64(this: Uint8Array, options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }) {
  let bin = '';
  for (let i = 0; i < this.length; i += 0x8000) bin += String.fromCharCode(...this.subarray(i, i + 0x8000));
  let out = btoa(bin);
  if (options?.alphabet === 'base64url') out = out.replace(/\+/g, '-').replace(/\//g, '_');
  if (options?.omitPadding) out = out.replace(/=+$/, '');
  return out;
}
{
  // Replace an earlier copy of this polyfill that ignored the options (never a native one).
  const existing = (Uint8Array.prototype as { toBase64?: unknown }).toBase64;
  if (typeof existing === 'function' && !/\[native code\]/.test(Function.prototype.toString.call(existing))) {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', { value: toBase64, writable: true, configurable: true, enumerable: false });
  }
  define(Uint8Array.prototype, 'toBase64', toBase64);
}

define(Uint8Array, 'fromBase64', function fromBase64(s: string) {
  const bin = atob(s.replace(/[\s]/g, '').replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
});

define(Uint8Array, 'fromHex', function fromHex(s: string) {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
});

export {};
