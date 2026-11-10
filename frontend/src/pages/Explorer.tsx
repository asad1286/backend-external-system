import { useEffect, useMemo, useState } from 'react';
import { call, ok } from '../api';
import type { ApiResult } from '../api';
import { useApp } from '../state';
import endpoints from '../data/endpoints.json';
import { Badge, Button, Card, Field, Input, Json, Method, Notice, Prose, Textarea } from '../ui';

type Param = { name: string; type: string; location: 'path' | 'query' | 'header' | 'body'; required?: boolean; description: string; example?: unknown; enum?: string[] };
type Endpoint = { slug: string; title: string; method: string; path: string; summary: string; description: string; scope: string | null; authMode: string; params: Param[]; requestBody: unknown; example: { status: number; body: unknown } | null };
type Category = { slug: string; label: string; group: string; endpoints: Endpoint[] };

const CATEGORIES = (endpoints as { categories: Category[] }).categories;
const usable = (e: Endpoint) => e.authMode === 'bearer' && /^\/api\/v1\/(ext|integration)\//.test(e.path);

/** The example body, with this system's workspace in place of the docs' sample id. */
const exampleBody = (e: Endpoint, workspaceId: number | null) => {
  if (!e.requestBody) return '';
  const body = JSON.parse(JSON.stringify(e.requestBody));
  if (workspaceId && body && typeof body === 'object' && 'workspace_id' in body) body.workspace_id = workspaceId;
  return JSON.stringify(body, null, 2);
};

export default function Explorer({ params }: { params: URLSearchParams }) {
  const { workspaceId, hasScope } = useApp();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(params.get('e') || 'list-workspaces');
  const ep = useMemo(() => CATEGORIES.flatMap((c) => c.endpoints).find((e) => e.slug === selected) || CATEGORIES[2].endpoints[0], [selected]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [result, setResult] = useState<ApiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'response' | 'example'>('response');

  useEffect(() => {
    const v: Record<string, string> = {};
    for (const p of ep.params) {
      if (p.location === 'body' || p.location === 'header') continue;
      if (p.name === 'workspace_id' && workspaceId) v[p.name] = String(workspaceId);
      else v[p.name] = '';
    }
    setValues(v);
    setBody(exampleBody(ep, workspaceId));
    setResult(null);
    setView('response');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CATEGORIES.map((c) => ({
      ...c,
      endpoints: c.endpoints.filter((e) => !q || `${e.title} ${e.path} ${e.method} ${c.label}`.toLowerCase().includes(q)),
    })).filter((c) => c.endpoints.length);
  }, [search]);

  const pathParams = ep.params.filter((p) => p.location === 'path');
  const queryParams = ep.params.filter((p) => p.location === 'query');
  const bodyParams = ep.params.filter((p) => p.location === 'body');
  const sendsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(ep.method) && (bodyParams.length > 0 || Boolean(ep.requestBody));

  const send = async () => {
    let path = ep.path.split('?')[0];
    for (const p of pathParams) {
      const v = values[p.name]?.trim();
      if (!v) return setResult({ status: 0, ms: 0, data: { success: false, message: `Fill in {${p.name}}.` } });
      path = path.replace(`{${p.name}}`, encodeURIComponent(v));
    }
    const query: Record<string, string> = {};
    for (const p of queryParams) if (values[p.name]?.trim()) query[p.name] = values[p.name].trim();
    let parsed: unknown;
    if (sendsBody && body.trim()) {
      try {
        parsed = JSON.parse(body);
      } catch {
        return setResult({ status: 0, ms: 0, data: { success: false, message: 'The body is not valid JSON.' } });
      }
    }
    setBusy(true);
    setResult(await call(ep.method, path, { query, body: parsed }));
    setBusy(false);
    setView('response');
  };

  const field = (p: Param) => (
    <div key={`${p.location}-${p.name}`} className="param-row">
      <div className="param-name">
        {p.name}
        {p.required && <span className="req">*</span>}
        <div className="muted" style={{ fontFamily: 'inherit' }}>{p.type}</div>
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {p.enum ? (
          <select className="input" value={values[p.name] || ''} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}>
            <option value="">—</option>
            {p.enum.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <Input value={values[p.name] || ''} placeholder={p.example !== undefined ? String(p.example) : ''} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} />
        )}
        <span className="muted">{p.description}</span>
      </div>
    </div>
  );

  return (
    <div className="explorer">
      <Card pad={false}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
          <Input placeholder={`Search ${CATEGORIES.reduce((n, c) => n + c.endpoints.length, 0)} endpoints…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="ep-list">
          {filtered.map((c) => (
            <div key={c.slug}>
              <div className="ep-group">{c.label}</div>
              {c.endpoints.map((e) => (
                <button key={e.slug} className={`ep-item ${e.slug === ep.slug ? 'active' : ''}`} onClick={() => setSelected(e.slug)}>
                  <Method method={e.method} />
                  <span>{e.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
        <Card
          title={ep.title}
          actions={ep.scope ? <Badge tone={hasScope(ep.scope) ? 'green' : 'red'}>{ep.scope}{hasScope(ep.scope) ? '' : ' (not granted)'}</Badge> : null}
        >
          <div className="row"><Method method={ep.method} /><span className="path">{ep.path}</span></div>
          <div className="muted">{ep.summary}</div>
          {ep.description && <Prose text={ep.description} />}
          {!usable(ep) && <Notice tone="info">This one is part of the OAuth flow, which this system's backend runs for you (Connection page).</Notice>}
        </Card>

        {usable(ep) && (
          <Card title="Try it" actions={<Button busy={busy} onClick={send}>Send request</Button>}>
            {pathParams.length > 0 && <><strong style={{ fontSize: 13 }}>Path</strong>{pathParams.map(field)}</>}
            {queryParams.length > 0 && <><strong style={{ fontSize: 13 }}>Query</strong>{queryParams.map(field)}</>}
            {sendsBody && (
              <Field label="Body (JSON)" hint={bodyParams.length ? `Fields: ${bodyParams.map((p) => p.name + (p.required ? '*' : '')).join(', ')}` : undefined}>
                <Textarea className="mono" style={{ minHeight: 200 }} value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>
            )}
            {!pathParams.length && !queryParams.length && !sendsBody && <div className="muted">No parameters.</div>}
          </Card>
        )}

        <Card
          title={
            <span className="tabs" style={{ border: 0 }}>
              <button className={`tab ${view === 'response' ? 'active' : ''}`} onClick={() => setView('response')}>Response</button>
              <button className={`tab ${view === 'example' ? 'active' : ''}`} onClick={() => setView('example')}>Example from the docs</button>
            </span>
          }
          actions={result && view === 'response' ? <><Badge tone={ok(result) ? 'green' : 'red'}>{result.status || 'ERR'}</Badge><span className="muted">{result.ms} ms</span></> : null}
        >
          {view === 'response' ? (result ? <Json value={result.data} max={520} /> : <div className="muted">Send the request to see the answer.</div>) : ep.example ? <Json value={ep.example.body} max={520} /> : <div className="muted">No example.</div>}
        </Card>
      </div>
    </div>
  );
}
