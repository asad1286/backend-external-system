import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ext, ok, errorText } from '../api';
import type { ApiResult } from '../api';
import { useApp } from '../state';
import { contactName, useContactPicker } from '../contacts';
import { Badge, Button, Card, Empty, Field, Input, Json, ResultBox, Select, Textarea, when } from '../ui';
import { DataTable, EndpointForm, Pager, Status, Tabs, endpoint, useAction, useApi, useContactChoices } from '../kit';

const EFFECTS = endpoint('send-message').params.find((p) => p.name === 'effect')?.enum || [];
const REACTIONS = endpoint('react-to-message').params.find((p) => p.name === 'reaction')?.enum || [];

type Message = {
  id: number;
  channel: string;
  contact_id?: number | null;
  direction: 'inbound' | 'outbound';
  to?: string | null;
  from?: string | null;
  text?: string | null;
  media?: { url: string }[] | null;
  status: string;
  error_message?: string | null;
  created_at: string;
};

const CHANNELS = [
  { value: 'default', label: 'Automatic (Message Routing)' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'imessage', label: 'iMessage' },
  { value: 'rcs', label: 'RCS' },
];

export default function Messages({ params }: { params: URLSearchParams }) {
  const [view, setView] = useState<'send' | 'scheduled'>('send');
  return (
    <>
      <Tabs value={view} onChange={setView} tabs={[{ id: 'send', label: 'Send & recent' }, { id: 'scheduled', label: 'Scheduled' }]} />
      {view === 'send' ? <SendAndRecent params={params} /> : <Scheduled />}
    </>
  );
}

function SendAndRecent({ params }: { params: URLSearchParams }) {
  const { workspaceId, workspace, toast, onEvent } = useApp();
  const { contacts } = useContactPicker(workspaceId);
  const [to, setTo] = useState<'contact' | 'phone'>('contact');
  const [contactId, setContactId] = useState(params.get('contact') || '');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('default');
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [sentBody, setSentBody] = useState<Record<string, unknown> | null>(null);
  const [list, setList] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyContact, setOnlyContact] = useState(false);
  const [live, setLive] = useState<Record<number, string>>({});
  const [effect, setEffect] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  // The workspace's devices (GET /send-from-options); "" = Automatic. A device picks the channel.
  const sendFromList = useApi('list-send-from-options', workspaceId ? { query: { workspace_id: workspaceId } } : null, { quiet: true });
  const sendFromOptions: { label: string; value: string; channel: string | null }[] = Array.isArray(sendFromList.data) ? sendFromList.data : [];
  const [sendFrom, setSendFrom] = useState('');
  useEffect(() => setSendFrom(''), [workspaceId]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const r = await ext('GET', '/messages', { query: { workspace_id: workspaceId, sort: 'created_at_desc', limit: 50 } });
    setLoading(false);
    if (ok(r)) setList(Array.isArray(r.data?.data?.messages) ? r.data.data.messages : []);
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  // message.status / message.inbound on the Callback URL: update the row, reload on a new message.
  const reloadSoon = useRef<number>();
  useEffect(
    () =>
      onEvent((e) => {
        if (e.type === 'message.status' && e.body?.message_id) setLive((m) => ({ ...m, [Number(e.body.message_id)]: e.body.status }));
        if (e.type === 'message.inbound' || e.type === 'message.status') {
          window.clearTimeout(reloadSoon.current);
          reloadSoon.current = window.setTimeout(load, 800);
        }
      }),
    [onEvent, load],
  );

  const send = async () => {
    if (!text.trim() && !attachment.trim()) return toast('Write a message or add an attachment URL.', 'error');
    // Both optional and independent: "default" channel and Automatic Send From are left out.
    const body: Record<string, unknown> = { workspace_id: workspaceId, message: text };
    if (channel && channel !== 'default') body.channel = channel;
    if (sendFrom) body.send_from = sendFrom;
    if (to === 'contact') {
      if (!contactId) return toast('Pick a contact.', 'error');
      body.contact_id = Number(contactId);
    } else {
      if (!phone.trim()) return toast('Enter a phone number.', 'error');
      body.phone = phone.trim();
    }
    if (attachment.trim()) body.attachments = attachment.trim();
    if (effect) body.effect = effect;
    if (replyTo.trim()) body.reply_to = Number(replyTo);
    setBusy(true);
    const r = await ext('POST', '/messages', { body });
    setBusy(false);
    setSentBody(body);
    setResult(r);
    if (!ok(r)) return toast(errorText(r), 'error');
    toast(`Sent · message #${r.data?.data?.id} (${r.data?.data?.status})`, 'ok');
    setText('');
    setAttachment('');
    setReplyTo('');
    load();
  };

  const shown = onlyContact && contactId ? list.filter((m) => String(m.contact_id) === String(contactId)) : list;

  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(320px, 1fr) minmax(0, 1.6fr)' }}>
      <Card title="Send a message">
        <div className="tabs">
          <button className={`tab ${to === 'contact' ? 'active' : ''}`} onClick={() => setTo('contact')}>To a contact</button>
          <button className={`tab ${to === 'phone' ? 'active' : ''}`} onClick={() => setTo('phone')}>To a number</button>
        </div>
        {to === 'contact' ? (
          <Field label="Contact" hint={`${contacts.length} contacts in ${workspace?.name || 'this workspace'}`}>
            <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">Choose…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{contactName(c)} {c.phone_number ? `· ${c.phone_number}` : ''}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Phone number"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+61412345678" /></Field>
        )}
        <Field label="Send from" hint={sendFromList.loading ? 'Loading devices…' : `${Math.max(sendFromOptions.length - 1, 0)} devices in this workspace`}>
          <Select value={sendFrom} onChange={(e) => setSendFrom(e.target.value)}>
            {(sendFromOptions.length ? sendFromOptions : [{ label: 'Automatic (assigned user / default device)', value: '', channel: null }]).map((o) => (
              <option key={o.value || 'auto'} value={o.value}>{o.channel ? `[${o.channel}] ` : ''}{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Channel">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Message"><Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Hi! Thanks for your enquiry…" /></Field>
        <Field label="Attachment URL" hint="Optional: a public file URL (image, PDF…)"><Input value={attachment} onChange={(e) => setAttachment(e.target.value)} placeholder="https://…" /></Field>
        <div className="form-grid">
          <Field label="iMessage effect" hint="iMessage only, Mac in Advanced Mode.">
            <Select value={effect} onChange={(e) => setEffect(e.target.value)}>
              <option value="">None</option>
              {EFFECTS.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          </Field>
          <Field label="Reply to message id" hint="iMessage threaded reply.">
            <Input type="number" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="84214" />
          </Field>
        </div>
        <div className="row row-end"><Button busy={busy} onClick={send}>Send</Button></div>
        <ResultBox result={result} request={sentBody ? { method: 'POST', path: '/messages', body: sentBody } : null} />
      </Card>

      <Card
        title="Recent messages"
        actions={
          <>
            {contactId && (
              <label className="check"><input type="checkbox" checked={onlyContact} onChange={(e) => setOnlyContact(e.target.checked)} /> Only this contact</label>
            )}
            <Button variant="ghost" className="btn-sm" busy={loading} onClick={load}>Reload</Button>
          </>
        }
        pad={false}
      >
        {shown.length === 0 ? (
          <Empty title={loading ? 'Loading…' : 'No messages yet'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Message</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shown.map((m) => {
                  const status = live[m.id] || m.status;
                  return (
                    <Fragment key={m.id}>
                    <tr className={openId === m.id ? 'selected' : ''}>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(m.created_at)}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <Badge>{m.direction}</Badge>
                          <Badge tone="gray">{m.channel}</Badge>
                        </div>
                        <div className="muted">{m.direction === 'inbound' ? m.from : m.to}</div>
                      </td>
                      <td style={{ maxWidth: 360 }}>
                        <div>{m.text || <span className="muted">(no text)</span>}</div>
                        {m.media?.length ? <div className="muted">{m.media.length} attachment(s)</div> : null}
                        {m.error_message && <div style={{ color: 'var(--red)', fontSize: 12 }}>{m.error_message}</div>}
                      </td>
                      <td>
                        <Badge>{status}</Badge>
                        {live[m.id] && <div className="muted">live</div>}
                      </td>
                      <td>
                        <Button variant="ghost" className="btn-sm" onClick={() => setOpenId(openId === m.id ? null : m.id)}>{openId === m.id ? 'Close' : 'Actions'}</Button>
                      </td>
                    </tr>
                    {openId === m.id && (
                      <tr>
                        <td colSpan={5}>
                          <MessageActions m={m} workspaceId={workspaceId!} onReply={() => { setReplyTo(String(m.id)); if (m.contact_id) { setTo('contact'); setContactId(String(m.contact_id)); } }} onChanged={load} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function MessageActions({ m, workspaceId, onReply, onChanged }: { m: Message; workspaceId: number; onReply: () => void; onChanged: () => void }) {
  const { act, busy, result } = useAction();
  const [status, setStatus] = useState<any>(null);
  const [reaction, setReaction] = useState(REACTIONS[0] || 'love');
  const [edit, setEdit] = useState(m.text || '');
  const out = m.direction === 'outbound';
  const ws = { workspace_id: workspaceId };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="row">
        <Button variant="ghost" className="btn-sm" busy={busy === 'status'} onClick={async () => { const r = await act('get-message', { path: { id: m.id } }, { key: 'status', done: 'Status loaded.' }); if (r) setStatus(r.data?.data ?? null); }}>Get status</Button>
        <Select value={reaction} onChange={(e) => setReaction(e.target.value)} style={{ width: 130 }}>
          {REACTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
        </Select>
        <Button variant="ghost" className="btn-sm" busy={busy === 'react'} onClick={() => act('react-to-message', { path: { id: m.id }, body: { ...ws, reaction } }, { key: 'react', onDone: onChanged })}>React</Button>
        <Button variant="ghost" className="btn-sm" onClick={onReply}>Reply in thread</Button>
        {out && <Button variant="ghost" className="btn-sm" busy={busy === 'notify'} onClick={() => act('notify-anyway', { path: { id: m.id }, body: ws }, { key: 'notify', onDone: onChanged })}>Notify anyway</Button>}
        {out && <Button variant="danger" className="btn-sm" busy={busy === 'unsend'} onClick={() => act('unsend-message', { path: { id: m.id }, body: ws }, { key: 'unsend', confirm: 'Unsend this message? (iMessage, within 2 minutes)', onDone: onChanged })}>Unsend</Button>}
      </div>
      {out && (
        <div className="row">
          <Input value={edit} onChange={(e) => setEdit(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <Button variant="ghost" className="btn-sm" busy={busy === 'edit'} disabled={!edit.trim() || edit === m.text} onClick={() => act('edit-message', { path: { id: m.id }, body: { ...ws, message: edit.trim() } }, { key: 'edit', onDone: onChanged })}>Edit text</Button>
        </div>
      )}
      <div className="muted">React, reply, edit, unsend and notify anyway are iMessage features (Mac in Advanced Mode); other channels answer with an error.</div>
      {status && <Json value={status} max={200} />}
      <ResultBox result={result} />
    </div>
  );
}

const SCHED_LIMIT = 25;

function Scheduled() {
  const { workspaceId } = useApp();
  const contacts = useContactChoices(workspaceId);
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const list = useApi('list-scheduled-messages', { query: { workspace_id: workspaceId, status, page, limit: SCHED_LIMIT } });
  const { act, busy } = useAction();
  const pg = list.raw?.pagination;
  const name = (id?: number | null) => contacts.find((c) => String(c.value) === String(id))?.label;

  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(320px, 1fr) minmax(0, 1.6fr)' }}>
      <Card title="Schedule a message">
        <EndpointForm slug="schedule-message" fixed={{ workspace_id: workspaceId }} choices={{ contact_id: contacts }} only={['contact_id', 'phone', 'email', 'channel', 'message', 'attachments', 'send_at', 'effect']} submit="Schedule" onDone={list.reload} />
      </Card>
      <Card
        title={`Scheduled messages${pg?.total != null ? ` (${pg.total})` : ''}`}
        actions={
          <>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 140 }}>
              {['pending', 'sent', 'failed', 'cancelled', 'all'].map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
            <Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>
          </>
        }
        pad={false}
      >
        <DataTable
          rows={list.rows as any[]}
          loading={list.loading}
          rowKey={(r) => r.id}
          empty="Nothing scheduled"
          columns={[
            { label: 'Send at', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{when(r.send_at)}</span> },
            { label: 'To', render: (r) => <><div>{name(r.contact_id) || r.to || '—'}</div>{r.channel && <Badge tone="gray">{r.channel}</Badge>}</> },
            { label: 'Message', render: (r) => <div style={{ maxWidth: 320 }}>{r.message || <span className="muted">(attachment)</span>}{r.error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{r.error}</div>}</div> },
            { label: 'Status', render: (r) => <><Status value={r.status} />{r.sent_message_id && <div className="muted">msg #{r.sent_message_id}</div>}</> },
            { label: '', render: (r) => (r.status === 'pending' ? <Button variant="danger" className="btn-sm" busy={busy === `c-${r.id}`} onClick={() => act('cancel-scheduled-message', { path: { id: r.id } }, { key: `c-${r.id}`, confirm: 'Cancel this scheduled message?', done: 'Cancelled.', onDone: list.reload })}>Cancel</Button> : null) },
          ]}
        />
        <Pager page={page} pages={pg?.total_pages} total={pg?.total} onPage={setPage} />
      </Card>
    </div>
  );
}
