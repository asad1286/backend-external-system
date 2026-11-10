import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { Badge, Button, Card, Input, Select, when } from '../ui';
import { DataTable, EndpointForm, Pager, Props, ScopeNote, Split, Status, Tabs, money, personName, useAction, useApi, useContactChoices } from '../kit';

type Stage = { id: number; name: string; color?: string; position?: number; is_won?: boolean; is_lost?: boolean };
type Pipeline = { id: number; name: string; is_default?: boolean; stages: Stage[] };
type Opp = { id: number; name: string; value?: number; currency?: string; status: string; lost_reason?: string | null; pipeline_id: number; stage_id: number; stage?: Stage; contact_id: number; contact?: any; source?: string; tags?: string[]; updated_at?: string; created_at?: string };

const LIMIT = 100;

export default function Opportunities() {
  const { workspaceId } = useApp();
  const pipelines = useApi('list-pipelines', { query: { workspace_id: workspaceId } });
  const [pipelineId, setPipelineId] = useState<number | null>(null);
  const [view, setView] = useState<'board' | 'table'>('board');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [side, setSide] = useState<'details' | 'edit' | 'activity'>('details');
  const contacts = useContactChoices(workspaceId);

  const pls = pipelines.rows as Pipeline[];
  useEffect(() => {
    if (pls.length && !pls.some((p) => p.id === pipelineId)) setPipelineId((pls.find((p) => p.is_default) || pls[0]).id);
  }, [pls, pipelineId]);
  const pipeline = pls.find((p) => p.id === pipelineId) || null;

  const list = useApi(
    'list-opportunities',
    pipelineId ? { query: { workspace_id: workspaceId, pipeline_id: pipelineId, status: status || undefined, search: search.trim() || undefined, page, limit: LIMIT } } : null,
  );
  const rows = list.rows as Opp[];
  const pagination = list.raw?.pagination;
  // The card shows at once; the full record (get-opportunity) replaces it when it arrives.
  const detail = useApi('get-opportunity', selectedId ? { path: { id: selectedId } } : null, { quiet: true });
  useEffect(() => {
    if (selectedId) detail.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.result]);
  const listed = rows.find((o) => o.id === selectedId) || null;
  const selected = listed && detail.data?.id === listed.id ? { ...listed, ...detail.data } : listed;

  const stages = useMemo(() => [...(pipeline?.stages || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [pipeline]);
  const stageChoices = stages.map((s) => ({ value: s.id, label: s.name }));
  const total = rows.reduce((n, o) => n + (Number(o.value) || 0), 0);

  return (
    <>
      <ScopeNote scopes={['opportunities.read', 'opportunities.write']} />
      <Split
        side={
          selected ? (
            <OppPanel key={selected.id} opp={selected} stages={stages} side={side} setSide={setSide} onChanged={list.reload} onClose={() => setSelectedId(null)} />
          ) : (
            <Card title="New opportunity">
              <EndpointForm
                slug="create-opportunity"
                fixed={{ workspace_id: workspaceId }}
                initial={{ pipeline_id: pipelineId ?? undefined, currency: 'USD', status: 'open' }}
                choices={{ contact_id: contacts, pipeline_id: pls.map((p) => ({ value: p.id, label: p.name })), stage_id: stageChoices }}
                hide={['owner_id', 'custom_fields']}
                submit="Create opportunity"
                onDone={(r) => {
                  list.reload();
                  if (r.data?.data?.id) setSelectedId(r.data.data.id);
                }}
              />
            </Card>
          )
        }
      >
        <Card
          title={
            <div className="row">
              <Select value={pipelineId ?? ''} onChange={(e) => { setPipelineId(Number(e.target.value)); setPage(1); }} style={{ width: 220 }}>
                {pls.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (default)' : ''}</option>)}
              </Select>
              <span className="muted">{pagination?.total ?? rows.length} deals · {money(total, rows[0]?.currency)}</span>
            </div>
          }
          actions={
            <>
              <Tabs value={view} onChange={setView} tabs={[{ id: 'board', label: 'Board' }, { id: 'table', label: 'Table' }]} />
              <Button variant="ghost" className="btn-sm" busy={list.loading || pipelines.loading} onClick={() => { pipelines.reload(); list.reload(); }}>Reload</Button>
            </>
          }
          pad={false}
        >
          <div className="filters">
            <Input placeholder="Search name, contact…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Any status</option>
              {['open', 'won', 'lost', 'abandoned'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          {!pls.length && !pipelines.loading ? (
            <div className="empty"><strong>No pipelines in this workspace</strong><div>Create one in the myCRMSIM dashboard (Opportunities).</div></div>
          ) : view === 'board' ? (
            <div className="board">
              {stages.map((s) => {
                const cards = rows.filter((o) => o.stage_id === s.id);
                return (
                  <div key={s.id} className="board-col">
                    <h3>
                      <span className="swatch" style={{ background: s.color || 'var(--brand)' }} />
                      {s.name}
                      <span className="muted" style={{ marginLeft: 'auto' }}>{cards.length}</span>
                    </h3>
                    {cards.map((o) => (
                      <div key={o.id} className={`board-card ${o.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(o.id); setSide('details'); }}>
                        <strong>{o.name}</strong>
                        <span className="muted">{personName(o.contact)}</span>
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <span>{money(o.value, o.currency)}</span>
                          <Status value={o.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <DataTable
              rows={rows}
              loading={list.loading}
              rowKey={(o) => o.id}
              selected={selectedId}
              onRow={(o) => { setSelectedId(o.id); setSide('details'); }}
              empty="No opportunities"
              columns={[
                { label: 'Name', render: (o) => <><div className="strong">{o.name}</div><div className="muted">#{o.id}{o.source ? ` · ${o.source}` : ''}</div></> },
                { label: 'Contact', render: (o) => personName(o.contact) },
                { label: 'Stage', render: (o) => <Badge tone="violet">{o.stage?.name || stages.find((s) => s.id === o.stage_id)?.name || o.stage_id}</Badge> },
                { label: 'Value', render: (o) => money(o.value, o.currency) },
                { label: 'Status', render: (o) => <Status value={o.status} /> },
                { label: 'Updated', render: (o) => <span className="muted">{when(o.updated_at)}</span> },
              ]}
            />
          )}
          <Pager page={page} pages={pagination?.total_pages} total={pagination?.total} onPage={setPage} />
        </Card>
      </Split>
    </>
  );
}

function OppPanel({ opp, stages, side, setSide, onChanged, onClose }: { opp: Opp; stages: Stage[]; side: 'details' | 'edit' | 'activity'; setSide: (s: 'details' | 'edit' | 'activity') => void; onChanged: () => void; onClose: () => void }) {
  const { act, busy } = useAction();
  const [lostReason, setLostReason] = useState('');
  const activity = useApi('list-opportunity-activities', side === 'activity' ? { path: { id: opp.id }, query: { limit: 50 } } : null);

  return (
    <Card title={opp.name} actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>New</Button>}>
      <div className="row">
        <Status value={opp.status} />
        <strong>{money(opp.value, opp.currency)}</strong>
        <span className="muted">· {personName(opp.contact)}</span>
      </div>

      <div className="field">
        <span className="field-label">Stage</span>
        <div className="chips">
          {stages.map((s) => (
            <Button
              key={s.id}
              variant={s.id === opp.stage_id ? 'primary' : 'ghost'}
              className="btn-sm"
              busy={busy === `stage-${s.id}`}
              disabled={s.id === opp.stage_id}
              onClick={() => act('move-opportunity-stage', { path: { id: opp.id }, body: { stage_id: s.id } }, { key: `stage-${s.id}`, done: `Moved to ${s.name}.`, onDone: onChanged })}
            >
              {s.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Status</span>
        <div className="row">
          {['open', 'won', 'abandoned'].map((st) => (
            <Button key={st} variant={opp.status === st ? 'primary' : 'ghost'} className="btn-sm" disabled={opp.status === st} busy={busy === `st-${st}`} onClick={() => act('change-opportunity-status', { path: { id: opp.id }, body: { status: st } }, { key: `st-${st}`, onDone: onChanged })}>{st}</Button>
          ))}
          <Input placeholder="Lost reason" value={lostReason} onChange={(e) => setLostReason(e.target.value)} style={{ width: 150 }} />
          <Button variant="danger" className="btn-sm" disabled={opp.status === 'lost'} busy={busy === 'st-lost'} onClick={() => act('change-opportunity-status', { path: { id: opp.id }, body: { status: 'lost', lost_reason: lostReason.trim() || undefined } }, { key: 'st-lost', onDone: onChanged })}>Lost</Button>
        </div>
      </div>

      <Tabs value={side} onChange={setSide} tabs={[{ id: 'details', label: 'Details' }, { id: 'edit', label: 'Edit' }, { id: 'activity', label: 'Activity' }]} />
      {side === 'details' && <Props value={opp} omit={['contact', 'pipeline', 'stage', 'workspace_id']} />}
      {side === 'edit' && <EndpointForm slug="update-opportunity" path={{ id: opp.id }} initial={opp} changesOnly hide={['owner_id']} submit="Save changes" onDone={onChanged} />}
      {side === 'activity' && (
        <div className="timeline">
          {activity.rows.length === 0 && <div className="muted">{activity.loading ? 'Loading…' : 'No activity yet.'}</div>}
          {activity.rows.map((a: any) => (
            <div key={a.id} className="timeline-item">
              <span className="muted">{when(a.created_at)}</span>
              <span>
                <Badge tone="gray">{a.type}</Badge>{' '}
                {a.from_stage || a.to_stage ? `${a.from_stage?.name || '—'} → ${a.to_stage?.name || '—'}` : a.from_status || a.to_status ? `${a.from_status || '—'} → ${a.to_status || '—'}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="row row-end">
        <Button variant="danger" className="btn-sm" busy={busy === 'del'} onClick={() => act('delete-opportunity', { path: { id: opp.id } }, { key: 'del', confirm: `Delete “${opp.name}”?`, done: 'Opportunity deleted.', onDone: () => { onClose(); onChanged(); } })}>Delete opportunity</Button>
      </div>
    </Card>
  );
}
