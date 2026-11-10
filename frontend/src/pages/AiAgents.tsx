import { useState } from 'react';
import { useApp } from '../state';
import { Badge, Button, Card, Input, Select, when } from '../ui';
import { DataTable, EndpointForm, Pager, Props, ScopeNote, Split, Status, Tabs, endpoint, useAction, useApi } from '../kit';

type Agent = { id: string; name: string; role?: string; persona?: string; status: string; workspace_id?: string; config_metadata?: Record<string, any>; created_at?: string; updated_at?: string };
type Model = { id: string; name: string; provider?: string; description?: string; recommended?: boolean };

const LIMIT = 20;
const EXAMPLE = endpoint('create-ai-agent').requestBody as Record<string, any> | null;

export default function AiAgents() {
  const { workspaceId } = useApp();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useApi('list-ai-agents', { query: { workspace_id: workspaceId, status: status || undefined, search: search.trim() || undefined, page, limit: LIMIT } });
  const models = useApi('list-ai-models', { query: { workspace_id: workspaceId } }, { quiet: true });
  const rows = list.rows as Agent[];
  const modelRows = models.rows as Model[];
  const pagination = list.raw?.pagination;
  const selected = rows.find((a) => a.id === selectedId) || null;
  const recommended = modelRows.find((m) => m.recommended)?.id;

  return (
    <>
      <ScopeNote scopes={['ai_agents.read', 'ai_agents.write']} />
      <Split
        side={
          <>
            {selected ? (
              <AgentPanel key={selected.id} agent={selected} workspaceId={workspaceId!} onChanged={list.reload} onClose={() => setSelectedId(null)} onSelect={setSelectedId} />
            ) : (
              <Card title="New AI agent">
                <EndpointForm
                  slug="create-ai-agent"
                  fixed={{ workspace_id: workspaceId }}
                  initial={{
                    status: 'draft',
                    config_metadata: EXAMPLE?.config_metadata ? { ...EXAMPLE.config_metadata, model: recommended || EXAMPLE.config_metadata.model } : undefined,
                  }}
                  submit="Create agent"
                  onDone={(r) => {
                    list.reload();
                    if (r.data?.data?.id) setSelectedId(r.data.data.id);
                  }}
                />
                {modelRows.length > 0 && <div className="muted">config_metadata.model takes an id from Models below: {modelRows.map((m) => m.id).join(', ')}.</div>}
              </Card>
            )}
            <Card title={`Models (${modelRows.length})`} actions={<Button variant="ghost" className="btn-sm" busy={models.loading} onClick={models.reload}>Reload</Button>} pad={false}>
              <DataTable
                rows={modelRows}
                loading={models.loading}
                rowKey={(m) => m.id}
                empty={models.ok ? 'No models' : 'Models need the account’s AI key (dashboard)'}
                columns={[
                  { label: 'Model', render: (m) => <><div className="strong">{m.name} {m.recommended && <Badge tone="green">recommended</Badge>}</div><div className="muted"><code>{m.id}</code>{m.provider ? ` · ${m.provider}` : ''}</div></> },
                  { label: 'About', render: (m) => <span className="muted">{m.description || '—'}</span> },
                ]}
              />
            </Card>
          </>
        }
      >
        <Card
          title={`AI agents${pagination?.total != null ? ` (${pagination.total})` : ''}`}
          actions={<Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>}
          pad={false}
        >
          <div className="filters">
            <Input placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Any status</option>
              {['draft', 'active', 'paused'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <DataTable
            rows={rows}
            loading={list.loading}
            rowKey={(a) => a.id}
            selected={selectedId}
            onRow={(a) => setSelectedId(a.id)}
            empty="No AI agents"
            columns={[
              { label: 'Agent', render: (a) => <><div className="strong">{a.name}</div><div className="muted break">{(a.role || '').slice(0, 90)}</div></> },
              { label: 'Model', render: (a) => <code>{a.config_metadata?.model || '—'}</code> },
              { label: 'Tag', render: (a) => (a.config_metadata?.ghl_tag ? <Badge tone="blue">{a.config_metadata.ghl_tag}</Badge> : <span className="muted">—</span>) },
              { label: 'Status', render: (a) => <Status value={a.status} /> },
              { label: 'Updated', render: (a) => <span className="muted">{when(a.updated_at)}</span> },
            ]}
          />
          <Pager page={page} pages={pagination?.total_pages} total={pagination?.total} onPage={setPage} />
        </Card>
      </Split>
    </>
  );
}

function AgentPanel({ agent, workspaceId, onChanged, onClose, onSelect }: { agent: Agent; workspaceId: number; onChanged: () => void; onClose: () => void; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<'details' | 'edit'>('details');
  const full = useApi('get-ai-agent', { path: { id: agent.id }, query: { workspace_id: workspaceId } }, { quiet: true });
  const a = (full.data as Agent | undefined) || agent;
  const { act, busy } = useAction();
  const refresh = () => { full.reload(); onChanged(); };

  return (
    <Card title={a.name} actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>New</Button>}>
      <div className="row">
        <Status value={a.status} />
        <span className="muted">{a.config_metadata?.model || ''}</span>
        <span style={{ flex: 1 }} />
        {(['active', 'paused'] as const).filter((s) => s !== a.status).map((s) => (
          <Button key={s} variant={s === 'active' ? 'success' : 'ghost'} className="btn-sm" busy={busy === s} onClick={() => act('update-ai-agent', { path: { id: a.id }, body: { workspace_id: workspaceId, status: s } }, { key: s, onDone: refresh })}>
            {s === 'active' ? 'Activate' : 'Pause'}
          </Button>
        ))}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'details', label: 'Details' }, { id: 'edit', label: 'Edit' }]} />
      {tab === 'details' ? (
        <Props value={a} order={['id', 'name', 'status', 'role', 'persona', 'config_metadata']} />
      ) : (
        <EndpointForm slug="update-ai-agent" path={{ id: a.id }} fixed={{ workspace_id: workspaceId }} initial={a} changesOnly submit="Save changes" onDone={refresh} />
      )}
      <div className="row row-end">
        <Button variant="ghost" className="btn-sm" busy={busy === 'dup'} onClick={() => act('duplicate-ai-agent', { path: { id: a.id }, body: { workspace_id: workspaceId } }, { key: 'dup', done: 'Agent duplicated.', onDone: (r) => { onChanged(); if (r.data?.data?.id) onSelect(r.data.data.id); } })}>Duplicate</Button>
        <Button variant="danger" className="btn-sm" busy={busy === 'del'} onClick={() => act('delete-ai-agent', { path: { id: a.id }, query: { workspace_id: workspaceId } }, { key: 'del', confirm: `Delete “${a.name}”?`, done: 'Agent deleted.', onDone: () => { onClose(); onChanged(); } })}>Delete</Button>
      </div>
    </Card>
  );
}
