/**
 * Typed fetch wrapper for the FastAPI backend with refresh-token rotation.
 *
 * Access + refresh tokens live in localStorage (fine for a dev tool; move to
 * httpOnly cookies behind a BFF route for hardened deployments). On a 401 the
 * client tries ONE refresh, replays the request, and only then redirects to
 * /login.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

const TOKEN_KEY = 'cms_token';
const REFRESH_KEY = 'cms_refresh_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) window.localStorage.removeItem(TOKEN_KEY);
  else window.localStorage.setItem(TOKEN_KEY, token);
}

export function setTokens(access: string | null, refresh: string | null): void {
  setToken(access);
  if (refresh === null) window.localStorage.removeItem(REFRESH_KEY);
  else window.localStorage.setItem(REFRESH_KEY, refresh);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  // Single-flight: concurrent 401s share one refresh round-trip.
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refresh = getRefreshToken();
      if (!refresh) return false;
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        if (!res.ok) return false;
        const pair = (await res.json()) as { access_token: string; refresh_token: string };
        setTokens(pair.access_token, pair.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshPromise = null), 0);
      }
    })();
  }
  return refreshPromise;
}

export async function api<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
    if (!retried && (await tryRefresh())) {
      return api<T>(path, options, true);
    }
    setTokens(null, null);
    window.location.href = '/login';
  }
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  account_id: string;
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const pair = await api<TokenPair>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setTokens(pair.access_token, pair.refresh_token);
  return pair;
}

export async function switchAccount(accountId: string): Promise<void> {
  const pair = await api<TokenPair>('/auth/switch-account', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId }),
  });
  setTokens(pair.access_token, pair.refresh_token);
}
