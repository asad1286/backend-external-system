import { useMemo, useState } from 'react';
import { ok, errorText } from '../api';
import { useApp } from '../state';
import { Badge, Button, Card, Field, Input, Select, Textarea, Json, when } from '../ui';
import { DataTable, EndpointForm, Pager, Props, ScopeNote, Split, Status, Tabs, endpoint, run, useAction, useApi, useContactChoices } from '../kit';

type Workflow = { id: number; name: string; status: string; created_at?: string; updated_at?: string };
type Node = { id: string; type: string; data?: Record<string, any> };
type Edge = { id: string; source: string; target: string; sourceHandle?: string };
type Detail = Workflow & { workspace_id: number; stop_on_reply?: boolean; allow_re_entry?: boolean; execution_window?: any; step_count?: number; nodes?: Node[]; edges?: Edge[] };

const LIMIT = 20;
const EXAMPLE_PLAN = JSON.stringify((endpoint('create-workflow').requestBody as any)?.plan ?? { steps: [] }, null, 2);

export default function Automations() {
  const { workspaceId } = useApp();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = useApi('list-workflows', { query: { workspace_id: workspaceId, search: search.trim() || undefined, page, limit: LIMIT } });
  const data = list.data as { workflows?: Workflow[]; total?: number; activeCount?: number; draftCount?: number } | undefined;
  const rows = data?.workflows || [];
  const pagination = list.raw?.pagination;

  return (
    <>
      <ScopeNote scopes={['automations.read', 'automations.write']} />
      <div className="stat-row">
        <div className="stat"><b>{data?.total ?? '—'}</b><span>Workflows</span></div>
        <div className="stat"><b>{data?.activeCount ?? '—'}</b><span>Active</span></div>
        <div className="stat"><b>{data?.draftCount ?? '—'}</b><span>Drafts</span></div>
      </div>
      <Split
        side={
          selectedId ? (
            <WorkflowPanel key={selectedId} id={selectedId} workspaceId={workspaceId!} onChanged={list.reload} onClose={() => setSelectedId(null)} />
          ) : (
            <CreatePanel workspaceId={workspaceId!} onCreated={(id) => { list.reload(); if (id) setSelectedId(id); }} />
          )
        }
      >
        <Card
          title="Workflows"
          actions={
            <>
              <Input placeholder="Search name…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ width: 180 }} />
              <Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>
            </>
          }
          pad={false}
        >
          <DataTable
            rows={rows}
            loading={list.loading}
            rowKey={(w) => w.id}
            selected={selectedId}
            onRow={(w) => setSelectedId(w.id)}
            empty="No workflows"
            columns={[
              { label: 'Name', render: (w) => <><div className="strong">{w.name}</div><div className="muted">#{w.id}</div></> },
              { label: 'Status', render: (w) => <Status value={w.status} /> },
              { label: 'Updated', render: (w) => <span className="muted">{when(w.updated_at)}</span> },
            ]}
          />
          <Pager page={page} pages={pagination?.total_pages} total={pagination?.total} onPage={setPage} />
        </Card>
      </Split>
    </>
  );
}

/** The steps in run order: follow the edges from the node nothing points at. */
function orderSteps(nodes: Node[] = [], edges: Edge[] = []) {
  const targets = new Set(edges.map((e) => e.target));
  const out: { node: Node; next: Edge[] }[] = [];
  const seen = new Set<string>();
  const queue = nodes.filter((n) => !targets.has(n.id)).map((n) => n.id);
  if (!queue.length && nodes[0]) queue.push(nodes[0].id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.find((n) => n.id === id);
    if (!node) continue;
    const next = edges.filter((e) => e.source === id);
    out.push({ node, next });
    next.forEach((e) => queue.push(e.target));
  }
  nodes.filter((n) => !seen.has(n.id)).forEach((node) => out.push({ node, next: edges.filter((e) => e.source === node.id) }));
  return out;
}

const summary = (data: Record<string, any> = {}) =>
  Object.entries(data)
    .filter(([k, v]) => v !== '' && v !== null && v !== undefined && !['phone', 'note'].includes(k))
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');

function WorkflowPanel({ id, workspaceId, onChanged, onClose }: { id: number; workspaceId: number; onChanged: () => void; onClose: () => void }) {
  const wf = useApi('get-workflow', { path: { id }, query: { workspace_id: workspaceId } });
  const { act, busy } = useAction();
  const contacts = useContactChoices(workspaceId);
  const [tab, setTab] = useState<'steps' | 'settings' | 'contacts' | 'details'>('steps');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [removeId, setRemoveId] = useState('');
  const w = wf.data as Detail | undefined;
  const steps = useMemo(() => orderSteps(w?.nodes, w?.edges), [w]);
  const refresh = () => { wf.reload(); onChanged(); };

  if (!w) return <Card title={`Workflow #${id}`} actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>Close</Button>}><div className="muted">{wf.loading ? 'Loading…' : 'Could not load it.'}</div></Card>;
  const active = w.status === 'active';
  const shown = contacts.filter((c) => c.label.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Card title={w.name} actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>New</Button>}>
      <div className="row">
        <Status value={w.status} />
        <span className="muted">{w.step_count ?? steps.length} steps · updated {when(w.updated_at)}</span>
        <span style={{ flex: 1 }} />
        {active ? (
          <Button variant="ghost" className="btn-sm" busy={busy === 'off'} onClick={() => act('deactivate-workflow', { path: { id }, body: { workspace_id: workspaceId } }, { key: 'off', onDone: refresh })}>Deactivate</Button>
        ) : (
          <Button variant="success" className="btn-sm" busy={busy === 'on'} onClick={() => act('activate-workflow', { path: { id }, body: { workspace_id: workspaceId } }, { key: 'on', onDone: refresh })}>Activate</Button>
        )}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'steps', label: 'Steps' }, { id: 'settings', label: 'Settings' }, { id: 'contacts', label: 'Contacts' }, { id: 'details', label: 'Details' }]} />

      {tab === 'steps' && (
        <ol className="steps">
          {steps.length === 0 && <li className="muted">No steps.</li>}
          {steps.map(({ node, next }) => (
            <li key={node.id}>
              <Badge tone="violet">{node.type}</Badge> <strong>{node.id}</strong>
              {summary(node.data) && <div className="muted break">{summary(node.data)}</div>}
              {next.length > 1 && <div className="muted">{next.map((e) => `${e.sourceHandle || 'out'} → ${e.target}`).join(' · ')}</div>}
            </li>
          ))}
        </ol>
      )}

      {tab === 'settings' && (
        <EndpointForm slug="update-workflow" path={{ id }} fixed={{ workspace_id: workspaceId }} initial={w} changesOnly submit="Save settings" onDone={refresh} />
      )}

      {tab === 'contacts' && (
        <>
          <Field label={`Enroll contacts (${picked.size} picked)`}>
            <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 8, display: 'grid', gap: 4 }}>
              {shown.length === 0 && <span className="muted">No contacts.</span>}
              {shown.map((c) => (
                <label key={c.value} className="check">
                  <input
                    type="checkbox"
                    checked={picked.has(Number(c.value))}
                    onChange={(e) => {
                      const s = new Set(picked);
                      if (e.target.checked) s.add(Number(c.value));
                      else s.delete(Number(c.value));
                      setPicked(s);
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </Field>
          <div className="row row-end">
            {!active && <span className="muted">The workflow is not active — contacts enroll but nothing runs until it is.</span>}
            <Button busy={busy === 'enroll'} disabled={!picked.size} onClick={() => act('add-contacts-to-workflow', { path: { id }, body: { workspace_id: workspaceId, contact_ids: [...picked] } }, { key: 'enroll', onDone: () => setPicked(new Set()) })}>Enroll {picked.size || ''}</Button>
          </div>
          <Field label="Remove a contact from the workflow">
            <div className="row">
              <Select value={removeId} onChange={(e) => setRemoveId(e.target.value)} style={{ flex: 1 }}>
                <option value="">Pick a contact…</option>
                {contacts.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
              <Button variant="danger" busy={busy === 'remove'} disabled={!removeId} onClick={() => act('remove-contact-from-workflow', { path: { id, contact_id: removeId } }, { key: 'remove', confirm: 'Take this contact out of the workflow?', onDone: () => setRemoveId('') })}>Remove</Button>
            </div>
          </Field>
        </>
      )}

      {tab === 'details' && <Props value={w} omit={['nodes', 'edges']} />}

      <div className="row row-end">
        <Button variant="danger" className="btn-sm" busy={busy === 'del'} onClick={() => act('delete-workflow', { path: { id }, query: { workspace_id: workspaceId } }, { key: 'del', confirm: `Delete “${w.name}”?`, done: 'Workflow deleted.', onDone: () => { onClose(); onChanged(); } })}>Delete workflow</Button>
      </div>
    </Card>
  );
}

function CreatePanel({ workspaceId, onCreated }: { workspaceId: number; onCreated: (id?: number) => void }) {
  const [tab, setTab] = useState<'template' | 'plan' | 'catalog'>('template');
  return (
    <Card title="New workflow">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'template', label: 'From template' }, { id: 'plan', label: 'From plan' }, { id: 'catalog', label: 'Node catalog' }]} />
      {tab === 'template' && <FromTemplate workspaceId={workspaceId} onCreated={onCreated} />}
      {tab === 'plan' && <FromPlan workspaceId={workspaceId} onCreated={onCreated} />}
      {tab === 'catalog' && <Catalog />}
    </Card>
  );
}

function FromTemplate({ workspaceId, onCreated }: { workspaceId: number; onCreated: (id?: number) => void }) {
  const templates = useApi('list-workflow-templates', { query: { workspace_id: workspaceId } });
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const { act, busy } = useAction();
  const rows = templates.rows as { id: number; name: string; step_count?: number; updated_at?: string }[];
  return (
    <>
      <DataTable
        rows={rows}
        loading={templates.loading}
        rowKey={(t) => t.id}
        selected={templateId}
        onRow={(t) => { setTemplateId(t.id); setName(t.name); }}
        empty="No templates in this workspace"
        columns={[
          { label: 'Template', render: (t) => <span className="strong">{t.name}</span> },
          { label: 'Steps', render: (t) => t.step_count ?? '—' },
        ]}
      />
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the template's name" /></Field>
      <div className="row row-end">
        <Button
          disabled={!templateId}
          busy={busy === 'tpl'}
          onClick={() => act('create-workflow', { body: { workspace_id: workspaceId, template_id: templateId, name: name.trim() || undefined } }, { key: 'tpl', onDone: (r) => onCreated(r.data?.data?.id) })}
        >
          Create from template
        </Button>
      </div>
    </>
  );
}

function FromPlan({ workspaceId, onCreated }: { workspaceId: number; onCreated: (id?: number) => void }) {
  const { toast } = useApp();
  const { act, busy } = useAction();
  const [plan, setPlan] = useState(EXAMPLE_PLAN);
  const [check, setCheck] = useState<{ valid?: boolean; issues?: any[]; step_count?: number; error?: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const parse = () => {
    try {
      return JSON.parse(plan);
    } catch {
      toast('The plan is not valid JSON.', 'error');
      return null;
    }
  };
  const validate = async () => {
    const p = parse();
    if (!p) return;
    setChecking(true);
    const r = await run('validate-workflow-plan', { body: { plan: p } });
    setChecking(false);
    setCheck(ok(r) ? r.data.data : { valid: false, error: errorText(r), issues: r.data?.data?.issues || r.data?.issues });
  };

  return (
    <>
      <Field label="Plan (JSON)" hint="Named steps; each step's type comes from the Node catalog tab. The example is the docs' welcome flow.">
        <Textarea className="mono" style={{ minHeight: 300 }} value={plan} onChange={(e) => { setPlan(e.target.value); setCheck(null); }} />
      </Field>
      {check && (
        <div className={`notice ${check.valid ? 'notice-ok' : 'notice-error'}`}>
          {check.valid ? `Valid — ${check.step_count ?? ''} steps.` : check.error || 'The plan has issues:'}
          {!!check.issues?.length && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {check.issues.map((i: any, n: number) => <li key={n}>{typeof i === 'string' ? i : `${i.step ? `${i.step}: ` : ''}${i.message || JSON.stringify(i)}`}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="row row-end">
        <Button variant="ghost" busy={checking} onClick={validate}>Validate</Button>
        <Button
          busy={busy === 'plan'}
          onClick={() => {
            const p = parse();
            if (p) act('create-workflow', { body: { workspace_id: workspaceId, plan: p } }, { key: 'plan', onDone: (r) => onCreated(r.data?.data?.id) });
          }}
        >
          Create workflow
        </Button>
      </div>
    </>
  );
}

function Catalog() {
  const [types, setTypes] = useState('');
  const cat = useApi('workflow-node-catalog', { query: { detail: types.trim() ? 'full' : undefined, types: types.trim() || undefined } });
  const rows = cat.rows as { type: string; kind: string; title: string; purpose: string; whenToUse?: string; howItWorks?: string; defaults?: any; fields?: { name: string; kind: string; desc: string }[] }[];
  return (
    <>
      <Input placeholder="Full detail for types, e.g. sendSMS,wait" value={types} onChange={(e) => setTypes(e.target.value)} />
      {cat.loading && <div className="muted">Loading…</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((n) => (
          <div key={n.type} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, display: 'grid', gap: 4, fontSize: 13 }}>
            <div className="row">
              <strong>{n.title}</strong>
              <code>{n.type}</code>
              <Badge tone={n.kind === 'trigger' ? 'amber' : 'blue'}>{n.kind}</Badge>
            </div>
            <span className="muted">{n.purpose}</span>
            {n.whenToUse && <span><b>When:</b> {n.whenToUse}</span>}
            {n.howItWorks && <span><b>How:</b> {n.howItWorks}</span>}
            {!!n.fields?.length && (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {n.fields.map((f) => <li key={f.name}><code>{f.name}</code> <span className="muted">({f.kind})</span> {f.desc}</li>)}
              </ul>
            )}
            {n.defaults && Object.keys(n.defaults).length > 0 && <Json value={n.defaults} max={160} />}
          </div>
        ))}
      </div>
    </>
  );
}
