import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { backend, ext, ok } from './api';

export type Session = {
  config: { api_url: string; dashboard_url: string; redirect_uri: string; webhook_url: string; public_url_set: boolean; client_id: string | null; has_secret: boolean };
  connected: boolean;
  install: { scopes: string[]; installed_at?: string; refreshed_at?: string; expires_at: string } | null;
  me: { integration?: { id: number; name: string }; user?: { id: number; name: string; email: string }; scopes?: string[] } | null;
  me_error: string | null;
};

export type Workspace = { id: number; name: string; user_type?: string; phone_number?: string | null; email?: string | null; address?: string | null; url?: string | null; created_at?: string };

export type WebhookEvent = { id: string; received_at: string; type: string; verified: boolean; body: any };

type Toast = { id: number; kind: 'ok' | 'error' | 'info'; text: string };

type AppState = {
  session: Session | null;
  loadingSession: boolean;
  reloadSession: () => Promise<void>;
  workspaces: Workspace[];
  reloadWorkspaces: () => Promise<void>;
  workspaceId: number | null;
  setWorkspaceId: (id: number | null) => void;
  workspace: Workspace | null;
  events: WebhookEvent[];
  live: boolean;
  setEvents: (events: WebhookEvent[]) => void;
  onEvent: (fn: (e: WebhookEvent) => void) => () => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind']) => void;
  hasScope: (scope: string) => boolean;
};

const Ctx = createContext<AppState | null>(null);

const WS_KEY = 'external-system.workspace';
const readWs = () => {
  try {
    const v = Number(localStorage.getItem(WS_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWs] = useState<number | null>(readWs);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [live, setLive] = useState(false);
  const listeners = useRef(new Set<(e: WebhookEvent) => void>());

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const reloadSession = useCallback(async () => {
    setLoadingSession(true);
    try {
      setSession(await backend<Session>('GET', '/api/session'));
    } catch {
      setSession(null);
    } finally {
      setLoadingSession(false);
    }
  }, []);

  const reloadWorkspaces = useCallback(async () => {
    const r = await ext('GET', '/workspaces', { query: { limit: 100 } });
    if (ok(r) && Array.isArray(r.data?.data)) setWorkspaces(r.data.data);
  }, []);

  const setWorkspaceId = useCallback((id: number | null) => {
    setWs(id);
    try {
      if (id) localStorage.setItem(WS_KEY, String(id));
      else localStorage.removeItem(WS_KEY);
    } catch {
      /* private window: just not remembered */
    }
  }, []);

  useEffect(() => {
    reloadSession();
  }, [reloadSession]);

  useEffect(() => {
    if (session?.connected) reloadWorkspaces();
  }, [session?.connected, reloadWorkspaces]);

  // The first workspace when none is picked (or the picked one is gone).
  useEffect(() => {
    if (!workspaces.length) return;
    if (!workspaceId || !workspaces.some((w) => w.id === workspaceId)) setWorkspaceId(workspaces[0].id);
  }, [workspaces, workspaceId, setWorkspaceId]);

  // Callback events: what is stored, then live from the backend. A browser gives up on
  // an EventSource whose reconnect fails (the backend restarting behind the dev proxy
  // answers 502), so this reconnects itself and reloads what came in meanwhile.
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: number | undefined;
    let stopped = false;
    const seen = new Set<string>();
    let loaded = false;

    const catchUp = () =>
      backend<WebhookEvent[]>('GET', '/api/events')
        .then((list) => {
          // The first load is history; after a reconnect, what we hadn't seen is news.
          const news = loaded ? list.filter((e) => !seen.has(e.id)).reverse() : [];
          for (const e of list) seen.add(e.id);
          loaded = true;
          setEvents(list);
          news.forEach((e) => listeners.current.forEach((fn) => fn(e)));
        })
        .catch(() => {});

    const connect = () => {
      if (stopped) return;
      source = new EventSource('/api/events/stream');
      source.onopen = () => {
        setLive(true);
        catchUp();
      };
      source.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.kind !== 'webhook' || seen.has(data.event.id)) return;
          seen.add(data.event.id);
          setEvents((list) => [data.event, ...list].slice(0, 500));
          listeners.current.forEach((fn) => fn(data.event));
        } catch {
          /* not ours */
        }
      };
      source.onerror = () => {
        setLive(false);
        source?.close();
        window.clearTimeout(retry);
        retry = window.setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      source?.close();
    };
  }, []);

  const onEvent = useCallback((fn: (e: WebhookEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const value = useMemo<AppState>(() => {
    const scopes = session?.me?.scopes || session?.install?.scopes || [];
    return {
      session,
      loadingSession,
      reloadSession,
      workspaces,
      reloadWorkspaces,
      workspaceId,
      setWorkspaceId,
      workspace: workspaces.find((w) => w.id === workspaceId) || null,
      events,
      live,
      setEvents,
      onEvent,
      toasts,
      toast,
      hasScope: (scope: string) => scopes.includes(scope),
    };
  }, [session, loadingSession, reloadSession, workspaces, reloadWorkspaces, workspaceId, setWorkspaceId, events, live, onEvent, toasts, toast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useApp = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
};

// ── Hash routing: #/calls?contact=12 ──────────────────────────────────────────────────
export function useRoute() {
  const read = () => {
    const raw = window.location.hash.replace(/^#/, '') || '/connect';
    const [path, search = ''] = raw.split('?');
    return { path: path || '/connect', params: new URLSearchParams(search) };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string, params?: Record<string, string | number>) => {
  const q = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : '';
  window.location.hash = `${path}${q}`;
};
