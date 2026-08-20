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
