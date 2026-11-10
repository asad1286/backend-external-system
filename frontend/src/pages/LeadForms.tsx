import { useState, useEffect } from 'react';
import { useApp } from '../state';
import { Badge, Button, Card, Copy, Input, Json, when } from '../ui';
import { DataTable, EndpointForm, Pager, Props, ScopeNote, Split, Tabs, personName, useAction, useApi } from '../kit';

type FormField = { key: string; type: string; label: string; required?: boolean };
type LeadForm = { id: number; name: string; slug?: string; title?: string; description?: string; fields?: FormField[]; settings?: Record<string, unknown>; is_active: boolean; submission_count?: number; created_at?: string; updated_at?: string; public_url?: string; embed_snippet?: string };
type Submission = { id: number; contact_id?: number; contact?: any; is_new_contact?: boolean; payload?: Record<string, unknown>; page_url?: string; referrer?: string; created_at?: string };

const LIMIT = 25;
const DEFAULT_FIELDS: FormField[] = [
  { key: 'first_name', type: 'text', label: 'First name', required: true },
  { key: 'email', type: 'email', label: 'Email', required: true },
  { key: 'phone_number', type: 'phone', label: 'Mobile', required: false },
];

export default function LeadForms() {
  const { workspaceId } = useApp();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = useApi('list-lead-forms', { query: { workspace_id: workspaceId, search: search.trim() || undefined, page, limit: LIMIT } });
  const rows = list.rows as LeadForm[];
  const pagination = list.raw?.pagination;
  // The list row shows at once; the full record (get-lead-form) replaces it when it arrives.
  const detail = useApi('get-lead-form', selectedId ? { path: { id: selectedId } } : null, { quiet: true });
  useEffect(() => {
    if (selectedId) detail.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.result]);
  const listed = rows.find((f) => f.id === selectedId) || null;
  const selected = listed && detail.data?.id === listed.id ? { ...listed, ...detail.data } : listed;

  return (
    <>
      <ScopeNote scopes={['lead_forms.read', 'lead_forms.write']} />
      <Split
        wide={Boolean(selected)}
        side={
          selected ? (
            <FormPanel key={selected.id} form={selected} onChanged={list.reload} onClose={() => setSelectedId(null)} />
          ) : (
            <Card title="New lead form">
              <EndpointForm
                slug="create-lead-form"
                fixed={{ workspace_id: workspaceId }}
                initial={{ fields: DEFAULT_FIELDS, settings: { submit_button_text: 'Send', thank_you_message: 'Thanks — we will be in touch.', tags: ['web-lead'] }, is_active: true }}
                submit="Create form"
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
          title={`Lead forms${pagination?.total != null ? ` (${pagination.total})` : ''}`}
          actions={
            <>
              <Input placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ width: 180 }} />
              <Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>
            </>
          }
          pad={false}
        >
          <DataTable
            rows={rows}
            loading={list.loading}
            rowKey={(f) => f.id}
            selected={selectedId}
            onRow={(f) => setSelectedId(f.id)}
            empty="No lead forms"
            columns={[
              { label: 'Form', render: (f) => <><div className="strong">{f.name}</div><div className="muted">{f.title || f.slug || `#${f.id}`}</div></> },
              { label: 'Fields', render: (f) => <span className="muted">{f.fields?.length ?? 0}</span> },
              { label: 'Submissions', render: (f) => f.submission_count ?? 0 },
              { label: 'Active', render: (f) => <Badge tone={f.is_active ? 'green' : 'gray'}>{f.is_active ? 'active' : 'off'}</Badge> },
              { label: 'Updated', render: (f) => <span className="muted">{when(f.updated_at)}</span> },
            ]}
          />
          <Pager page={page} pages={pagination?.total_pages} total={pagination?.total} onPage={setPage} />
        </Card>
      </Split>
    </>
  );
}

function FormPanel({ form, onChanged, onClose }: { form: LeadForm; onChanged: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<'details' | 'edit' | 'submissions'>('details');
  const { act, busy } = useAction();
  return (
    <Card title={form.name} actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>New form</Button>}>
      <div className="row">
        <Badge tone={form.is_active ? 'green' : 'gray'}>{form.is_active ? 'active' : 'off'}</Badge>
        <span className="muted">{form.submission_count ?? 0} submissions</span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" className="btn-sm" busy={busy === 'toggle'} onClick={() => act('update-lead-form', { path: { id: form.id }, body: { is_active: !form.is_active } }, { key: 'toggle', done: form.is_active ? 'Form turned off.' : 'Form turned on.', onDone: onChanged })}>
          {form.is_active ? 'Turn off' : 'Turn on'}
        </Button>
        <Button variant="danger" className="btn-sm" busy={busy === 'del'} onClick={() => act('delete-lead-form', { path: { id: form.id } }, { key: 'del', confirm: `Delete “${form.name}”? Its public link stops working.`, done: 'Form deleted.', onDone: () => { onClose(); onChanged(); } })}>Delete</Button>
      </div>
      {form.public_url && (
        <div className="row">
          <a href={form.public_url} target="_blank" rel="noreferrer" className="break" style={{ flex: 1 }}>{form.public_url}</a>
          <Copy text={form.public_url} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'details', label: 'Details' }, { id: 'edit', label: 'Edit' }, { id: 'submissions', label: 'Submissions' }]} />
      {tab === 'details' && (
        <>
          {form.embed_snippet && (
            <div className="field">
              <span className="field-label row">Embed snippet <Copy text={form.embed_snippet} /></span>
              <pre className="json" style={{ maxHeight: 140, whiteSpace: 'pre-wrap' }}>{form.embed_snippet}</pre>
            </div>
          )}
          <div className="field">
            <span className="field-label">Fields</span>
            <div className="chips">
              {(form.fields || []).map((f) => (
                <Badge key={f.key} tone={f.required ? 'blue' : 'gray'}>{f.label} · {f.type}{f.required ? ' *' : ''}</Badge>
              ))}
            </div>
          </div>
          <Props value={form} omit={['fields', 'embed_snippet', 'public_url', 'workspace_id']} />
        </>
      )}
      {tab === 'edit' && <EndpointForm slug="update-lead-form" path={{ id: form.id }} initial={form as unknown as Record<string, unknown>} changesOnly submit="Save changes" onDone={onChanged} />}
      {tab === 'submissions' && <Submissions formId={form.id} />}
    </Card>
  );
}

function Submissions({ formId }: { formId: number }) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const res = useApi('list-lead-form-submissions', { path: { id: formId }, query: { page, limit: LIMIT } });
  const rows = (res.data?.submissions || []) as Submission[];
  const pagination = res.raw?.pagination;
  const preview = (p?: Record<string, unknown>) =>
    p ? Object.entries(p).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ') : '—';
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <DataTable
        rows={rows}
        loading={res.loading}
        rowKey={(s) => s.id}
        selected={open}
        onRow={(s) => setOpen(open === s.id ? null : s.id)}
        empty="No submissions yet"
        columns={[
          { label: 'Contact', render: (s) => <><div className="strong">{personName(s.contact)}</div>{s.is_new_contact && <Badge tone="green">new contact</Badge>}</> },
          { label: 'Answers', render: (s) => <span className="muted break">{preview(s.payload)}</span> },
          { label: 'Page', render: (s) => (s.page_url ? <a href={s.page_url} target="_blank" rel="noreferrer" className="break" onClick={(e) => e.stopPropagation()}>{s.page_url.replace(/^https?:\/\//, '').slice(0, 40)}</a> : <span className="muted">—</span>) },
          { label: 'When', render: (s) => <span className="muted">{when(s.created_at)}</span> },
        ]}
      />
      {open && <Json value={rows.find((s) => s.id === open)?.payload} max={260} />}
      <Pager page={page} pages={pagination?.total_pages} total={pagination?.total} onPage={setPage} />
    </div>
  );
}
