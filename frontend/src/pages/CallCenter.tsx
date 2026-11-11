import { useEffect, useRef, useState } from 'react';
import { ok, errorText } from '../api';
import { useApp } from '../state';
import { Badge, Button, Card, Field, Input, Notice, Select, clock, when } from '../ui';
import { DataTable, Props, ScopeNote, Split, Status, Tabs, run, useAction, useApi, useContactChoices } from '../kit';

type Tab = 'recent' | 'ringing' | 'routing' | 'ai' | 'whatsapp';

export default function CallCenter() {
  const [tab, setTab] = useState<Tab>('recent');
  return (
    <>
      <ScopeNote scopes={['calls.read', 'calls.write']} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'recent', label: 'Recent calls' },
          { id: 'ringing', label: 'Ringing now' },
          { id: 'routing', label: 'Routing' },
          { id: 'ai', label: 'AI calls' },
          { id: 'whatsapp', label: 'WhatsApp call lookup' },
        ]}
      />
      {tab === 'recent' && <Recent />}
      {tab === 'ringing' && <Ringing />}
      {tab === 'routing' && <Routing />}
      {tab === 'ai' && <AiCalls />}
      {tab === 'whatsapp' && <WhatsAppLookup />}
    </>
  );
}

type CallRow = { call_id: string; device_id?: string; kind?: string; outcome?: string; started_at?: string; stages?: { stage: string; ok: boolean; detail?: string | null; at?: string }[] };

function Stages({ stages }: { stages?: CallRow['stages'] }) {
  if (!stages?.length) return <div className="muted">No stages recorded.</div>;
  return (
    <div className="timeline">
      {stages.map((s, i) => (
        <div key={i} className="timeline-item">
          <span className="muted">{clock(s.at)}</span>
          <span><Badge tone={s.ok ? 'green' : 'red'}>{s.stage}</Badge>{s.detail ? <span className="muted"> {s.detail}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}

function Recent() {
  const { workspaceId } = useApp();
  const [days, setDays] = useState('7');
  const [limit, setLimit] = useState('50');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useApi('list-calls', { query: { workspace_id: workspaceId, days: Number(days) || undefined, limit: Number(limit) || undefined } });
  const rows = list.rows as CallRow[];
  const detail = useApi('get-call', selectedId ? { path: { call_id: selectedId } } : null);
  const [lookup, setLookup] = useState('');
  const [statusId, setStatusId] = useState<string | null>(null);
  const status = useApi('get-call-status', statusId ? { path: { call_id: statusId } } : null);

  return (
    <Split
      side={
        <>
          <Card title="Call status lookup">
            <div className="row">
              <Input placeholder="call_id" value={lookup} onChange={(e) => setLookup(e.target.value)} style={{ flex: 1, width: 'auto' }} />
              <Button className="btn-sm" disabled={!lookup.trim()} busy={status.loading} onClick={() => (statusId === lookup.trim() ? status.reload() : setStatusId(lookup.trim()))}>Get status</Button>
            </div>
            {status.data && <><Status value={status.data.status} /><Props value={status.data} /></>}
          </Card>
          <Card title={selectedId ? 'Call' : 'Call details'}>
            {!selectedId ? (
              <div className="muted">Pick a call on the left.</div>
            ) : detail.data ? (
              <>
                <div className="row"><Status value={detail.data.outcome} /><Badge tone="gray">{detail.data.kind}</Badge></div>
                <Stages stages={detail.data.stages} />
                {detail.data.line_health && (
                  <Notice tone={detail.data.line_health.can_answer_calls ? 'ok' : 'warn'}>
                    {detail.data.line_health.can_answer_calls ? 'The line can answer calls.' : 'The line cannot answer calls.'}
                    {(detail.data.line_health.reasons || []).map((r: string) => <div key={r}>• {r}</div>)}
                  </Notice>
                )}
                <Props value={detail.data} omit={['stages', 'line_health']} />
              </>
            ) : (
              <div className="muted">{detail.loading ? 'Loading…' : 'Not found.'}</div>
            )}
          </Card>
        </>
      }
    >
      <Card title={`Recent calls (${rows.length})`} actions={<Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>} pad={false}>
        <div className="filters">
          <label className="check">Days <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 80, minWidth: 0 }} /></label>
          <label className="check">Limit <Input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 80, minWidth: 0 }} /></label>
        </div>
        <DataTable
          rows={rows}
          loading={list.loading}
          rowKey={(c) => c.call_id}
          selected={selectedId}
          onRow={(c) => setSelectedId(c.call_id)}
          empty="No calls in this window"
          columns={[
            { label: 'Call', render: (c) => <span className="mono">{c.call_id}</span> },
            { label: 'Kind', render: (c) => <Badge tone={c.kind === 'incoming' ? 'violet' : 'blue'}>{c.kind || '—'}</Badge> },
            { label: 'Outcome', render: (c) => <Status value={c.outcome} /> },
            { label: 'Stages', render: (c) => <div className="chips">{(c.stages || []).map((s, i) => <Badge key={i} tone={s.ok ? 'green' : 'red'}>{s.stage}</Badge>)}</div> },
            { label: 'Started', render: (c) => <span className="muted">{when(c.started_at)}</span> },
          ]}
        />
      </Card>
    </Split>
  );
}

function Ringing() {
  const { workspaceId } = useApp();
  const list = useApi('list-ringing-calls', { query: { workspace_id: workspaceId } }, { quiet: true });
  const { act, busy } = useAction();
  const [scope, setScope] = useState('all');
  useEffect(() => {
    const t = window.setInterval(list.reload, 4000);
    return () => window.clearInterval(t);
  }, [list.reload]);
  const rows = list.rows as any[];

  return (
    <Card
      title={`Ringing now (${rows.length})`}
      actions={
        <>
          <span className="muted">refreshes every 4 s</span>
          <Select value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: 150 }}>
            <option value="all">Decline for all</option>
            <option value="me">Decline for me</option>
          </Select>
        </>
      }
      pad={false}
    >
      {!list.ok && list.result && <div style={{ padding: 14 }}><Notice tone="error">{errorText(list.result)}</Notice></div>}
      <DataTable
        rows={rows}
        rowKey={(c) => c.call_id}
        empty="Nothing ringing"
        columns={[
          { label: 'From', render: (c) => <><div className="strong">{c.contact_name || c.from_name || c.from}</div><div className="muted">{c.from}</div></> },
          { label: 'Channel', render: (c) => <Badge tone="blue">{c.channel}</Badge> },
          { label: 'Since', render: (c) => <span className="muted">{clock(c.started_at)}</span> },
          { label: 'AI answers', render: (c) => (c.ai_answer_at ? <span>{c.ai_agent_name || 'AI'} at {clock(c.ai_answer_at)}</span> : <span className="muted">—</span>) },
          {
            label: '',
            render: (c) => (
              <div className="row row-end">
                <Button variant="danger" className="btn-sm" busy={busy === c.call_id} onClick={() => act('decline-ringing-call', { path: { call_id: c.call_id }, body: { scope } }, { key: c.call_id, done: 'Declined.', onDone: list.reload })}>Decline</Button>
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

function Routing() {
  const { workspaceId } = useApp();
  const get = useApi('get-call-routing', { query: { workspace_id: workspaceId } });
  const [rows, setRows] = useState<string[][]>([]);
  const { act, busy } = useAction();
  useEffect(() => {
    if (get.data?.routing) setRows(get.data.routing.map((r: string[]) => [...r]));
  }, [get.data]);
  const lines: string[] = get.data?.lines || [];
  const max: number = get.data?.max_rows || 4;

  const move = (i: number, d: number) => setRows((r) => {
    const n = [...r];
    const j = i + d;
    if (j < 0 || j >= n.length) return r;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const flip = (i: number, line: string) => setRows((r) => r.map((row, k) => (k !== i ? row : row.includes(line) ? row.filter((x) => x !== line) : [...row, line])));

  return (
    <Card
      title="Call routing"
      actions={<Button variant="ghost" className="btn-sm" busy={get.loading} onClick={get.reload}>Reload</Button>}
    >
      <div className="muted">Rows are tried top to bottom. Lines in the same row ring together. Up to {max} rows.</div>
      {rows.map((row, i) => (
        <div key={i} className="row" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
          <strong style={{ width: 28 }}>{i + 1}.</strong>
          <div className="chips" style={{ flex: 1 }}>
            {lines.map((l) => (
              <Button key={l} variant={row.includes(l) ? 'primary' : 'ghost'} className="btn-sm" onClick={() => flip(i, l)}>{l}</Button>
            ))}
          </div>
          <Button variant="ghost" className="btn-sm" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
          <Button variant="ghost" className="btn-sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</Button>
          <Button variant="danger" className="btn-sm" onClick={() => setRows((r) => r.filter((_, k) => k !== i))}>Remove</Button>
        </div>
      ))}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" className="btn-sm" disabled={rows.length >= max} onClick={() => setRows((r) => [...r, []])}>Add row</Button>
        <Button
          busy={busy === 'save'}
          onClick={() => {
            const routing = rows.filter((r) => r.length);
            act('save-call-routing', { body: { workspace_id: workspaceId, routing } }, { key: 'save', done: 'Routing saved.', onDone: get.reload });
          }}
        >
          Save routing
        </Button>
      </div>
    </Card>
  );
}

function AiCalls() {
  const { workspaceId, toast } = useApp();
  const contacts = useContactChoices(workspaceId);
  const agents = useApi('list-voice-agents', { query: { workspace_id: workspaceId } }, { quiet: true });
  const [contactId, setContactId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [channel, setChannel] = useState('');
  const preview = useApi('preview-ai-call', contactId ? { query: { workspace_id: workspaceId, contact_id: Number(contactId) } } : null, { quiet: true });
  const { act, busy } = useAction();
  const [callId, setCallId] = useState<string | null>(null);
  const [live, setLive] = useState<any>(null);
  const timer = useRef<number>();

  useEffect(() => {
    window.clearInterval(timer.current);
    if (!callId) return;
    const poll = async () => {
      const r = await run('get-ai-call', { path: { call_id: callId } });
      if (!ok(r)) return toast(errorText(r), 'error');
      setLive(r.data?.data);
      if (r.data?.data?.ended) window.clearInterval(timer.current);
    };
    poll();
    timer.current = window.setInterval(poll, 3000);
    return () => window.clearInterval(timer.current);
  }, [callId, toast]);

  const start = () =>
    act(
      'start-ai-call',
      { body: { workspace_id: workspaceId, contact_id: Number(contactId), voice_agent_id: agentId || undefined, channel: channel || undefined } },
      { key: 'start', onDone: (r) => { setLive(null); setCallId(r.data?.data?.call_id || null); } },
    );

  return (
    <Split
      side={
        <Card title="Live AI call">
          {!callId ? (
            <div className="muted">Start a call to follow it here (polled every 3 s).</div>
          ) : (
            <>
              <div className="row">
                <span className="mono">{callId}</span>
                {live && <Badge tone={live.ended ? 'gray' : live.connected ? 'green' : 'amber'}>{live.ended ? 'ended' : live.connected ? 'connected' : 'ringing'}</Badge>}
              </div>
              {live ? <Props value={live} /> : <div className="muted">Loading…</div>}
            </>
          )}
        </Card>
      }
    >
      <Card title="Place an AI call">
        <Field label="Contact">
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">—</option>
            {contacts.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        {contactId && (
          preview.data ? (
            <Notice tone={preview.data.can_call ? 'ok' : 'warn'}>
              {preview.data.can_call
                ? <>Would use <b>{preview.data.voice_agent_name || preview.data.agent_name}</b> (matched by {preview.data.matched_by}{preview.data.tag ? `: ${preview.data.tag}` : ''}).</>
                : <>Can't call automatically: {preview.data.reason || 'no voice agent matches this contact'}. Pick a voice agent below.</>}
            </Notice>
          ) : preview.result ? <Notice tone="error">{errorText(preview.result)}</Notice> : <div className="muted">Checking…</div>
        )}
        <Field label="Voice agent" hint="Empty = the one the preview picked.">
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Automatic</option>
            {(agents.rows as any[]).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.status})</option>)}
          </Select>
        </Field>
        <Field label="Channel">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">Automatic (routing)</option>
            {['whatsapp', 'imessage', 'android', 'twilio'].map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <div className="row row-end"><Button busy={busy === 'start'} disabled={!contactId} onClick={start}>Start AI call</Button></div>
      </Card>
    </Split>
  );
}

function WhatsAppLookup() {
  const [id, setId] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const res = useApi('get-whatsapp-call', query ? { path: { call_id: query } } : null);
  return (
    <Card title="WhatsApp call">
      <div className="row">
        <Input placeholder="call_id" value={id} onChange={(e) => setId(e.target.value)} style={{ flex: 1, width: 'auto' }} />
        <Button className="btn-sm" disabled={!id.trim()} busy={res.loading} onClick={() => (query === id.trim() ? res.reload() : setQuery(id.trim()))}>Look up</Button>
      </div>
      {res.data && <Props value={res.data} />}
    </Card>
  );
}
