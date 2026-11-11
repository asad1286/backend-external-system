import { Fragment, useState } from 'react';
import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ButtonHTMLAttributes } from 'react';
import type { ApiResult } from './api';

export function Card({ title, actions, children, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          <h2>{title}</h2>
          <div className="card-actions">{actions}</div>
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Button({ variant = 'primary', busy, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'success'; busy?: boolean }) {
  return (
    <button {...rest} className={`btn btn-${variant} ${rest.className || ''}`} disabled={rest.disabled || busy}>
      {busy && <span className="spinner" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`input ${p.className || ''}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`input ${p.className || ''}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`input ${p.className || ''}`} />;

const TONES: Record<string, string> = {
  ok: 'green', delivered: 'green', read: 'green', answered: 'green', ready: 'green', online: 'green', active: 'green', sent: 'blue', received: 'blue',
  ringing: 'amber', dialing: 'amber', queued: 'amber', pending: 'amber', webhook_sent: 'amber', scheduled: 'amber',
  failed: 'red', error: 'red', offline: 'red', ended: 'gray', inbound: 'violet', outbound: 'blue',
};

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const t = tone || TONES[String(children).toLowerCase()] || 'gray';
  return <span className={`badge badge-${t}`}>{children}</span>;
}

export function Method({ method }: { method: string }) {
  return <span className={`method method-${method.toLowerCase()}`}>{method}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Json({ value, max }: { value: unknown; max?: number }) {
  return (
    <pre className="json" style={max ? { maxHeight: max } : undefined}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** The raw answer of the last request, folded away. */
/** `request`: what was sent ({ method, path, body }), shown above the response. */
export function ResultBox({ result, request }: { result: ApiResult | null; request?: { method: string; path: string; body?: unknown } | null }) {
  const [open, setOpen] = useState(false);
  if (!result) return null;
  const good = result.status >= 200 && result.status < 300 && result.data?.success !== false;
  return (
    <div className={`result ${good ? 'result-ok' : 'result-err'}`}>
      <button className="result-head" onClick={() => setOpen(!open)} type="button">
        <Badge tone={good ? 'green' : 'red'}>{result.status || 'ERR'}</Badge>
        <span className="result-msg">{result.data?.message || (good ? 'OK' : 'Failed')}</span>
        <span className="muted">{result.ms} ms · {open ? 'hide' : 'show'} response</span>
      </button>
      {request && (
        <div className="result-request">
          <div className="muted">Request · <span className="mono">{request.method} /api/v1/ext{request.path}</span></div>
          <Json value={request.body ?? null} max={260} />
        </div>
      )}
      {open && <Json value={result.data} max={360} />}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

export function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export const when = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
};

export const clock = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
};

// The docs' little Markdown: **bold**, `code`, [links](url).
const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
export const inline = (text: string) =>
  text.split(TOKEN).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) return <Fragment key={i}>{link[1]}</Fragment>;
    return <Fragment key={i}>{part}</Fragment>;
  });

export function Prose({ text }: { text: string }) {
  return (
    <div className="prose">
      {text.split(/\n\n+/).map((p, i) => (
        <p key={i}>{inline(p)}</p>
      ))}
    </div>
  );
}
