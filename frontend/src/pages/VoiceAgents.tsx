import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { Badge, Button, Card, Field, Input, Notice, Select, when } from '../ui';
import { DataTable, EndpointForm, Pager, Props, ScopeNote, Split, Status, Tabs, useAction, useApi, useContactChoices } from '../kit';

type Agent = { id: string; name: string; agent_id?: string; agent_name?: string; status: string; answers_inbound?: boolean; settings?: Record<string, any>; updated_at?: string };
type Tab = 'agents' | 'inbound' | 'catalog' | 'calls';

export default function VoiceAgents() {
  const [tab, setTab] = useState<Tab>('agents');
  return (
    <>
      <ScopeNote scopes={['voice_agents.read', 'voice_agents.write']} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'agents', label: 'Agents' }, { id: 'inbound', label: 'Inbound' }, { id: 'catalog', label: 'Catalog' }, { id: 'calls', label: 'Call log' }]} />
      {tab === 'agents' && <Agents />}
      {tab === 'inbound' && <Inbound />}
      {tab === 'catalog' && <Catalog />}
      {tab === 'calls' && <CallLog />}
    </>
  );
}

function Agents() {
  const { workspaceId } = useApp();
  const list = useApi('list-voice-agents', { query: { workspace_id: workspaceId } });
  const rows = list.rows as Agent[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [side, setSide] = useState<'details' | 'edit'>('details');
  // The list row shows at once; the full record (get-voice-agent) replaces it when it arrives.
  const detail = useApi('get-voice-agent', selectedId ? { path: { id: selectedId }, query: { workspace_id: workspaceId } } : null, { quiet: true });
  useEffect(() => {
    if (selectedId) detail.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.result]);
  const listed = rows.find((a) => a.id === selectedId) || null;
  const selected = listed && detail.data?.id === listed.id ? { ...listed, ...detail.data } : listed;
  const { act, busy } = useAction();

  return (
    <Split
      side={
        selected ? (
          <Card title={selected.name} actions={<Button variant="ghost" className="btn-sm" onClick={() => setSelectedId(null)}>New agent</Button>}>
            <div className="row"><Status value={selected.status} />{selected.answers_inbound ? <Badge tone="violet">answers inbound</Badge> : null}</div>
            <Tabs value={side} onChange={setSide} tabs={[{ id: 'details', label: 'Details' }, { id: 'edit', label: 'Edit' }]} />
            {side === 'details' && <Props value={selected} omit={['workspace_id']} />}
            {side === 'edit' && (
              <EndpointForm key={selected.id} slug="update-voice-agent" path={{ id: selected.id }} fixed={{ workspace_id: workspaceId }} initial={selected} changesOnly submit="Save changes" onDone={list.reload} />
            )}
            <div className="row row-end">
              <Button
                variant="danger"
                className="btn-sm"
                busy={busy === 'del'}
                onClick={() => act('delete-voice-agent', { path: { id: selected.id }, query: { workspace_id: workspaceId } }, { key: 'del', confirm: `Delete “${selected.name}”?`, done: 'Voice agent deleted.', onDone: () => { setSelectedId(null); list.reload(); } })}
              >
                Delete agent
              </Button>
            </div>
          </Card>
        ) : (
          <Card title="New voice agent">
            <div className="muted">settings is JSON — see the Catalog tab for providers, models and voices.</div>
            <EndpointForm slug="create-voice-agent" fixed={{ workspace_id: workspaceId }} submit="Create voice agent" onDone={(r) => { list.reload(); if (r.data?.data?.id) setSelectedId(r.data.data.id); }} />
          </Card>
        )
      }
    >
      <Card title={`Voice agents (${rows.length})`} actions={<Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>} pad={false}>
        <DataTable
          rows={rows}
          loading={list.loading}
          rowKey={(a) => a.id}
          selected={selectedId}
          onRow={(a) => { setSelectedId(a.id); setSide('details'); }}
          empty="No voice agents"
          columns={[
            { label: 'Name', render: (a) => <><div className="strong">{a.name}</div><div className="muted">{a.id}</div></> },
            { label: 'AI agent', render: (a) => a.agent_name || <span className="muted">—</span> },
            { label: 'Mode', render: (a) => <Badge tone="gray">{a.settings?.mode || '—'}</Badge> },
            { label: 'Status', render: (a) => <Status value={a.status} /> },
            { label: 'Inbound', render: (a) => (a.answers_inbound ? <Badge tone="violet">yes</Badge> : <span className="muted">no</span>) },
            { label: 'Updated', render: (a) => <span className="muted">{when(a.updated_at)}</span> },
          ]}
        />
      </Card>
    </Split>
  );
}

function Inbound() {
  const { workspaceId } = useApp();
  const get = useApi('get-inbound-voice-agent', { query: { workspace_id: workspaceId } });
  const [choice, setChoice] = useState('');
  const { act, busy } = useAction();
  useEffect(() => setChoice(get.data?.inbound_voice_agent_id || ''), [get.data]);
  const agents: { id: string; name: string; status: string; agent_name?: string }[] = get.data?.voice_agents || [];
  const current = agents.find((a) => a.id === get.data?.inbound_voice_agent_id);

  return (
    <Card title="Inbound voice agent" actions={<Button variant="ghost" className="btn-sm" busy={get.loading} onClick={get.reload}>Reload</Button>}>
      <Notice tone={current ? 'ok' : 'info'}>{current ? <>Incoming calls are answered by <b>{current.name}</b>.</> : 'No voice agent answers incoming calls.'}</Notice>
      <Field label="Answer incoming calls with">
        <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">—</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.status})</option>)}
        </Select>
      </Field>
      <div className="row row-end">
        <Button busy={busy === 'save'} disabled={!choice || choice === get.data?.inbound_voice_agent_id} onClick={() => act('set-inbound-voice-agent', { body: { workspace_id: workspaceId, voice_agent_id: choice } }, { key: 'save', onDone: get.reload })}>Save</Button>
      </div>
    </Card>
  );
}

function Catalog() {
  const { workspaceId } = useApp();
  const cat = useApi('voice-agent-catalog', { query: { workspace_id: workspaceId } });
  const d = cat.data;
  if (!d) return <Card title="Catalog"><div className="muted">{cat.loading ? 'Loading…' : 'No catalog.'}</div></Card>;
  const section = (title: string, list: any[] = []) => (
    <Card title={`${title} (${list.length})`}>
      {list.length === 0 && <div className="muted">None.</div>}
      {list.map((p) => (
        <div key={p.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, display: 'grid', gap: 6 }}>
          <div className="row">
            <strong>{p.name}</strong>
            <code>{p.id}</code>
            <Badge tone={p.available ? 'green' : 'red'}>{p.available ? 'available' : 'not available'}</Badge>
            {p.key_source && <Badge tone="gray">key: {p.key_source}</Badge>}
          </div>
          {p.models?.length > 0 && <div className="chips"><span className="muted">Models:</span>{p.models.map((m: any) => <Badge key={m.id} tone="blue">{m.name || m.id}</Badge>)}</div>}
          {p.voices?.length > 0 && <div className="chips"><span className="muted">Voices:</span>{p.voices.map((v: any) => <Badge key={v.id} tone="violet">{v.name || v.id}</Badge>)}</div>}
        </div>
      ))}
    </Card>
  );
  return (
    <>
      <Notice tone={d.livekit_configured ? 'ok' : 'warn'}>{d.livekit_configured ? 'LiveKit is configured — voice agents can take calls.' : 'LiveKit is not configured for this account.'}</Notice>
      <div className="grid-2">
        {section('Speech to text', d.stt)}
        {section('Text to speech', d.tts)}
        {section('Language models', d.llm)}
        {section('Realtime', d.realtime)}
      </div>
      <Card title={`Templates (${(d.templates || []).length})`}>
        <div className="chips">{(d.templates || []).map((t: any) => <Badge key={t.id} tone="gray">{t.name} ({t.id})</Badge>)}</div>
      </Card>
    </>
  );
}

function CallLog() {
  const { workspaceId } = useApp();
  const agents = useApi('list-voice-agents', { query: { workspace_id: workspaceId } }, { quiet: true });
  const contacts = useContactChoices(workspaceId);
  const [agentId, setAgentId] = useState('');
  const [contactId, setContactId] = useState('');
  const [q, setQ] = useState('');
  const [tests, setTests] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useApi('list-voice-calls', {
    query: { workspace_id: workspaceId, voice_agent_id: agentId || undefined, contact_id: contactId || undefined, q: q.trim() || undefined, include_tests: tests ? 1 : undefined, page, limit: 25 },
  });
  const rows = list.rows as any[];
  const pagination = list.raw?.pagination;
  const detail = useApi('get-voice-call', selectedId ? { path: { call_id: selectedId }, query: { workspace_id: workspaceId } } : null);
  const reset = () => setPage(1);

  return (
    <Split
      side={
        <Card title="Voice call">
          {!selectedId ? (
            <div className="muted">Pick a call to read its transcript.</div>
          ) : detail.data ? (
            <>
              <div className="row"><Status value={detail.data.status} /><Badge tone="gray">{detail.data.direction}</Badge>{detail.data.is_test ? <Badge tone="amber">test</Badge> : null}</div>
              <div className="stat-row">
                <div className="stat"><b>{detail.data.duration_seconds ?? '—'}s</b><span>duration</span></div>
                <div className="stat"><b>{detail.data.turns ?? '—'}</b><span>turns</span></div>
                <div className="stat"><b>{detail.data.response_ms_p50 ?? '—'} ms</b><span>response p50</span></div>
              </div>
              <strong style={{ fontSize: 13 }}>Transcript</strong>
              <div className="transcript">
                {(detail.data.transcript || []).length === 0 && <span className="muted">No transcript.</span>}
                {(detail.data.transcript || []).map((t: any, i: number) => (
                  <div key={i}><b>{t.role}</b>{t.text}</div>
                ))}
              </div>
              <Props value={detail.data} omit={['transcript', 'metrics']} />
            </>
          ) : (
            <div className="muted">{detail.loading ? 'Loading…' : 'Not found.'}</div>
          )}
        </Card>
      }
    >
      <Card title={`Voice calls${pagination?.total != null ? ` (${pagination.total})` : ''}`} actions={<Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>} pad={false}>
        <div className="filters">
          <Input placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
          <Select value={agentId} onChange={(e) => { setAgentId(e.target.value); reset(); }}>
            <option value="">Any agent</option>
            {(agents.rows as any[]).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select value={contactId} onChange={(e) => { setContactId(e.target.value); reset(); }}>
            <option value="">Any contact</option>
            {contacts.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
          <label className="check"><input type="checkbox" checked={tests} onChange={(e) => { setTests(e.target.checked); reset(); }} /> Include tests</label>
        </div>
        <DataTable
          rows={rows}
          loading={list.loading}
          rowKey={(c) => c.id}
          selected={selectedId}
          onRow={(c) => setSelectedId(c.id)}
          empty="No voice calls"
          columns={[
            { label: 'Contact', render: (c) => <><div className="strong">{c.contact_name || '—'}</div><div className="muted">{c.contact_phone || ''}</div></> },
            { label: 'Agent', render: (c) => <>{c.voice_agent_name || '—'}{c.voice_agent_deleted ? <span className="muted"> (deleted)</span> : null}</> },
            { label: 'Channel', render: (c) => <Badge tone="blue">{c.channel}</Badge> },
            { label: 'Status', render: (c) => <Status value={c.status} /> },
            { label: 'Length', render: (c) => (c.duration_seconds != null ? `${c.duration_seconds}s` : '—') },
            { label: 'Started', render: (c) => <span className="muted">{when(c.started_at)}</span> },
          ]}
        />
        <Pager page={page} pages={pagination?.total_pages} total={pagination?.total} onPage={setPage} />
      </Card>
    </Split>
  );
}
