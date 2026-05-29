/**
 * Lightweight typed API client.
 *
 * All requests go through the Next.js `/api` proxy (see next.config.mjs).
 * This means the browser only ever talks to the web origin — no CORS, no
 * cross-origin cookie issues, no need to expose the API port publicly in
 * Codespaces/hosted previews. Server-side, Next forwards to the API at the
 * private URL set in API_INTERNAL_URL.
 *
 * `NEXT_PUBLIC_API_URL` is honoured if set, for cases where you want the
 * browser to call the API directly (e.g. a mobile client reusing this file).
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(t: { accessToken: string; refreshToken: string }) {
  accessToken  = t.accessToken;
  refreshToken = t.refreshToken;
  if (typeof window !== 'undefined') {
    // Refresh token stays sessionStorage-only; never localStorage.
    sessionStorage.setItem('rt', t.refreshToken);
  }
}

export function clearTokens() {
  accessToken = null; refreshToken = null;
  if (typeof window !== 'undefined') sessionStorage.removeItem('rt');
}

export function loadTokensFromStorage() {
  if (typeof window === 'undefined') return;
  refreshToken = sessionStorage.getItem('rt');
}

export async function api<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.auth !== false && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401 && refreshToken && init.auth !== false) {
    const r = await fetch(`${BASE}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (r.ok) {
      setTokens(await r.json());
      return api<T>(path, init);
    }
    clearTokens();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** Cryptographic idempotency key for money-moving requests. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
