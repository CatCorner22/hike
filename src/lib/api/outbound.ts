const MAX_CONCURRENT_OUTBOUND = 8;
let active = 0;
const waiters: Array<() => void> = [];

async function acquire() {
  if (active < MAX_CONCURRENT_OUTBOUND) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}

function release() {
  active -= 1;
  waiters.shift()?.();
}

export async function withOutboundLimit<T>(operation: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 6_000): Promise<Response> {
  return withOutboundLimit(() => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }));
}

/** 8 MB is far above any legitimate response the app consumes. */
export const MAX_OUTBOUND_BYTES = 8 * 1024 * 1024;

export class OutboundTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Upstream response exceeded ${limitBytes} bytes and was discarded.`);
    this.name = "OutboundTooLargeError";
  }
}

/**
 * Reads a JSON body with a hard byte cap.
 *
 * `AbortSignal.timeout` bounds how long the *headers* take, not the body, so a
 * slow or hostile upstream could stream indefinitely, or return a body far
 * larger than memory. These responses come from third parties (Overpass, an
 * elevation service, NPS, RIDB) and one of them is reachable with a
 * user-influenced bounding box. A server that runs out of memory is the thing a
 * hiker needs at the trailhead to download a route pack.
 *
 * Streams and aborts as soon as the cap is passed rather than buffering first.
 */
export async function readJsonCapped<T>(
  response: Response,
  maxBytes = MAX_OUTBOUND_BYTES,
): Promise<T> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new OutboundTooLargeError(maxBytes);
  }

  const body = response.body;
  if (!body) return JSON.parse(await response.text()) as T;

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new OutboundTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(joined)) as T;
}

export async function withDeadline<T>(operation: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
