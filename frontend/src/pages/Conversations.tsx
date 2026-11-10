import { useEffect, useRef, useState } from 'react';
import { useApp, go } from '../state';
import { Badge, Button, Card, Input, Select, clock, when } from '../ui';
import { DataTable, Pager, ScopeNote, Split, useAction, useApi } from '../kit';

type Convo = { contact_id: number; name?: string; phone?: string; is_group?: boolean; channels?: string[]; last_message?: string; last_message_at?: string; unread_count?: number; is_read?: boolean; is_starred?: boolean; is_archived?: boolean };
type Msg = { id: number; direction: 'inbound' | 'outbound'; channel: string; status: string; message?: string | null; attachments?: any[]; error_message?: string | null; created_at: string };

const LIMIT = 25;
const yesNo = (v: string) => (v === '' ? undefined : v === 'true');

export default function Conversations({ params }: { params: URLSearchParams }) {
  const { workspaceId, onEvent } = useApp();
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState('');
  const [starred, setStarred] = useState('');
  const [archived, setArchived] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(Number(params.get('contact')) || null);

  const list = useApi('list-conversations', {
    query: { workspace_id: workspaceId, page, limit: LIMIT, search: search.trim() || undefined, unread: yesNo(unread), starred: yesNo(starred), archived: yesNo(archived) },
  });
  const rows = list.rows as Convo[];
  const pagination = list.raw?.pagination;
  const selected = rows.find((c) => c.contact_id === selectedId) || null;

  const [tick, setTick] = useState(0);
  const soon = useRef<number>();
  useEffect(
    () =>
      onEvent((e) => {
        if (e.type !== 'message.inbound' && e.type !== 'message.status') return;
        window.clearTimeout(soon.current);
        soon.current = window.setTimeout(() => {
          list.reload();
          setTick((t) => t + 1);
        }, 800);
      }),
    [onEvent, list.reload],
  );

  const filter = (label: string, value: string, set: (v: string) => void) => (
    <Select value={value} onChange={(e) => { set(e.target.value); setPage(1); }}>
      <option value="">{label}: any</option>
      <option value="true">{label}: yes</option>
      <option value="false">{label}: no</option>
    </Select>
  );

  return (
    <>
      <ScopeNote scopes={['conversations.read', 'conversations.write']} />
      <Split
        wide
        side={
          selectedId ? (
            <Thread key={selectedId} contactId={selectedId} convo={selected} tick={tick} onChanged={list.reload} />
          ) : (
            <Card title="Conversation">
              <div className="muted">Pick a conversation on the left to read the thread and change its state.</div>
            </Card>
          )
        }
      >
        <Card
          title={`Conversations${pagination?.total != null ? ` (${pagination.total})` : ''}`}
          actions={<>{pagination?.unread_total ? <Badge tone="amber">{pagination.unread_total} unread</Badge> : null}<Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button></>}
          pad={false}
        >
          <div className="filters">
            <Input placeholder="Search name, phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            {filter('Unread', unread, setUnread)}
            {filter('Starred', starred, setStarred)}
            {filter('Archived', archived, setArchived)}
          </div>
          <DataTable
            rows={rows}
            loading={list.loading}
            rowKey={(c) => c.contact_id}
            selected={selectedId}
            onRow={(c) => setSelectedId(c.contact_id)}
            empty="No conversations"
            columns={[
              {
                label: 'Contact',
                render: (c) => (
                  <>
                    <div className="strong">
                      {c.is_starred ? '★ ' : ''}
                      {c.name || c.phone || `#${c.contact_id}`}
                      {c.is_group ? <> <Badge tone="violet">group</Badge></> : null}
                    </div>
                    <div className="muted">{c.phone || ''}</div>
                  </>
                ),
              },
              { label: 'Last message', render: (c) => <span className="muted" style={{ display: 'block', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last_message || '—'}</span> },
              { label: 'Channels', render: (c) => <div className="chips">{(c.channels || []).map((ch) => <Badge key={ch} tone="blue">{ch}</Badge>)}</div> },
              { label: 'Unread', render: (c) => (c.unread_count ? <Badge tone="amber">{c.unread_count}</Badge> : <span className="muted">0</span>) },
              { label: 'When', render: (c) => <span className="muted">{when(c.last_message_at)}</span> },
            ]}
          />
          <Pager page={page} pages={pagination?.total_pages} total={pagination?.total} onPage={setPage} />
        </Card>
      </Split>
    </>
  );
}

function Thread({ contactId, convo, tick, onChanged }: { contactId: number; convo: Convo | null; tick: number; onChanged: () => void }) {
  const [page, setPage] = useState(1);
  const messages = useApi('list-conversation-messages', { path: { contact_id: contactId }, query: { page, limit: 50 } });
  const state = useApi('get-conversation-state', { path: { contact_id: contactId } });
  const first = useRef(tick);
  useEffect(() => {
    if (tick === first.current) return;
    messages.reload();
    state.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  const { act, busy } = useAction();
  const end = useRef<HTMLDivElement>(null);

  const list = ([...(messages.data?.messages || [])] as Msg[]).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const pagination = messages.raw?.pagination;
  useEffect(() => {
    if (page === 1) end.current?.scrollIntoView({ block: 'nearest' });
  }, [list.length, page]);

  const st = state.data || {};
  const toggle = (field: string, label: string) => {
    const on = Boolean(st[field]);
    return (
      <Button
        key={field}
        variant={on ? 'primary' : 'ghost'}
        className="btn-sm"
        busy={busy === field}
        onClick={() => act('update-conversation-state', { path: { contact_id: contactId }, body: { [field]: !on } }, { key: field, done: `${label}: ${on ? 'off' : 'on'}`, onDone: () => { state.reload(); onChanged(); } })}
      >
        {on ? '✓ ' : ''}{label}
      </Button>
    );
  };

  return (
    <Card
      title={convo?.name || convo?.phone || `Contact #${contactId}`}
      actions={<Button className="btn-sm" onClick={() => go('/messages', { contact: contactId })}>Reply in Messages</Button>}
      pad={false}
    >
      <div className="filters">
        {toggle('is_unread', 'Unread')}
        {toggle('is_starred', 'Starred')}
        {toggle('is_archived', 'Archived')}
        {toggle('is_ai_paused', 'AI paused')}
        {st.dnd && (st.dnd.outbound || st.dnd.inbound) ? <Badge tone="red">DND</Badge> : null}
      </div>
      {pagination && pagination.total_pages > page && (
        <div style={{ padding: '8px 14px 0' }}>
          <Button variant="ghost" className="btn-sm" onClick={() => setPage(page + 1)}>Older messages</Button>
        </div>
      )}
      {page > 1 && (
        <div style={{ padding: '8px 14px 0' }}>
          <Button variant="ghost" className="btn-sm" onClick={() => setPage(page - 1)}>Newer messages</Button>
        </div>
      )}
      <div className="thread">
        {list.length === 0 && <div className="muted">{messages.loading ? 'Loading…' : 'No messages.'}</div>}
        {list.map((m) => (
          <div key={m.id} className={`bubble ${m.direction === 'outbound' ? 'out' : 'in'}`}>
            {m.message || (m.attachments?.length ? '' : <i>(empty)</i>)}
            {(m.attachments || []).map((a: any, i: number) => {
              const url = typeof a === 'string' ? a : a?.url;
              return url ? <div key={i}><a href={url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>📎 {url.split('/').pop()}</a></div> : null;
            })}
            <small>
              {m.channel} · {m.status} · {clock(m.created_at)}
              {m.error_message ? ` · ${m.error_message}` : ''}
            </small>
          </div>
        ))}
        <div ref={end} />
      </div>
    </Card>
  );
}
