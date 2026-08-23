import { isNative } from "@/lib/platform/native";

/**
 * One fetch wrapper for every `/api/*` call, on both targets.
 *
 * Web: a relative same-origin fetch carrying the `hike_owner` cookie — byte-identical
 * to what every call site did before this wrapper existed.
 *
 * Native shell: the WKWebView runs on `capacitor://localhost`, a different origin from
 * the API, so the cookie is never sent and the proxy never mints one (it mints only on
 * document navigations, which a native client never performs). The shell therefore
 * carries an `Authorization: Bearer` token minted from `POST /api/session`, prefixed
 * onto an absolute `NEXT_PUBLIC_API_BASE`. A 401 re-mints exactly once — the case is a
 * rotated server secret, and the retry either recovers or surfaces the original 401;
 * it must never loop.
 */

export interface TokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
}

/** Inlined at build time; empty on the web build, absolute HTTPS in the shell build. */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

let tokenStore: TokenStore | null = null;
let cachedToken: string | null | undefined;

/**
 * The native bootstrap wires this to Capacitor Preferences at startup. Until it is
 * registered (and always on web) the token lives only in memory, which is correct for
 * tests and harmless on web where the cookie does the work.
 */
export function setTokenStore(store: TokenStore | null): void {
  tokenStore = store;
  cachedToken = undefined;
}

async function readStoredToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = tokenStore ? await tokenStore.read() : null;
  return cachedToken;
}

async function storeToken(token: string): Promise<void> {
  cachedToken = token;
  if (tokenStore) await tokenStore.write(token);
}

let mintInFlight: Promise<string | null> | null = null;

/**
 * Single-flight: concurrent callers share one mint.
 *
 * On a cold install several screens fire API calls at once; if each minted its own
 * session, a credential-less `POST /api/session` returns a DIFFERENT owner per call,
 * those requests would then write into different owner scopes, and whichever token won
 * the final store write would silently orphan the rows the others created. One
 * in-flight mint means one owner, whatever the caller concurrency.
 */
export async function mintSession(): Promise<string | null> {
  if (!mintInFlight) {
    mintInFlight = mintSessionOnce().finally(() => {
      mintInFlight = null;
    });
  }
  return mintInFlight;
}

async function mintSessionOnce(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/api/session`, { method: "POST" });
    if (!response.ok) return null;
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== "string" || !body.token) return null;
    await storeToken(body.token);
    return body.token;
  } catch {
    // Offline at launch is an ordinary state for this app; the caller sees the same
    // unauthenticated failure it would see from a plain fetch.
    return null;
  }
}

function withAuthHeader(init: RequestInit, token: string | null): RequestInit {
  if (!token) return init;
  return { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } };
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!isNative()) {
    return fetch(path, { credentials: "same-origin", ...init });
  }
  let token = await readStoredToken();
  if (!token) token = await mintSession();
  let response = await fetch(`${API_BASE}${path}`, withAuthHeader(init, token));
  if (response.status === 401) {
    const fresh = await mintSession();
    if (fresh && fresh !== token) {
      response = await fetch(`${API_BASE}${path}`, withAuthHeader(init, fresh));
    }
  }
  return response;
}
