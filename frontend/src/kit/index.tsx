// Building blocks for the section pages. Every request goes through an endpoint from the
// docs (data/endpoints.json, by slug), so a page names what it calls and the forms are
// built from the documented parameters: names, types, enums, required flags, hints.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { call, ok, errorText } from '../api';
import type { ApiResult } from '../api';
import { useApp } from '../state';
import endpoints from '../data/endpoints.json';
import { Badge, Button, Field, Input, Json, ResultBox, Select, Textarea, when } from '../ui';

export type Param = { name: string; type: string; location: 'path' | 'query' | 'header' | 'body'; required?: boolean; description: string; example?: unknown; enum?: string[] };
export type Endpoint = { slug: string; title: string; method: string; path: string; summary: string; scope: string | null; params: Param[]; requestBody: unknown };

const ALL = (endpoints as unknown as { categories: { endpoints: Endpoint[] }[] }).categories.flatMap((c) => c.endpoints);
const BY_SLUG = new Map(ALL.map((e) => [e.slug, e]));

export function endpoint(slug: string): Endpoint {
  const e = BY_SLUG.get(slug);
  if (!e) throw new Error(`No endpoint "${slug}" in the docs data — run npm run sync-endpoints.`);
  return e;
}

export type Req = { path?: Record<string, string | number>; query?: Record<string, unknown>; body?: unknown };

/** Call a documented endpoint by slug. Path placeholders come from req.path. */
export function run<T = any>(slug: string, req: Req = {}): Promise<ApiResult<T>> {
  const e = endpoint(slug);
  let path = e.path.split('?')[0];
  for (const [k, v] of Object.entries(req.path || {})) path = path.replace(`{${k}}`, encodeURIComponent(String(v)));
  const query = req.query ? Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== undefined && v !== null && v !== '')) : undefined;
  return call<T>(e.method, path, { query, body: req.body });
}

/** The list inside an answer: data itself, or the first array under data. */
export function rowsOf(data: any, key?: string): any[] {
  const d = data?.data;
  if (key) return Array.isArray(d?.[key]) ? d[key] : [];
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') for (const v of Object.values(d)) if (Array.isArray(v)) return v;
  return [];
}

/** GET an endpoint whenever `req` changes; null skips. */
export function useApi(slug: string, req: Req | null, opts: { quiet?: boolean } = {}) {
  const { toast } = useApp();
  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const key = req ? JSON.stringify(req) : null;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (key === null) return setResult(null);
    const n = ++seq.current;
    setLoading(true);
    const r = await run(slug, JSON.parse(key));
    if (n !== seq.current) return;
    setLoading(false);
    setResult(r);
    if (!ok(r) && !opts.quiet) toast(`${endpoint(slug).title}: ${errorText(r)}`, 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, key]);
  useEffect(() => {
    reload();
  }, [reload]);
  const good = result ? ok(result) : false;
  return { result, loading, reload, ok: good, data: good ? result!.data?.data : undefined, raw: result?.data, rows: good ? rowsOf(result!.data) : [] };
}

/** A button that calls an endpoint, with an optional confirm, a toast and a callback. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const act = useCallback(
    async (slug: string, req: Req, o: { confirm?: string; done?: string; key?: string; onDone?: (r: ApiResult) => void } = {}) => {
      if (o.confirm && !window.confirm(o.confirm)) return null;
      setBusy(o.key || slug);
      const r = await run(slug, req);
      setBusy(null);
      setResult(r);
      if (!ok(r)) {
        toast(errorText(r), 'error');
        return r;
      }
      toast(o.done || r.data?.message || `${endpoint(slug).title}: done`, 'ok');
      o.onDone?.(r);
      return r;
    },
    [toast],
  );
  return { act, busy, result, setResult };
}

// ── Forms built from the documented parameters ──────────────────────────────────────────

type Kind = 'enum' | 'bool' | 'number' | 'list' | 'numlist' | 'text' | 'date' | 'json' | 'string';
const kindOf = (p: Param): Kind => {
  const t = p.type.toLowerCase();
  if (p.enum?.length) return 'enum';
  if (t === 'boolean') return 'bool';
  if (t === 'number' || t === 'integer') return 'number';
  if (t === 'array<string>') return 'list';
  if (t === 'array<number>') return 'numlist';
  if (t.includes('iso 8601')) return 'date';
  if (t.includes('(text)')) return 'text';
  if (t.startsWith('object') || t.startsWith('array') || t.includes('|')) return 'json';
  return 'string';
};

const toLocalInput = (v: unknown) => {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};

/** A record's value as the form's string. */
const toField = (k: Kind, v: unknown): string => {
  if (v === undefined || v === null) return '';
  if (k === 'bool') return v ? 'true' : 'false';
  if (k === 'list' || k === 'numlist') return Array.isArray(v) ? v.join(', ') : String(v);
  if (k === 'date') return toLocalInput(v);
  if (k === 'json') return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return String(v);
};

/** The form's string as the value to send; undefined = leave out; throws on bad JSON. */
const fromField = (p: Param, k: Kind, s: string): unknown => {
  const v = s.trim();
  if (v === '') return undefined;
  switch (k) {
    case 'bool':
      return v === 'true';
    case 'number':
      return Number(v);
    case 'list':
      return v.split(',').map((x) => x.trim()).filter(Boolean);
    case 'numlist':
      return v.split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
    case 'date':
      return new Date(v).toISOString();
    case 'json':
      if (!/^[[{]/.test(v) && p.type.includes('string')) return v;
      try {
        return JSON.parse(v);
      } catch {
        throw new Error(`${p.name} is not valid JSON.`);
      }
    default:
      return v;
  }
};

export type Choice = { value: string | number; label: string };

type FormProps = {
  slug: string;
  /** Path placeholders. */
  path?: Record<string, string | number>;
  /** Sent as is and not shown (workspace_id, usually). */
  fixed?: Record<string, unknown>;
  /** Starting values: a record being edited, or sensible defaults. */
  initial?: Record<string, unknown>;
  /** Show only these fields, in this order. */
  only?: string[];
  hide?: string[];
  /** A select instead of a free field. */
  choices?: Record<string, Choice[]>;
  labels?: Record<string, string>;
  /** PATCH-style: send only the fields that were changed. */
  changesOnly?: boolean;
  submit?: string;
  confirm?: string;
  onDone?: (r: ApiResult) => void;
  /** Turn the collected values into the request (rename, nest…). */
  shape?: (values: Record<string, unknown>) => Req;
};

/** A form for one endpoint: fields from its body (or query, for a GET) parameters. */
export function EndpointForm(props: FormProps) {
  const { slug, path, fixed = {}, initial = {}, only, hide = [], choices = {}, labels = {}, changesOnly, submit, confirm, onDone, shape } = props;
  const e = endpoint(slug);
  const { toast } = useApp();
  const where = e.method === 'GET' ? 'query' : 'body';
  const params = useMemo(() => {
    const list = e.params.filter((p) => p.location === where && !(p.name in fixed) && !hide.includes(p.name));
    if (!only) return list;
    return only.map((n) => list.find((p) => p.name === n)).filter(Boolean) as Param[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, JSON.stringify(Object.keys(fixed)), only?.join(), hide.join()]);

  const start = useCallback(() => Object.fromEntries(params.map((p) => [p.name, toField(kindOf(p), initial[p.name])])), [params, initial]);
  const [values, setValues] = useState<Record<string, string>>(start);
  const [base, setBase] = useState<Record<string, string>>(start);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const initialKey = JSON.stringify(initial);
  useEffect(() => {
    const s = start();
    setValues(s);
    setBase(s);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey, slug]);

  const send = async () => {
    const out: Record<string, unknown> = {};
    try {
      for (const p of params) {
        if (changesOnly && values[p.name] === base[p.name]) continue;
        const v = fromField(p, kindOf(p), values[p.name] ?? '');
        if (v === undefined) {
          if (p.required && !changesOnly) throw new Error(`${labels[p.name] || p.name} is required.`);
          if (changesOnly && base[p.name] !== '') out[p.name] = null; // cleared
          continue;
        }
        out[p.name] = v;
      }
    } catch (err) {
      return toast((err as Error).message, 'error');
    }
    if (changesOnly && !Object.keys(out).length) return toast('Nothing changed.', 'info');
    if (confirm && !window.confirm(confirm)) return;
    const all = { ...fixed, ...out };
    const req: Req = shape ? shape(all) : where === 'query' ? { path, query: all } : { path, body: all };
    if (!req.path && path) req.path = path;
    setBusy(true);
    const r = await run(slug, req);
    setBusy(false);
    setResult(r);
    if (!ok(r)) return toast(errorText(r), 'error');
    toast(r.data?.message || `${e.title}: done`, 'ok');
    setBase(values);
    onDone?.(r);
  };

  const input = (p: Param) => {
    const k = kindOf(p);
    const v = values[p.name] ?? '';
    const set = (s: string) => setValues((m) => ({ ...m, [p.name]: s }));
    const ex = p.example === undefined ? '' : typeof p.example === 'string' ? p.example : JSON.stringify(p.example);
    if (choices[p.name])
      return (
        <Select value={v} onChange={(ev) => set(ev.target.value)}>
          <option value="">—</option>
          {choices[p.name].map((c) => <option key={c.value} value={String(c.value)}>{c.label}</option>)}
        </Select>
      );
    switch (k) {
      case 'enum':
        return (
          <Select value={v} onChange={(ev) => set(ev.target.value)}>
            <option value="">—</option>
            {p.enum!.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        );
      case 'bool':
        return (
          <Select value={v} onChange={(ev) => set(ev.target.value)}>
            <option value="">—</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        );
      case 'number':
        return <Input type="number" value={v} placeholder={ex} onChange={(ev) => set(ev.target.value)} />;
      case 'date':
        return <Input type="datetime-local" value={v} onChange={(ev) => set(ev.target.value)} />;
      case 'text':
        return <Textarea rows={3} value={v} placeholder={ex} onChange={(ev) => set(ev.target.value)} />;
      case 'json':
        return <Textarea className="mono" rows={Math.min(12, Math.max(3, v.split('\n').length))} value={v} placeholder={ex} onChange={(ev) => set(ev.target.value)} />;
      default:
        return <Input value={v} placeholder={k === 'list' || k === 'numlist' ? `${ex || 'a, b'} (comma separated)` : ex} onChange={(ev) => set(ev.target.value)} />;
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {params.length === 0 && <div className="muted">No fields to fill.</div>}
      {params.map((p) => (
        <Field key={p.name} label={`${labels[p.name] || p.name}${p.required && !changesOnly ? ' *' : ''}`} hint={<HintText text={p.description} />}>
          {input(p)}
        </Field>
      ))}
      <div className="row row-end">
        <Button busy={busy} onClick={send}>{submit || e.title}</Button>
      </div>
      <ResultBox result={result} />
    </div>
  );
}

// The docs' hints can be long: first sentence, the rest on click.
function HintText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const clean = text.replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const first = clean.match(/^.{0,160}?[.!?](\s|$)/)?.[0] || clean.slice(0, 160);
  if (open || first.length >= clean.length) return <>{clean}</>;
  return (
    <>
      {first.trim()}{' '}
      <button type="button" className="linkish" onClick={() => setOpen(true)}>more</button>
    </>
  );
}

// ── Display ─────────────────────────────────────────────────────────────────────────────

export type Column<T> = { label: string; render: (row: T) => ReactNode; width?: number | string };

export function DataTable<T>({ rows, columns, rowKey, onRow, selected, empty = 'Nothing here yet', loading }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string | number; onRow?: (r: T) => void; selected?: string | number | null; empty?: ReactNode; loading?: boolean }) {
  if (!rows.length) return <div className="empty"><strong>{loading ? 'Loading…' : empty}</strong></div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.label} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} className={`${onRow ? 'clickable' : ''} ${selected !== undefined && selected !== null && String(selected) === String(k) ? 'selected' : ''}`} onClick={onRow ? () => onRow(r) : undefined}>
                {columns.map((c) => <td key={c.label}>{c.render(r)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const isDateKey = (k: string) => /(_at|_date)$/.test(k) || k === 'date';

/** A record as label/value rows; nested objects fold into JSON. */
export function Props({ value, omit = [], order }: { value: Record<string, any> | null | undefined; omit?: string[]; order?: string[] }) {
  if (!value || typeof value !== 'object') return <div className="muted">—</div>;
  const keys = Object.keys(value).filter((k) => !omit.includes(k));
  if (order) keys.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  return (
    <dl className="kv">
      {keys.map((k) => {
        const v = value[k];
        let shown: ReactNode;
        if (v === null || v === undefined || v === '') shown = <span className="muted">—</span>;
        else if (typeof v === 'boolean') shown = <Badge tone={v ? 'green' : 'gray'}>{v ? 'yes' : 'no'}</Badge>;
        else if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) shown = v.length ? <div className="chips">{v.map((x, i) => <Badge key={i} tone="gray">{String(x)}</Badge>)}</div> : <span className="muted">none</span>;
        else if (typeof v === 'object') shown = <Folded value={v} />;
        else if (isDateKey(k)) shown = when(String(v));
        else if (/^https?:\/\//.test(String(v))) shown = <a href={String(v)} target="_blank" rel="noreferrer" className="break">{String(v)}</a>;
        else shown = <span className="break">{String(v)}</span>;
        return (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k.replace(/_/g, ' ')}</dt>
            <dd>{shown}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function Folded({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const size = Array.isArray(value) ? `${value.length} item${value.length === 1 ? '' : 's'}` : `${Object.keys(value as object).length} field${Object.keys(value as object).length === 1 ? '' : 's'}`;
  return open ? (
    <div style={{ width: '100%' }}>
      <button type="button" className="linkish" onClick={() => setOpen(false)}>hide</button>
      <Json value={value} max={300} />
    </div>
  ) : (
    <button type="button" className="linkish" onClick={() => setOpen(true)}>{size} — show</button>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} type="button" className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Pager({ page, pages, onPage, total }: { page: number; pages?: number | null; onPage: (p: number) => void; total?: number | null }) {
  return (
    <div className="row" style={{ padding: 12, justifyContent: 'space-between' }}>
      <span className="muted">Page {page}{pages ? ` of ${pages}` : ''}{total != null ? ` · ${total} total` : ''}</span>
      <div className="row">
        <Button variant="ghost" className="btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="ghost" className="btn-sm" disabled={pages ? page >= pages : false} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/** List on the left, a panel on the right. */
export function Split({ children, side, wide }: { children: ReactNode; side: ReactNode; wide?: boolean }) {
  return (
    <div className="split" style={wide ? { gridTemplateColumns: 'minmax(0, 1fr) minmax(380px, 1fr)' } : undefined}>
      <div className="split-main">{children}</div>
      <div className="split-side">{side}</div>
    </div>
  );
}

export const statusTone = (s?: string | null) => {
  const v = String(s || '').toLowerCase();
  if (/^(active|published|open|won|completed|done|ready|connected|confirmed|booked|scheduled|answered|sent|delivered|success|ok)$/.test(v)) return 'green';
  if (/^(draft|pending|paused|queued|running|in_progress|ringing|dialing|preview|previewed|invited|todo|open_task)$/.test(v)) return 'amber';
  if (/^(failed|lost|cancelled|canceled|no_show|error|inactive|disabled|suspended|stopped|declined)$/.test(v)) return 'red';
  return 'gray';
};

export const Status = ({ value }: { value?: string | null }) => (value ? <Badge tone={statusTone(value)}>{value}</Badge> : <span className="muted">—</span>);

export const personName = (c?: { first_name?: string | null; last_name?: string | null; email?: string | null; phone_number?: string | null; id?: number } | null) =>
  c ? [c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone_number || c.email || `#${c.id}` : '—';

export const money = (v?: number | string | null, currency?: string | null) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n} ${currency || ''}`;
  }
};

/** Scope missing → a one-line notice instead of a failing page. */
export function ScopeNote({ scopes }: { scopes: string[] }) {
  const { hasScope } = useApp();
  const missing = scopes.filter((s) => !hasScope(s));
  if (!missing.length) return null;
  return (
    <div className="notice notice-warn">
      This app was not granted {missing.map((s, i) => <span key={s}>{i ? ', ' : ''}<code>{s}</code></span>)}. Requests that need it answer 403 — add the scope to the app and reconnect.
    </div>
  );
}

/** The workspace's contacts as select choices (first 200). */
export function useContactChoices(workspaceId: number | null): Choice[] {
  const [list, setList] = useState<Choice[]>([]);
  useEffect(() => {
    if (!workspaceId) return setList([]);
    let live = true;
    run('list-contacts', { query: { workspace_id: workspaceId, limit: 200 } }).then((r) => {
      if (live) setList(ok(r) ? rowsOf(r.data).map((c: any) => ({ value: c.id, label: `${personName(c)} (#${c.id})` })) : []);
    });
    return () => {
      live = false;
    };
  }, [workspaceId]);
  return list;
}
