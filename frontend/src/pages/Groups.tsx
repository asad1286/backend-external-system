import { useState } from 'react';
import { useApp } from '../state';
import { Badge, Button, Card, Field, Input, Select, Textarea, when } from '../ui';
import { DataTable, EndpointForm, Props, ScopeNote, Split, Status, Tabs, useAction, useApi, useContactChoices } from '../kit';

type Group = { id: string; channel: 'whatsapp' | 'imessage'; name?: string; participant_count?: number; is_active?: boolean; crm_bridged?: boolean; line_number?: string; last_synced_at?: string; updated_at?: string };

export default function Groups() {
  const { workspaceId } = useApp();
  const [channel, setChannel] = useState('');
  const [inactive, setInactive] = useState(false);
  const [selected, setSelected] = useState<Group | null>(null);
  const list = useApi('list-groups', { query: { workspace_id: workspaceId, channel: channel || undefined, include_inactive: inactive ? 1 : undefined } });
  const rows = list.rows as Group[];
  const { act, busy } = useAction();
  const [syncChannel, setSyncChannel] = useState('whatsapp');

  return (
    <>
      <ScopeNote scopes={['groups.read', 'groups.write']} />
      <Split
        side={
          selected ? (
            <GroupPanel key={`${selected.channel}:${selected.id}`} group={selected} onChanged={list.reload} onClose={() => { setSelected(null); list.reload(); }} />
          ) : (
            <CreateGroup workspaceId={workspaceId!} onDone={list.reload} />
          )
        }
      >
        <Card
          title={`Group chats (${rows.length})`}
          actions={<Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>}
          pad={false}
        >
          <div className="filters">
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">All channels</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="imessage">iMessage</option>
            </Select>
            <label className="check"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Include inactive</label>
            <span style={{ flex: 1 }} />
            <Select value={syncChannel} onChange={(e) => setSyncChannel(e.target.value)}>
              <option value="whatsapp">WhatsApp</option>
              <option value="imessage">iMessage</option>
            </Select>
            <Button variant="ghost" className="btn-sm" busy={busy === 'sync'} onClick={() => act('sync-groups', { body: { workspace_id: workspaceId, channel: syncChannel } }, { key: 'sync', onDone: list.reload })}>Sync groups</Button>
          </div>
          <DataTable
            rows={rows}
            loading={list.loading}
            rowKey={(g) => `${g.channel}:${g.id}`}
            selected={selected ? `${selected.channel}:${selected.id}` : null}
            onRow={setSelected}
            empty="No groups"
            columns={[
              { label: 'Name', render: (g) => <><div className="strong">{g.name || 'Unnamed group'}</div><div className="muted">{g.id}</div></> },
              { label: 'Channel', render: (g) => <Badge tone={g.channel === 'whatsapp' ? 'green' : 'blue'}>{g.channel}</Badge> },
              { label: 'People', render: (g) => g.participant_count ?? '—' },
              { label: 'Line', render: (g) => <span className="muted">{g.line_number || '—'}</span> },
              { label: 'State', render: (g) => <div className="chips">{g.is_active === false ? <Badge tone="red">inactive</Badge> : <Badge tone="green">active</Badge>}{g.crm_bridged ? <Badge tone="violet">CRM</Badge> : null}</div> },
              { label: 'Synced', render: (g) => <span className="muted">{when(g.last_synced_at)}</span> },
            ]}
          />
        </Card>
      </Split>
    </>
  );
}

function CreateGroup({ workspaceId, onDone }: { workspaceId: number; onDone: () => void }) {
  const contacts = useContactChoices(workspaceId);
  const [picked, setPicked] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const { act, busy, result } = useAction();
  const shown = contacts.filter((c) => c.label.toLowerCase().includes(filter.trim().toLowerCase()));
  const flip = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Card title="New iMessage group">
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Family chat" /></Field>
      <Field label={`Contacts (${picked.length} picked)`} hint="At least two.">
        <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 8, display: 'grid', gap: 4 }}>
          {shown.length === 0 && <span className="muted">No contacts.</span>}
          {shown.map((c) => (
            <label key={c.value} className="check"><input type="checkbox" checked={picked.includes(Number(c.value))} onChange={() => flip(Number(c.value))} /> {c.label}</label>
          ))}
        </div>
      </Field>
      <div className="row row-end">
        <Button
          busy={busy === 'create'}
          disabled={picked.length < 2}
          onClick={() => act('create-imessage-group', { body: { workspace_id: workspaceId, contact_ids: picked, name: name.trim() || undefined } }, { key: 'create', onDone: () => { setPicked([]); setName(''); onDone(); } })}
        >
          Create group
        </Button>
      </div>
      {result && <div className="muted">{result.data?.message}</div>}
    </Card>
  );
}

function GroupPanel({ group, onChanged, onClose }: { group: Group; onChanged: () => void; onClose: () => void }) {
  const path = { channel: group.channel, id: group.id };
  const detail = useApi('get-group', { path });
  const d = detail.data || group;
  const { act, busy } = useAction();
  const [tab, setTab] = useState<'details' | 'send' | 'edit'>('details');
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState('');
  const isIm = group.channel === 'imessage';
  const refresh = () => { detail.reload(); onChanged(); };

  return (
    <Card title={d.name || 'Group'} actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>New group</Button>}>
      <div className="row"><Badge tone={isIm ? 'blue' : 'green'}>{group.channel}</Badge><Status value={d.status || (d.is_active === false ? 'inactive' : 'active')} /><span className="muted">{d.participant_count ?? '?'} people</span></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'details', label: 'Details' }, { id: 'send', label: 'Send' }, { id: 'edit', label: 'Edit' }]} />

      {tab === 'details' && (
        <>
          <Props value={d} omit={['participants', 'workspace_id']} />
          <strong style={{ fontSize: 13 }}>Participants</strong>
          <div style={{ display: 'grid', gap: 6 }}>
            {(d.participants || []).length === 0 && <span className="muted">{detail.loading ? 'Loading…' : 'None listed.'}</span>}
            {(d.participants || []).map((p: any) => (
              <div key={p.handle} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{p.name || p.handle} <span className="muted">{p.name ? p.handle : ''}</span></span>
                {isIm && (
                  <Button variant="ghost" className="btn-sm" busy={busy === `rm-${p.handle}`} onClick={() => act('remove-group-participant', { path: { id: group.id }, body: { address: p.handle } }, { key: `rm-${p.handle}`, confirm: `Remove ${p.name || p.handle}?`, onDone: refresh })}>Remove</Button>
                )}
              </div>
            ))}
          </div>
          {isIm && (
            <div className="row">
              <Input placeholder="+61400000005 or email" value={address} onChange={(e) => setAddress(e.target.value)} style={{ flex: 1, width: 'auto' }} />
              <Button className="btn-sm" busy={busy === 'add'} disabled={!address.trim()} onClick={() => act('add-group-participant', { path: { id: group.id }, body: { address: address.trim() } }, { key: 'add', onDone: () => { setAddress(''); refresh(); } })}>Add</Button>
            </div>
          )}
          {isIm && (
            <div className="row row-end">
              <Button variant="danger" className="btn-sm" busy={busy === 'leave'} onClick={() => act('leave-group', { path: { id: group.id } }, { key: 'leave', confirm: 'Leave this group? The line stops getting its messages.', onDone: onClose })}>Leave group</Button>
            </div>
          )}
        </>
      )}

      {tab === 'send' && (
        <>
          <Field label="Message"><Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
          <Field label="Attachment URL" hint="Optional"><Input value={attachment} onChange={(e) => setAttachment(e.target.value)} placeholder="https://…" /></Field>
          <div className="row row-end">
            <Button
              busy={busy === 'send'}
              disabled={!message.trim() && !attachment.trim()}
              onClick={() => act('send-group-message', { path, body: { message: message.trim() || undefined, attachments: attachment.trim() || undefined } }, { key: 'send', done: 'Sent to the group.', onDone: () => { setMessage(''); setAttachment(''); } })}
            >
              Send to group
            </Button>
          </div>
        </>
      )}

      {tab === 'edit' && <EndpointForm slug="update-group" path={path} initial={d} changesOnly submit="Save changes" onDone={refresh} />}
    </Card>
  );
}
