import type { Device, ModelSpec } from './catalog';

export type DeviceInfo = {
  webgpu: boolean;
  /** WebGPU adapter supports half floats (needed by the q4f16 weights). */
  f16: boolean;
  /** navigator.deviceMemory (Chrome; rounded, capped at 8). */
  memoryGB: number | null;
  adapter: string | null;
};

type GpuAdapter = {
  features: { has(name: string): boolean };
  isFallbackAdapter?: boolean;
  info?: { vendor?: string; architecture?: string; isFallbackAdapter?: boolean };
};
type GpuNavigator = Navigator & {
  gpu?: { requestAdapter(opts?: { powerPreference?: string }): Promise<GpuAdapter | null> };
  deviceMemory?: number;
};

let cached: Promise<DeviceInfo> | null = null;

/** What this browser offers for on-device models. Cached for the page's lifetime. */
export function detectDevice(): Promise<DeviceInfo> {
  cached ??= (async () => {
    const nav = navigator as GpuNavigator;
    const memoryGB = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
    let adapter: GpuAdapter | null = null;
    try {
      adapter = (await nav.gpu?.requestAdapter({ powerPreference: 'high-performance' })) ?? null;
    } catch {
      adapter = null;
    }
    // A software adapter (SwiftShader, used when there is no usable GPU) is slower than WebAssembly.
    const software =
      !!adapter &&
      (adapter.isFallbackAdapter === true ||
        adapter.info?.isFallbackAdapter === true ||
        /swiftshader/i.test(`${adapter.info?.vendor ?? ''} ${adapter.info?.architecture ?? ''}`));
    if (software) adapter = null;
    return {
      webgpu: !!adapter,
      f16: !!adapter?.features.has('shader-f16'),
      memoryGB,
      adapter: adapter?.info ? [adapter.info.vendor, adapter.info.architecture].filter(Boolean).join(' ') || null : null,
    };
  })();
  return cached;
}

export type DevicePlan = { device: Device; bytes: number } | { device: null; reason: string };

function needsF16(spec: ModelSpec): boolean {
  const d = spec.dtype.webgpu;
  return (typeof d === 'string' ? [d] : Object.values(d)).some((v) => v.includes('f16'));
}

/** Where a model runs here: WebGPU when it can, otherwise WebAssembly on the CPU, or why it cannot run. */
export function planDevice(spec: ModelSpec, info: DeviceInfo): DevicePlan {
  const gpuOk = info.webgpu && spec.bytes.webgpu !== null && (!needsF16(spec) || info.f16);
  if (gpuOk) return { device: 'webgpu', bytes: spec.bytes.webgpu as number };
  if (spec.bytes.wasm !== null) {
    if (spec.task === 'chat' && info.memoryGB !== null && info.memoryGB < 4 && spec.bytes.wasm > 300_000_000) {
      return {
        device: null,
        reason: `This device reports ${info.memoryGB} GB of memory, too little for ${spec.label} without WebGPU. Pick a smaller model or use an API key.`,
      };
    }
    return { device: 'wasm', bytes: spec.bytes.wasm };
  }
  return {
    device: null,
    reason: info.webgpu
      ? `${spec.label} needs WebGPU with half-precision support, which this graphics adapter does not offer.`
      : `${spec.label} needs WebGPU, which this browser does not offer. Try a recent Chrome or Edge on a desktop, or pick a smaller model.`,
  };
}
