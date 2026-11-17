import type { EncryptOptions, PermissionSet } from '../mupdf/types';
import { WorkerHost } from '../worker-host';
import type { QpdfRun, QpdfWorkerApi } from './qpdf.worker';

const host = new WorkerHost<QpdfWorkerApi>(
  () => new Worker(new URL('./qpdf.worker.ts', import.meta.url), { type: 'module' }),
);

type CallOptions = { signal?: AbortSignal };

const IN = '/input.pdf';
const OUT = '/output.pdf';

/** Approximate one-time download of the qpdf engine (wasm + glue), for UI hints. */
export const QPDF_DOWNLOAD_BYTES = 1_380_000;

function passwordError(kind: 'needed' | 'wrong'): Error {
  const err = new Error(
    kind === 'needed'
      ? 'This PDF is password-protected. Enter its password to continue.'
      : 'That password is not correct for this PDF.',
  );
  err.name = kind === 'needed' ? 'PasswordRequiredError' : 'WrongPasswordError';
  return err;
}

function failure(run: QpdfRun, what: string): Error {
  const detail = run.output
    .map((l) => l.replace(/^qpdf(\.js)?:\s*/, '').replace(new RegExp(`${IN}:?\\s*`, 'g'), ''))
    .filter(Boolean)
    .slice(-2)
    .join(' ');
  return new Error(`${what}${detail ? `: ${detail}` : '.'}`);
}

async function exec(args: string[], file: Blob, signal?: AbortSignal, outputs: string[] = [OUT]): Promise<QpdfRun> {
  return host.call((api) => api.run(args, { [IN]: file }, outputs), signal);
}

/** qpdf exit codes: 0 ok, 2 error, 3 warnings (output still written). */
function outputOf(run: QpdfRun, what: string): Blob {
  const blob = run.files[OUT];
  if (run.code === 2 || !blob || blob.size === 0) {
    if (run.output.some((l) => /invalid password/i.test(l))) throw passwordError('wrong');
    throw failure(run, what);
  }
  return blob;
}

export type QpdfEncryption = {
  encrypted: boolean;
  /** An open password is required (none was supplied, or it was wrong). */
  needsPassword: boolean;
  /** The supplied password (if any) was the owner password. */
  ownerPasswordMatched: boolean;
  method: string | null;
  permissions: PermissionSet | null;
};

type QpdfJsonEncrypt = {
  encrypt?: {
    encrypted?: boolean;
    userpasswordmatched?: boolean;
    ownerpasswordmatched?: boolean;
    capabilities?: Record<string, boolean>;
    parameters?: { bits?: number; method?: string; P?: number; R?: number };
  };
};

function yn(v: boolean): string {
  return v ? 'y' : 'n';
}

/**
 * qpdf engine (qpdf 12, WebAssembly, ~1.3 MB). Lighter than MuPDF for
 * structure-only jobs: encryption, decryption and recovery of damaged files.
 */
export const qpdfEngine = {
  /** Encryption state and permissions, read without decrypting content. */
  async inspect(file: Blob, { password, signal }: CallOptions & { password?: string } = {}): Promise<QpdfEncryption> {
    const args = ['--json', '--json-key=encrypt'];
    if (password) args.push(`--password=${password}`);
    args.push(IN);
    const run = await exec(args, file, signal, []);
    const text = run.output.join('\n');
    const start = text.indexOf('{');
    if (start < 0) {
      if (/invalid password/i.test(text)) {
        return { encrypted: true, needsPassword: true, ownerPasswordMatched: false, method: null, permissions: null };
      }
      throw failure(run, 'This file could not be read as a PDF');
    }
    const json = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)) as QpdfJsonEncrypt;
    const enc = json.encrypt ?? {};
    if (!enc.encrypted) {
      return { encrypted: false, needsPassword: false, ownerPasswordMatched: false, method: null, permissions: null };
    }
    const caps = enc.capabilities ?? {};
    const method = enc.parameters?.method ?? null;
    const bits = enc.parameters?.bits;
    return {
      encrypted: true,
      needsPassword: false,
      ownerPasswordMatched: Boolean(enc.ownerpasswordmatched),
      method:
        method === 'AESv3' ? 'AES-256' : method === 'AESv2' ? 'AES-128' : method ? `${method}${bits ? `-${bits}` : ''}` : null,
      permissions: {
        print: Boolean(caps.printlow),
        printHighQuality: Boolean(caps.printhigh),
        copy: Boolean(caps.extract),
        edit: Boolean(caps.modifyother ?? caps.modify),
        annotate: Boolean(caps.modifyannotations),
        fillForms: Boolean(caps.modifyforms),
        accessibility: Boolean(caps.accessibility),
        assemble: Boolean(caps.modifyassembly),
      },
    };
  },

  /** True when the file has an /Encrypt dictionary (open password or permissions only). */
  async isEncrypted(file: Blob, opts: CallOptions = {}): Promise<boolean> {
    return (await qpdfEngine.inspect(file, opts)).encrypted;
  },

  /** AES-256 (or AES-128) encryption with an open password, an owner password and permissions. */
  async encrypt(file: Blob, opts: EncryptOptions, { signal, password }: CallOptions & { password?: string } = {}): Promise<Blob> {
    const p = opts.permissions;
    const bits = opts.algorithm === 'aes-128' ? '128' : '256';
    const args = [
      '--encrypt',
      `--user-password=${opts.userPassword}`,
      `--owner-password=${opts.ownerPassword}`,
      `--bits=${bits}`,
      `--print=${p.print ? (p.printHighQuality ? 'full' : 'low') : 'none'}`,
      `--extract=${yn(p.copy)}`,
      `--accessibility=${yn(p.accessibility)}`,
      `--annotate=${yn(p.annotate)}`,
      `--form=${yn(p.fillForms)}`,
      `--assemble=${yn(p.assemble)}`,
      `--modify-other=${yn(p.edit)}`,
    ];
    if (bits === '128') args.push('--use-aes=y');
    args.push('--');
    if (password) args.push(`--password=${password}`);
    args.push(IN, OUT);
    const run = await exec(args, file, signal);
    if (run.output.some((l) => /password/i.test(l) && /invalid|required/i.test(l))) throw passwordError('needed');
    return outputOf(run, 'The PDF could not be encrypted');
  },

  /** Removes encryption using the open (or owner) password. */
  async decrypt(file: Blob, password: string, { signal }: CallOptions = {}): Promise<Blob> {
    const run = await exec(['--decrypt', `--password=${password}`, IN, OUT], file, signal);
    return outputOf(run, 'The PDF could not be decrypted');
  },

  /**
   * Removes owner-password restrictions from a file that opens without a
   * password. Fails with PasswordRequiredError when it needs an open password.
   */
  async removeRestrictions(file: Blob, { signal }: CallOptions = {}): Promise<Blob> {
    const run = await exec(['--decrypt', IN, OUT], file, signal);
    if (run.code === 2 && run.output.some((l) => /invalid password/i.test(l))) throw passwordError('needed');
    return outputOf(run, 'The restrictions could not be removed');
  },

  /**
   * Rewrites a damaged file with qpdf's own recovery (reconstructs the xref
   * table, drops unreadable objects). Resolves with the warnings qpdf reported.
   */
  async repair(
    file: Blob,
    { signal, password }: CallOptions & { password?: string } = {},
  ): Promise<{ blob: Blob; warnings: string[] }> {
    const args = ['--object-streams=generate'];
    if (password) args.push(`--password=${password}`, '--decrypt');
    const run = await exec([...args, IN, OUT], file, signal);
    const blob = outputOf(run, 'qpdf could not recover this file');
    const warnings = run.output
      .filter((l) => /warning|error|damaged|recover/i.test(l))
      .map((l) => l.replace(/^qpdf(\.js)?:\s*/, '').replace(new RegExp(`^(WARNING: )?${IN}:?\\s*`), ''));
    return { blob, warnings };
  },

  terminate(): void {
    host.terminate();
  },
};

export type QpdfEngine = typeof qpdfEngine;
