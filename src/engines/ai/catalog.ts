/**
 * On-device models the AI tools can download. Every entry is openly licensed
 * for commercial use (checked on the model cards, November 2026) and is fetched
 * from huggingface.co only after the user agrees, then kept in Cache Storage.
 *
 * Sizes are the bytes actually downloaded for the dtype used on each device
 * (weights plus tokenizer/config files), measured from the Hub file listing.
 */
export type ModelTask = 'embed' | 'chat' | 'asr' | 'segment' | 'upscale' | 'tts';
export type Device = 'webgpu' | 'wasm';
export type DtypeSpec = string | Record<string, string>;

export type ModelSpec = {
  /** Stable id used for cache markers. */
  key: string;
  task: ModelTask;
  /** Hugging Face repository. */
  repo: string;
  label: string;
  /** Short description for pickers. */
  blurb: string;
  licence: string;
  licenceUrl: string;
  /** Bytes per device; `null` when the model should not run on that device. */
  bytes: Record<Device, number | null>;
  dtype: Record<Device, DtypeSpec>;
  /** Super-resolution factor (upscale models). */
  scale?: number;
};

const MB = 1_000_000;
const HF = (repo: string) => `https://huggingface.co/${repo}`;

export const MODELS: readonly ModelSpec[] = [
  {
    key: 'minilm-l6',
    task: 'embed',
    repo: 'Xenova/all-MiniLM-L6-v2',
    label: 'all-MiniLM-L6-v2',
    blurb: 'Sentence embeddings for finding the relevant passages (English-centred).',
    licence: 'Apache-2.0',
    licenceUrl: HF('sentence-transformers/all-MiniLM-L6-v2'),
    bytes: { webgpu: 24 * MB, wasm: 24 * MB },
    dtype: { webgpu: 'q8', wasm: 'q8' },
  },
  {
    key: 'smollm2-135m',
    task: 'chat',
    repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    label: 'SmolLM2 135M',
    blurb: 'Tiny and fast; short, simple answers only.',
    licence: 'Apache-2.0',
    licenceUrl: HF('HuggingFaceTB/SmolLM2-135M-Instruct'),
    bytes: { webgpu: 121 * MB, wasm: 140 * MB },
    dtype: { webgpu: 'q4f16', wasm: 'q8' },
  },
  {
    key: 'qwen2.5-0.5b',
    task: 'chat',
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
    label: 'Qwen2.5 0.5B Instruct',
    blurb: 'Small multilingual model; the best balance for most devices.',
    licence: 'Apache-2.0',
    licenceUrl: HF('Qwen/Qwen2.5-0.5B-Instruct'),
    bytes: { webgpu: 490 * MB, wasm: 520 * MB },
    dtype: { webgpu: 'q4f16', wasm: 'q8' },
  },
  {
    key: 'qwen2.5-1.5b',
    task: 'chat',
    repo: 'onnx-community/Qwen2.5-1.5B-Instruct',
    label: 'Qwen2.5 1.5B Instruct',
    blurb: 'Noticeably better answers; needs WebGPU and about 3 GB of free memory.',
    licence: 'Apache-2.0',
    licenceUrl: HF('Qwen/Qwen2.5-1.5B-Instruct'),
    bytes: { webgpu: 1_230 * MB, wasm: null },
    dtype: { webgpu: 'q4f16', wasm: 'q8' },
  },
  {
    key: 'whisper-tiny',
    task: 'asr',
    repo: 'onnx-community/whisper-tiny',
    label: 'Whisper tiny',
    blurb: 'Fastest; fine for clear speech.',
    licence: 'Apache-2.0',
    licenceUrl: HF('openai/whisper-tiny'),
    bytes: { webgpu: 124 * MB, wasm: 45 * MB },
    dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' } },
  },
  {
    key: 'whisper-base',
    task: 'asr',
    repo: 'onnx-community/whisper-base',
    label: 'Whisper base',
    blurb: 'Better accuracy, about twice as slow as tiny.',
    licence: 'Apache-2.0',
    licenceUrl: HF('openai/whisper-base'),
    bytes: { webgpu: 210 * MB, wasm: 81 * MB },
    dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' } },
  },
  {
    key: 'whisper-small',
    task: 'asr',
    repo: 'onnx-community/whisper-small',
    label: 'Whisper small',
    blurb: 'Most accurate here; slow without WebGPU.',
    licence: 'Apache-2.0',
    licenceUrl: HF('openai/whisper-small'),
    bytes: { webgpu: 590 * MB, wasm: 253 * MB },
    dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' } },
  },
  {
    key: 'ormbg',
    task: 'segment',
    repo: 'onnx-community/ormbg-ONNX',
    label: 'Open Remove Background (ormbg)',
    blurb: 'General purpose: people, products, animals, objects.',
    licence: 'Apache-2.0',
    licenceUrl: HF('schirrmacher/ormbg'),
    bytes: { webgpu: 89 * MB, wasm: 45 * MB },
    dtype: { webgpu: 'fp16', wasm: 'q8' },
  },
  {
    key: 'birefnet-lite',
    task: 'segment',
    repo: 'onnx-community/BiRefNet_lite-ONNX',
    label: 'BiRefNet lite',
    blurb: 'Finest edges (hair, fur); needs WebGPU (1024 px network, too heavy for the CPU path).',
    licence: 'MIT',
    licenceUrl: HF('ZhengPeng7/BiRefNet_lite'),
    bytes: { webgpu: 115 * MB, wasm: null },
    dtype: { webgpu: 'fp16', wasm: 'fp32' },
  },
  {
    key: 'modnet',
    task: 'segment',
    repo: 'Xenova/modnet',
    label: 'MODNet (portraits)',
    blurb: 'Small and fast, made for people and portraits only.',
    licence: 'Apache-2.0',
    licenceUrl: HF('Xenova/modnet'),
    bytes: { webgpu: 26 * MB, wasm: 7 * MB },
    dtype: { webgpu: 'fp32', wasm: 'q8' },
  },
  {
    key: 'swin2sr-x2',
    task: 'upscale',
    repo: 'Xenova/swin2SR-classical-sr-x2-64',
    label: 'Swin2SR 2× (classical)',
    blurb: 'Clean 2× enlargement for sharp sources.',
    licence: 'Apache-2.0',
    licenceUrl: HF('caidas/swin2SR-classical-sr-x2-64'),
    bytes: { webgpu: 55 * MB, wasm: 55 * MB },
    dtype: { webgpu: 'fp32', wasm: 'fp32' },
    scale: 2,
  },
  {
    key: 'swin2sr-x2-light',
    task: 'upscale',
    repo: 'Xenova/swin2SR-lightweight-x2-64',
    label: 'Swin2SR 2× lightweight',
    blurb: 'Fast 2× enlargement, slightly softer.',
    licence: 'Apache-2.0',
    licenceUrl: HF('caidas/swin2SR-lightweight-x2-64'),
    bytes: { webgpu: 8.2 * MB, wasm: 8.2 * MB },
    dtype: { webgpu: 'fp32', wasm: 'fp32' },
    scale: 2,
  },
  {
    key: 'swin2sr-x4-real',
    task: 'upscale',
    repo: 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr',
    label: 'Swin2SR 4× (real-world photos)',
    blurb: '4× enlargement that also cleans noise and JPEG artefacts.',
    licence: 'Apache-2.0',
    licenceUrl: HF('caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr'),
    bytes: { webgpu: 53 * MB, wasm: 53 * MB },
    dtype: { webgpu: 'fp32', wasm: 'fp32' },
    scale: 4,
  },
  {
    key: 'kokoro-82m',
    task: 'tts',
    repo: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    label: 'Kokoro 82M (English voices)',
    blurb: 'Natural-sounding English speech; six US and UK voices are included.',
    licence: 'Apache-2.0',
    licenceUrl: HF('hexgrad/Kokoro-82M'),
    // The 8-bit model runs well on the CPU; the WebGPU build would be a 326 MB download.
    bytes: { webgpu: null, wasm: 96 * MB },
    dtype: { webgpu: 'fp32', wasm: 'q8' },
  },
];

export function modelsFor(task: ModelTask): ModelSpec[] {
  return MODELS.filter((m) => m.task === task);
}

export function getModel(key: string): ModelSpec | undefined {
  return MODELS.find((m) => m.key === key);
}

/** Hosts a model download may touch (the Hub redirects large files to its CDN). */
export const MODEL_HOST = 'huggingface.co';
