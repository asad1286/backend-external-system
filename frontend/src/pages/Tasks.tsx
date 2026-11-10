import { useState, useEffect } from 'react';
import { useApp } from '../state';
import { Badge, Button, Card, Input, Select, when } from '../ui';
import { DataTable, EndpointForm, Pager, Props, ScopeNote, Split, Status, Tabs, personName, useAction, useApi, useContactChoices } from '../kit';

type Task = { id: number; title: string; description?: string | null; priority?: string; status: string; due_at?: string | null; reminder_minutes_before?: number; contact_id?: number | null; contact?: any; opportunity_id?: number | null; opportunity?: any; completed_at?: string | null; created_at?: string };

const LIMIT = 25;
const PRIORITY_TONE: Record<string, string> = { high: 'red', medium: 'amber', low: 'gray' };
const isDone = (t: Task) => t.status === 'completed';
const overdue = (t: Task) => !isDone(t) && t.due_at && new Date(t.due_at).getTime() < Date.now();

export default function Tasks() {
  const { workspaceId } = useApp();
  const contacts = useContactChoices(workspaceId);
  const [status, setStatus] = useState('open');
  const [bucket, setBucket] = useState('');
  const [search, setSearch] = useState('');
  const [contactId, setContactId] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<'details' | 'edit'>('details');
  const { act, busy } = useAction();

  const list = useApi('list-tasks', {
    query: { workspace_id: workspaceId, status, bucket: bucket || undefined, search: search.trim() || undefined, contact_id: contactId || undefined, page, limit: LIMIT },
  });
  const rows = list.rows as Task[];
  const pagination = list.raw?.pagination;
  // The list row shows at once; the full record (get-task) replaces it when it arrives.
  const detail = useApi('get-task', selectedId ? { path: { id: selectedId } } : null, { quiet: true });
  useEffect(() => {
    if (selectedId) detail.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.result]);
  const listed = rows.find((t) => t.id === selectedId) || null;
  const selected = listed && detail.data?.id === listed.id ? { ...listed, ...detail.data } : listed;
  const reset = () => setPage(1);

  const toggle = (t: Task) =>
    act(isDone(t) ? 'reopen-task' : 'complete-task', { path: { id: t.id } }, { key: `tog-${t.id}`, done: isDone(t) ? 'Task reopened.' : 'Task completed.', onDone: list.reload });

  return (
    <>
      <ScopeNote scopes={['tasks.read', 'tasks.write']} />
      <Split
        side={
          selected ? (
            <Card title={selected.title} actions={<Button variant="ghost" className="btn-sm" onClick={() => setSelectedId(null)}>New task</Button>}>
              <div className="row">
                <Status value={selected.status} />
                {selected.priority && <Badge tone={PRIORITY_TONE[selected.priority] || 'gray'}>{selected.priority}</Badge>}
                {selected.due_at && <Badge tone={overdue(selected) ? 'red' : 'blue'}>due {when(selected.due_at)}</Badge>}
              </div>
              <div className="row">
                <Button variant={isDone(selected) ? 'ghost' : 'success'} className="btn-sm" busy={busy === `tog-${selected.id}`} onClick={() => toggle(selected)}>{isDone(selected) ? 'Reopen' : 'Mark complete'}</Button>
                <Button variant="danger" className="btn-sm" busy={busy === 'del'} onClick={() => act('delete-task', { path: { id: selected.id } }, { key: 'del', confirm: `Delete “${selected.title}”?`, done: 'Task deleted.', onDone: () => { setSelectedId(null); list.reload(); } })}>Delete</Button>
              </div>
              <Tabs value={tab} onChange={setTab} tabs={[{ id: 'details', label: 'Details' }, { id: 'edit', label: 'Edit' }]} />
              {tab === 'details' ? (
                <Props value={selected} omit={['contact', 'opportunity', 'workspace_id']} />
              ) : (
                <EndpointForm slug="update-task" path={{ id: selected.id }} initial={selected as unknown as Record<string, unknown>} changesOnly choices={{ contact_id: contacts }} hide={['assignee_id']} submit="Save changes" onDone={list.reload} />
              )}
            </Card>
          ) : (
            <Card title="New task">
              <EndpointForm
                slug="create-task"
                fixed={{ workspace_id: workspaceId }}
                initial={{ priority: 'medium' }}
                choices={{ contact_id: contacts }}
                hide={['assignee_id']}
                submit="Create task"
                onDone={(r) => {
                  list.reload();
                  if (r.data?.data?.id) setSelectedId(r.data.data.id);
                }}
              />
            </Card>
          )
        }
      >
        <Card title={`Tasks${pagination?.total != null ? ` (${pagination.total})` : ''}`} actions={<Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>} pad={false}>
          <div className="filters">
            <Input placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} />
            <Select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
              <option value="open">Open</option>
              <option value="completed">Completed</option>
              <option value="all">All</option>
            </Select>
            <Select value={bucket} onChange={(e) => { setBucket(e.target.value); reset(); }}>
              <option value="">Any due date</option>
              <option value="overdue">Overdue</option>
              <option value="today">Today</option>
              <option value="upcoming">Upcoming</option>
              <option value="no_due">No due date</option>
            </Select>
            <Select value={contactId} onChange={(e) => { setContactId(e.target.value); reset(); }}>
              <option value="">Any contact</option>
              {contacts.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </div>
          <DataTable
            rows={rows}
            loading={list.loading}
            rowKey={(t) => t.id}
            selected={selectedId}
            onRow={(t) => { setSelectedId(t.id); setTab('details'); }}
            empty="No tasks"
            columns={[
              {
                label: '',
                width: 36,
                render: (t) => (
                  <input
                    type="checkbox"
                    checked={isDone(t)}
                    disabled={busy === `tog-${t.id}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(t)}
                    title={isDone(t) ? 'Reopen' : 'Complete'}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                ),
              },
              {
                label: 'Task',
                render: (t) => (
                  <>
                    <div className="strong" style={isDone(t) ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{t.title}</div>
                    {t.description && <div className="muted">{String(t.description).slice(0, 80)}</div>}
                  </>
                ),
              },
              { label: 'Priority', render: (t) => (t.priority ? <Badge tone={PRIORITY_TONE[t.priority] || 'gray'}>{t.priority}</Badge> : <span className="muted">—</span>) },
              { label: 'Due', render: (t) => (t.due_at ? <Badge tone={overdue(t) ? 'red' : isDone(t) ? 'gray' : 'blue'}>{overdue(t) ? 'overdue · ' : ''}{when(t.due_at)}</Badge> : <span className="muted">no due date</span>) },
              { label: 'Contact', render: (t) => (t.contact ? personName(t.contact) : <span className="muted">—</span>) },
              { label: 'Status', render: (t) => <Status value={t.status} /> },
            ]}
          />
          <Pager page={page} pages={pagination?.total_pages} total={pagination?.total} onPage={setPage} />
        </Card>
      </Split>
    </>
  );
}
