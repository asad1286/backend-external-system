// Everything goes to our own backend (../backend). It adds the token and calls myCRMSIM.

export type ApiResult<T = any> = { status: number; data: T; ms: number };

type Options = { query?: Record<string, unknown>; body?: unknown };

/** Any myCRMSIM app API path (/api/v1/ext/… or /api/v1/integration/…). */
export async function call<T = any>(method: string, path: string, opts: Options = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, path, query: opts.query, body: opts.body }),
    });
    const json = await res.json().catch(() => null);
    if (json && typeof json.status === 'number') return json as ApiResult<T>;
    return { status: res.status, data: (json ?? { success: false, message: `Backend answered ${res.status}` }) as T, ms: 0 };
  } catch {
    return { status: 0, data: { success: false, message: 'The backend is not reachable. Is it running on port 4000?' } as T, ms: 0 };
  }
}

/** A path under /api/v1/ext. */
export const ext = <T = any>(method: string, path: string, opts?: Options) => call<T>(method, `/api/v1/ext${path}`, opts);

export const ok = (r: ApiResult) => r.status >= 200 && r.status < 300 && r.data?.success !== false;

export const errorText = (r: ApiResult) => r.data?.message || r.data?.error || (r.status ? `HTTP ${r.status}` : 'No answer');

export async function backend<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
  return json as T;
}
