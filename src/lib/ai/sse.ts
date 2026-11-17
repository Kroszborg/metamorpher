/**
 * A small server-sent events reader for fetch() response bodies.
 *
 * Follows the WHATWG event-stream rules that matter for AI providers: events
 * end at a blank line, `data:` lines are joined with "\n", lines starting with
 * ":" are comments (OpenRouter sends ": OPENROUTER PROCESSING"), and CR, LF or
 * CRLF all end a line, including across chunk boundaries.
 */
export type SseEvent = { event: string; data: string };

export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const nl = buffer.search(/\r\n|\r|\n/);
        if (nl < 0) break;
        // A lone CR at the end of the buffer may be the first half of CRLF: wait for more.
        if (buffer[nl] === '\r' && nl === buffer.length - 1) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + (buffer.startsWith('\r\n', nl) ? 2 : 1));
        if (line === '') {
          if (data.length > 0) yield { event: event || 'message', data: data.join('\n') };
          event = '';
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let val = colon < 0 ? '' : line.slice(colon + 1);
        if (val.startsWith(' ')) val = val.slice(1);
        if (field === 'data') data.push(val);
        else if (field === 'event') event = val;
      }
    }
    buffer += decoder.decode();
    // A stream that ends without the final blank line still delivers its last event.
    for (const line of buffer.split(/\r\n|\r|\n/)) {
      if (line === '' && data.length > 0) {
        yield { event: event || 'message', data: data.join('\n') };
        event = '';
        data = [];
      } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) event = line.slice(6).replace(/^ /, '');
    }
    if (data.length > 0) yield { event: event || 'message', data: data.join('\n') };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
