import { useState, useEffect } from 'react';
import { useApp } from '../state';
import { Badge, Button, Card, Input, Select, when } from '../ui';
import { DataTable, EndpointForm, Pager, Props, ScopeNote, Split, Status, Tabs, useAction, useApi } from '../kit';

type Channel = 'android' | 'imessage' | 'whatsapp' | 'rcs';
type Admin = { id: number; name: string; email: string; status: string; workspaces?: { id: number; name: string }[]; devices?: Record<Channel, { id: number; name: string }[]>; device_limits?: Record<Channel, number>; created_at?: string };

const LIMIT = 25;
const CHANNELS: Channel[] = ['android', 'imessage', 'whatsapp', 'rcs'];
const LABEL: Record<Channel, string> = { android: 'Android', imessage: 'iMessage', whatsapp: 'WhatsApp', rcs: 'RCS' };

function Usage({ a }: { a: Admin }) {
  return (
    <div className="chips">
      {CHANNELS.map((c) => {
        const used = a.devices?.[c]?.length ?? 0;
        const limit = a.device_limits?.[c] ?? 0;
        if (!used && !limit) return null;
        return <Badge key={c} tone={used > limit ? 'red' : used === limit ? 'amber' : 'gray'}>{LABEL[c]} {used}/{limit}</Badge>;
      })}
    </div>
  );
}

export default function SubaccountAdmins() {
  const { workspaces } = useApp();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<'details' | 'edit'>('details');
  const { act, busy } = useAction();

  const list = useApi('list-subaccount-admins', { query: { status: status || undefined, search: search.trim() || undefined, page, limit: LIMIT } });
  const rows = list.rows as Admin[];
  const pagination = list.raw?.pagination;
  // The list row shows at once; the full record (get-subaccount-admin) replaces it when it arrives.
  const detail = useApi('get-subaccount-admin', selectedId ? { path: { id: selectedId } } : null, { quiet: true });
  useEffect(() => {
    if (selectedId) detail.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.result]);
  const listed = rows.find((a) => a.id === selectedId) || null;
  const selected: Admin | null = listed && detail.data?.id === listed.id ? { ...listed, ...detail.data } : listed;

  const wsHint = (
    <div className="muted">
      Workspace ids for the id fields (comma separated):{' '}
      {workspaces.length ? workspaces.map((w, i) => <span key={w.id}>{i ? ', ' : ''}<code>{w.id}</code> {w.name}</span>) : 'none yet'}. Device ids are on the Devices page.
    </div>
  );

  return (
    <>
      <ScopeNote scopes={['subaccount_admins.read', 'subaccount_admins.write']} />
      <Split
        side={
          selected ? (
            <Card title={selected.name} actions={<Button variant="ghost" className="btn-sm" onClick={() => setSelectedId(null)}>Invite new</Button>}>
              <div className="row">
                <Status value={selected.status} />
                <span className="muted">{selected.email}</span>
              </div>
              <Usage a={selected} />
              <div className="row">
                <Button variant="ghost" className="btn-sm" busy={busy === 'status'} onClick={() => act('update-subaccount-admin', { path: { id: selected.id }, body: { status: selected.status === 'active' ? 'inactive' : 'active' } }, { key: 'status', onDone: list.reload })}>
                  {selected.status === 'active' ? 'Deactivate' : 'Activate'}
                </Button>
                <Button variant="danger" className="btn-sm" busy={busy === 'del'} onClick={() => act('delete-subaccount-admin', { path: { id: selected.id } }, { key: 'del', confirm: `Delete ${selected.name}? They lose access to their workspaces.`, done: 'Subaccount admin deleted.', onDone: () => { setSelectedId(null); list.reload(); } })}>Delete</Button>
              </div>
              <Tabs value={tab} onChange={setTab} tabs={[{ id: 'details', label: 'Details' }, { id: 'edit', label: 'Edit' }]} />
              {tab === 'details' ? (
                <>
                  <div className="field">
                    <span className="field-label">Workspaces</span>
                    <div className="chips">{(selected.workspaces || []).map((w) => <Badge key={w.id} tone="blue">{w.name} (#{w.id})</Badge>)}{!selected.workspaces?.length && <span className="muted">none</span>}</div>
                  </div>
                  <div className="field">
                    <span className="field-label">Devices</span>
                    {CHANNELS.map((c) => (selected.devices?.[c]?.length ? (
                      <div key={c} className="row"><span className="muted" style={{ width: 80 }}>{LABEL[c]}</span><div className="chips">{selected.devices[c].map((d) => <Badge key={d.id} tone="gray">{d.name} (#{d.id})</Badge>)}</div></div>
                    ) : null))}
                  </div>
                  <Props value={selected} omit={['workspaces', 'devices', 'device_limits']} />
                </>
              ) : (
                <>
                  {wsHint}
                  <EndpointForm
                    slug="update-subaccount-admin"
                    path={{ id: selected.id }}
                    initial={{ name: selected.name, status: selected.status, workspace_ids: selected.workspaces?.map((w) => w.id), ...Object.fromEntries(CHANNELS.map((c) => [`${c}_quantity`, selected.device_limits?.[c]])) }}
                    changesOnly
                    submit="Save changes"
                    onDone={list.reload}
                  />
                </>
              )}
            </Card>
          ) : (
            <Card title="Invite a subaccount admin">
              {wsHint}
              <EndpointForm
                slug="invite-subaccount-admin"
                initial={{ status: 'active', ...(workspaces[0] ? { workspace_ids: [workspaces[0].id] } : {}) }}
                submit="Send invite"
                onDone={(r) => {
                  list.reload();
                  if (r.data?.data?.id) setSelectedId(r.data.data.id);
                }}
              />
            </Card>
          )
        }
      >
        <Card title={`Subaccount admins${pagination?.total != null ? ` (${pagination.total})` : ''}`} actions={<Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>} pad={false}>
          <div className="filters">
            <Input placeholder="Search name or email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
          <DataTable
            rows={rows}
            loading={list.loading}
            rowKey={(a) => a.id}
            selected={selectedId}
            onRow={(a) => { setSelectedId(a.id); setTab('details'); }}
            empty="No subaccount admins"
            columns={[
              { label: 'Admin', render: (a) => <><div className="strong">{a.name}</div><div className="muted">{a.email}</div></> },
              { label: 'Workspaces', render: (a) => <div className="chips">{(a.workspaces || []).slice(0, 3).map((w) => <Badge key={w.id} tone="blue">{w.name}</Badge>)}{(a.workspaces?.length || 0) > 3 && <span className="muted">+{a.workspaces!.length - 3}</span>}</div> },
              { label: 'Devices (used/limit)', render: (a) => <Usage a={a} /> },
              { label: 'Status', render: (a) => <Status value={a.status} /> },
              { label: 'Created', render: (a) => <span className="muted">{when(a.created_at)}</span> },
            ]}
          />
          <Pager page={page} pages={pagination?.total_pages} total={pagination?.total} onPage={setPage} />
        </Card>
      </Split>
    </>
  );
}
