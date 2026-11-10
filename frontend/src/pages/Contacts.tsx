import { useCallback, useEffect, useMemo, useState } from 'react';
import { ext, ok, errorText } from '../api';
import type { ApiResult } from '../api';
import { useApp, go } from '../state';
import { contactName } from '../contacts';
import type { Contact } from '../contacts';
import { Badge, Button, Card, Empty, Field, Input, ResultBox, Select, when } from '../ui';
import { EndpointForm, Props, Tabs, useAction, useApi } from '../kit';

const LIMIT = 50;
const blank = { first_name: '', last_name: '', phone_number: '', email: '', company_name: '', tags: '' };

export default function Contacts() {
  const { workspaceId, workspace, toast } = useApp();
  const [rows, setRows] = useState<Contact[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const r = await ext('GET', '/contacts', { query: { workspace_id: workspaceId, limit: LIMIT, page } });
    setLoading(false);
    if (!ok(r)) {
      setRows([]);
      return toast(errorText(r), 'error');
    }
    setRows(Array.isArray(r.data?.data) ? r.data.data : []);
    setTotal(r.data?.pagination?.total ?? null);
  }, [workspaceId, page, toast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [workspaceId]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => [contactName(c), c.email, c.phone_number, c.company_name].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [rows, filter]);

  const create = async () => {
    if (!form.phone_number.trim() && !form.email.trim()) return toast('Give the contact a phone number or an email.', 'error');
    setBusy('create');
    const body: Record<string, unknown> = { workspace_id: workspaceId };
    for (const [k, v] of Object.entries(form)) if (v.trim() && k !== 'tags') body[k] = v.trim();
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length) body.tags = tags;
    const r = await ext('POST', '/contacts', { body });
    setResult(r);
    setBusy(null);
    if (!ok(r)) return toast(errorText(r), 'error');
    toast('Contact created.', 'ok');
    setForm(blank);
    load();
  };

  const remove = async (c: Contact) => {
    if (!window.confirm(`Delete ${contactName(c)}?`)) return;
    setBusy(`del-${c.id}`);
    const r = await ext('DELETE', `/contacts/${c.id}`);
    setResult(r);
    setBusy(null);
    if (!ok(r)) return toast(errorText(r), 'error');
    toast('Contact deleted.', 'ok');
    if (selectedId === c.id) setSelectedId(null);
    load();
  };

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const pages = total ? Math.max(1, Math.ceil(total / LIMIT)) : null;

  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)' }}>
      <Card
        title={`Contacts in ${workspace?.name || 'workspace'}${total !== null ? ` (${total})` : ''}`}
        actions={
          <>
            <Input placeholder="Filter this page…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200 }} />
            <Button variant="ghost" className="btn-sm" busy={loading} onClick={load}>Reload</Button>
          </>
        }
        pad={false}
      >
        {shown.length === 0 ? (
          <Empty title={loading ? 'Loading…' : 'No contacts'}>{!loading && 'Create one on the right.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Phone / email</th><th>Tags</th><th>Created</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className={`clickable ${selectedId === c.id ? 'selected' : ''}`} onClick={() => setSelectedId(c.id)}>
                    <td>
                      <div className="strong">{contactName(c)}</div>
                      <div className="muted">#{c.id}{c.company_name ? ` · ${c.company_name}` : ''}</div>
                    </td>
                    <td>
                      <div>{c.phone_number || '—'}</div>
                      <div className="muted">{c.email || ''}</div>
                    </td>
                    <td><div className="chips">{(c.tags || []).slice(0, 4).map((t) => <Badge key={t} tone="gray">{t}</Badge>)}</div></td>
                    <td className="muted">{when(c.created_at)}</td>
                    <td>
                      <div className="row row-end" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" className="btn-sm" onClick={() => go('/messages', { contact: c.id })}>Message</Button>
                        <Button variant="ghost" className="btn-sm" onClick={() => go('/calls', { contact: c.id })}>Call</Button>
                        <Button variant="danger" className="btn-sm" busy={busy === `del-${c.id}`} onClick={() => remove(c)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ padding: 12, justifyContent: 'space-between' }}>
          <span className="muted">Page {page}{pages ? ` of ${pages}` : ''}</span>
          <div className="row">
            <Button variant="ghost" className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="ghost" className="btn-sm" disabled={pages ? page >= pages : rows.length < LIMIT} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      </Card>

      {selectedId ? (
        <ContactPanel key={selectedId} id={selectedId} workspaceId={workspaceId!} onChanged={load} onClose={() => setSelectedId(null)} />
      ) : (
      <Card title="Create a contact">
        <div className="form-grid">
          <Field label="First name"><Input value={form.first_name} onChange={set('first_name')} /></Field>
          <Field label="Last name"><Input value={form.last_name} onChange={set('last_name')} /></Field>
        </div>
        <Field label="Phone" hint="International format, e.g. +61412345678"><Input value={form.phone_number} onChange={set('phone_number')} /></Field>
        <Field label="Email"><Input value={form.email} onChange={set('email')} /></Field>
        <Field label="Company"><Input value={form.company_name} onChange={set('company_name')} /></Field>
        <Field label="Tags" hint="Comma separated"><Input value={form.tags} onChange={set('tags')} placeholder="lead, demo" /></Field>
        <div className="row row-end"><Button busy={busy === 'create'} onClick={create}>Create contact</Button></div>
        <ResultBox result={result} />
      </Card>
      )}
    </div>
  );
}

type Side = 'details' | 'edit' | 'tags' | 'notes' | 'dnd';
const DND_CHANNELS = ['sms', 'whatsapp', 'imessage', 'rcs', 'email', 'calls'];

function ContactPanel({ id, workspaceId, onChanged, onClose }: { id: number; workspaceId: number; onChanged: () => void; onClose: () => void }) {
  const [side, setSide] = useState<Side>('details');
  const contact = useApi('get-contact', { path: { id } });
  const c = contact.data as (Contact & Record<string, any>) | undefined;
  const { act, busy, result } = useAction();
  const [imsg, setImsg] = useState<any>(null);
  const changed = () => {
    contact.reload();
    onChanged();
  };

  const checkImessage = async () => {
    const r = await act('check-imessage', { body: { workspace_id: workspaceId, contact_id: id } }, { key: 'imsg', done: 'iMessage checked.' });
    if (r) setImsg(r.data?.data ?? r.data);
  };

  return (
    <Card title={c ? contactName(c) : `Contact #${id}`} actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>New contact</Button>}>
      <div className="row">
        <span className="muted">#{id}</span>
        {c?.phone_number && <span>{c.phone_number}</span>}
        {c?.email && <span className="muted">{c.email}</span>}
        <Button variant="ghost" className="btn-sm" busy={busy === 'imsg'} onClick={checkImessage} style={{ marginLeft: 'auto' }}>Check iMessage</Button>
      </div>
      {imsg && (
        <div className={`notice ${imsg.available ? 'notice-ok' : 'notice-warn'}`}>
          {imsg.handle || 'This contact'}: <strong>{imsg.available ? 'reachable on iMessage' : 'not on iMessage'}</strong>
          {imsg.status ? ` (${imsg.status})` : ''}{imsg.silenced ? ' · notifications silenced' : ''}{imsg.focus_status ? ` · focus: ${imsg.focus_status}` : ''}
        </div>
      )}
      <Tabs value={side} onChange={setSide} tabs={[{ id: 'details', label: 'Details' }, { id: 'edit', label: 'Edit' }, { id: 'tags', label: 'Tags' }, { id: 'notes', label: 'Notes' }, { id: 'dnd', label: 'DND' }]} />
      {!c ? (
        <div className="muted">{contact.loading ? 'Loading…' : 'Could not load this contact.'}</div>
      ) : (
        <>
          {side === 'details' && <Props value={c} omit={['workspace_id', 'user_id', 'deleted_at']} />}
          {side === 'edit' && <EndpointForm slug="update-contact" path={{ id }} initial={c} changesOnly hide={['workspace_id']} submit="Save changes" onDone={changed} />}
          {side === 'tags' && <ContactTags id={id} tags={c.tags || []} onChanged={changed} />}
          {side === 'notes' && <ContactNotes id={id} />}
          {side === 'dnd' && <ContactDnd id={id} />}
        </>
      )}
      <ResultBox result={result} />
    </Card>
  );
}

function ContactTags({ id, tags, onChanged }: { id: number; tags: string[]; onChanged: () => void }) {
  const { act, busy } = useAction();
  const [add, setAdd] = useState('');
  const [resolution, setResolution] = useState('');
  const list = (v: string) => v.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="chips">
        {tags.length === 0 && <span className="muted">No tags.</span>}
        {tags.map((t) => (
          <span key={t} className="badge badge-blue">
            {t}
            <button type="button" className="linkish" title="Remove" disabled={busy === `rm-${t}`} onClick={() => act('remove-contact-tags', { path: { id }, body: { tags: [t] } }, { key: `rm-${t}`, done: `Removed “${t}”.`, onDone: onChanged })}>✕</button>
          </span>
        ))}
      </div>
      <Field label="Add tags" hint="Comma separated. A tag that belongs to an AI agent can replace the contact's current agent tag, or be skipped.">
        <Input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="vip, demo-booked" />
      </Field>
      <Field label="agent_tag_resolution">
        <Select value={resolution} onChange={(e) => setResolution(e.target.value)}>
          <option value="">— (default)</option>
          <option value="replace">replace</option>
          <option value="skip">skip</option>
        </Select>
      </Field>
      <div className="row row-end">
        <Button busy={busy === 'add'} disabled={!list(add).length} onClick={() => act('add-contact-tags', { path: { id }, body: { tags: list(add), agent_tag_resolution: resolution || undefined } }, { key: 'add', onDone: () => { setAdd(''); onChanged(); } })}>Add tags</Button>
      </div>
    </div>
  );
}

function ContactNotes({ id }: { id: number }) {
  const notes = useApi('list-contact-notes', { path: { id } });
  const { act, busy } = useAction();
  const [text, setText] = useState('');
  const rows = (notes.data?.notes || []) as { id: string; text: string; created_at?: string }[];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Field label="New note">
        <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Prefers WhatsApp after 5pm" />
      </Field>
      <div className="row row-end">
        <Button busy={busy === 'add'} disabled={!text.trim()} onClick={() => act('add-contact-note', { path: { id }, body: { text: text.trim() } }, { key: 'add', done: 'Note added.', onDone: () => { setText(''); notes.reload(); } })}>Add note</Button>
      </div>
      {rows.length === 0 && <div className="muted">{notes.loading ? 'Loading…' : 'No notes.'}</div>}
      {rows.map((n) => (
        <div key={n.id} className="ready-tile" style={{ display: 'grid', gap: 4 }}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">{when(n.created_at)}</span>
            <Button variant="danger" className="btn-sm" busy={busy === `del-${n.id}`} onClick={() => act('delete-contact-note', { path: { id, note_id: n.id } }, { key: `del-${n.id}`, confirm: 'Delete this note?', done: 'Note deleted.', onDone: notes.reload })}>Delete</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ContactDnd({ id }: { id: number }) {
  const dnd = useApi('get-contact-dnd', { path: { id } });
  const state = dnd.data?.dnd as Record<string, { all: boolean; channels: string[] }> | undefined;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!state ? (
        <div className="muted">{dnd.loading ? 'Loading…' : 'No DND data.'}</div>
      ) : (
        <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {(['outbound', 'inbound'] as const).map((dir) => {
            const d = state[dir] || { all: false, channels: [] };
            return (
              <div key={dir} className="ready-tile" style={{ display: 'grid', gap: 8 }}>
                <strong style={{ textTransform: 'capitalize' }}>{dir}</strong>
                {d.all ? (
                  <Badge tone="red">blocked on every channel</Badge>
                ) : (
                  <div className="chips">
                    {DND_CHANNELS.map((ch) => (
                      <Badge key={ch} tone={d.channels?.includes(ch) ? 'red' : 'green'}>{ch}: {d.channels?.includes(ch) ? 'DND' : 'allowed'}</Badge>
                    ))}
                    {(d.channels || []).filter((ch) => !DND_CHANNELS.includes(ch)).map((ch) => <Badge key={ch} tone="red">{ch}: DND</Badge>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <strong style={{ fontSize: 13 }}>Change DND</strong>
      <EndpointForm slug="set-contact-dnd" path={{ id }} submit="Set DND" onDone={dnd.reload} />
    </div>
  );
}
