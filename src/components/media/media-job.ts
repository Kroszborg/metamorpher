import type { InputFile, JobContext, OutputFile } from '@/components/workbench';
import type { MediaCallOptions, MediaResult } from '@/engines/media';
import { baseName } from '@/lib/files';
import type { JobLog } from './job-log';

/**
 * Runs one media engine call for a tool's job, records the engine report in
 * the tool's log and returns the output file named `<input><suffix>.<ext>`.
 */
export async function runMedia(
  log: JobLog,
  input: InputFile,
  ctx: JobContext,
  call: (opts: MediaCallOptions) => Promise<MediaResult>,
  suffix = '',
): Promise<OutputFile> {
  const result = await call({ signal: ctx.signal, onProgress: ctx.onProgress });
  const name = `${baseName(input.file.name)}${suffix}.${result.ext}`;
  log.push({ name: input.file.name, output: name, size: result.blob.size, report: result.report });
  return { name, blob: result.blob };
}
