import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Badge, Button, Card, Input, Select, when } from '../ui';
import { EndpointForm, Props, ScopeNote, Split, Status, Tabs, personName, useAction, useApi, useContactChoices } from '../kit';

type Calendar = { id: number; name: string; description?: string; color?: string; timezone?: string; slot_duration_minutes?: number; location_type?: string; is_public?: boolean };
type Appt = { id: number; calendar_id: number; calendar?: { id: number; name: string; color?: string }; contact_id: number; contact?: any; title?: string; start_at: string; end_at?: string; timezone?: string; status: string; meeting_link?: string; location_text?: string | null };

const DAY = 86400000;
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
};
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');
const dateInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function Appointments() {
  const { workspaceId } = useApp();
  const calendars = useApi('list-calendars', { query: { workspace_id: workspaceId } });
  const contacts = useContactChoices(workspaceId);
  const [calendarId, setCalendarId] = useState<number | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [status, setStatus] = useState('all');
  const [contactId, setContactId] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bookInitial, setBookInitial] = useState<Record<string, unknown>>({});

  const from = weekStart.toISOString();
  const to = new Date(weekStart.getTime() + 7 * DAY - 1000).toISOString();
  const list = useApi('list-appointments', {
    query: { workspace_id: workspaceId, from, to, calendar_id: calendarId ?? undefined, contact_id: contactId || undefined, status, limit: 100 },
  });
  const rows = list.rows as Appt[];
  const cals = calendars.rows as Calendar[];

  const byDay = useMemo(() => {
    const groups = new Map<string, Appt[]>();
    for (const a of [...rows].sort((x, y) => x.start_at.localeCompare(y.start_at))) {
      const k = new Date(a.start_at).toDateString();
      groups.set(k, [...(groups.get(k) || []), a]);
    }
    return [...groups.values()];
  }, [rows]);

  const weekText = `${weekStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(weekStart.getTime() + 6 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <>
      <ScopeNote scopes={['appointments.read', 'appointments.write']} />
      <Card title={`Calendars (${cals.length})`} actions={<Button variant="ghost" className="btn-sm" busy={calendars.loading} onClick={calendars.reload}>Reload</Button>}>
        {!cals.length ? (
          <div className="muted">{calendars.loading ? 'Loading…' : 'No calendars in this workspace — create one in the myCRMSIM dashboard.'}</div>
        ) : (
          <div className="chips">
            <Button variant={calendarId === null ? 'primary' : 'ghost'} className="btn-sm" onClick={() => setCalendarId(null)}>All calendars</Button>
            {cals.map((c) => (
              <Button key={c.id} variant={calendarId === c.id ? 'primary' : 'ghost'} className="btn-sm" onClick={() => setCalendarId(c.id)} title={`${c.timezone || ''} · ${c.slot_duration_minutes || '?'} min slots`}>
                <span className="swatch" style={{ background: c.color || 'var(--brand)' }} /> {c.name}
              </Button>
            ))}
          </div>
        )}
      </Card>

      <Split
        side={
          selectedId ? (
            <ApptPanel key={selectedId} id={selectedId} onChanged={list.reload} onClose={() => setSelectedId(null)} />
          ) : (
            <>
              <Card title="Book an appointment">
                <EndpointForm
                  slug="book-appointment"
                  fixed={{ workspace_id: workspaceId }}
                  initial={{ calendar_id: calendarId ?? undefined, ...bookInitial }}
                  choices={{ calendar_id: cals.map((c) => ({ value: c.id, label: c.name })), contact_id: contacts }}
                  hide={['assignee_id']}
                  submit="Book appointment"
                  onDone={(r) => {
                    list.reload();
                    setBookInitial({});
                    if (r.data?.data?.id) setSelectedId(r.data.data.id);
                  }}
                />
              </Card>
              <FreeSlots calendars={cals} calendarId={calendarId} onPick={(cal, iso, tz) => setBookInitial({ calendar_id: cal, start_at: iso, timezone: tz })} />
              <ContactAppointments contacts={contacts} onOpen={setSelectedId} />
            </>
          )
        }
      >
        <Card
          title={
            <div className="row">
              <Button variant="ghost" className="btn-sm" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY))}>‹</Button>
              <span>{weekText}</span>
              <Button variant="ghost" className="btn-sm" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY))}>›</Button>
              <Button variant="ghost" className="btn-sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</Button>
            </div>
          }
          actions={<Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>}
          pad={false}
        >
          <div className="filters">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {['all', 'confirmed', 'cancelled', 'no_show', 'completed'].map((s) => <option key={s} value={s}>{s === 'all' ? 'Any status' : s}</option>)}
            </Select>
            <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">Any contact</option>
              {contacts.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
            <span className="muted">{rows.length} appointment{rows.length === 1 ? '' : 's'}</span>
          </div>
          {!rows.length ? (
            <div className="empty"><strong>{list.loading ? 'Loading…' : 'Nothing booked this week'}</strong></div>
          ) : (
            <div style={{ display: 'grid', gap: 4, padding: '6px 0' }}>
              {byDay.map((day) => (
                <div key={day[0].start_at}>
                  <div className="ep-group">{dayLabel(day[0].start_at)}</div>
                  {day.map((a) => (
                    <div
                      key={a.id}
                      onClick={() => setSelectedId(a.id)}
                      className="row"
                      style={{ padding: '9px 14px', cursor: 'pointer', background: a.id === selectedId ? 'var(--brand-soft)' : undefined, borderBottom: '1px solid var(--line)' }}
                    >
                      <span className="swatch" style={{ background: a.calendar?.color || 'var(--brand)' }} />
                      <span style={{ width: 110, fontVariantNumeric: 'tabular-nums' }}>{time(a.start_at)}{a.end_at ? `–${time(a.end_at)}` : ''}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="strong">{a.title || 'Appointment'}</span>
                        <span className="muted"> · {personName(a.contact)} · {a.calendar?.name || `calendar #${a.calendar_id}`}</span>
                      </span>
                      <Status value={a.status} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>
      </Split>
    </>
  );
}

function ApptPanel({ id, onChanged, onClose }: { id: number; onChanged: () => void; onClose: () => void }) {
  const one = useApi('get-appointment', { path: { id } });
  const { act, busy } = useAction();
  const [tab, setTab] = useState<'details' | 'reschedule'>('details');
  const [reason, setReason] = useState('');
  const a = one.data as Appt | undefined;
  const changed = () => {
    one.reload();
    onChanged();
  };

  return (
    <Card title={a ? a.title || `Appointment #${a.id}` : 'Appointment'} actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>Book new</Button>}>
      {!a ? (
        <div className="muted">{one.loading ? 'Loading…' : 'Could not load it.'}</div>
      ) : (
        <>
          <div className="row">
            <Status value={a.status} />
            <strong>{when(a.start_at)}</strong>
            <span className="muted">· {personName(a.contact)}</span>
          </div>
          {a.meeting_link && <a href={a.meeting_link} target="_blank" rel="noreferrer">Join meeting</a>}
          <div className="row">
            <Button variant="success" className="btn-sm" disabled={a.status === 'completed'} busy={busy === 'done'} onClick={() => act('mark-appointment-completed', { path: { id } }, { key: 'done', onDone: changed })}>Mark completed</Button>
            <Button variant="ghost" className="btn-sm" disabled={a.status === 'no_show'} busy={busy === 'ns'} onClick={() => act('mark-appointment-no-show', { path: { id } }, { key: 'ns', onDone: changed })}>Mark no-show</Button>
          </div>
          <div className="row">
            <Input placeholder="Cancel reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, width: 'auto' }} />
            <Button variant="danger" className="btn-sm" disabled={a.status === 'cancelled'} busy={busy === 'cancel'} onClick={() => act('cancel-appointment', { path: { id }, body: { reason: reason.trim() || undefined } }, { key: 'cancel', confirm: 'Cancel this appointment?', onDone: changed })}>Cancel</Button>
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'details', label: 'Details' }, { id: 'reschedule', label: 'Reschedule / edit' }]} />
          {tab === 'details' ? (
            <Props value={a} omit={['contact', 'calendar', 'workspace_id']} />
          ) : (
            <EndpointForm slug="update-appointment" path={{ id }} initial={a as unknown as Record<string, unknown>} changesOnly hide={['assignee_id']} submit="Save changes" onDone={changed} />
          )}
        </>
      )}
    </Card>
  );
}

function FreeSlots({ calendars, calendarId, onPick }: { calendars: Calendar[]; calendarId: number | null; onPick: (calendar: number, iso: string, tz?: string) => void }) {
  const [cal, setCal] = useState<string>(calendarId ? String(calendarId) : '');
  const [start, setStart] = useState(() => dateInput(new Date()));
  const [end, setEnd] = useState(() => dateInput(new Date(Date.now() + 7 * DAY)));
  const [req, setReq] = useState<any>(null);
  const slots = useApi('get-free-slots', req);
  const data = slots.data as { timezone?: string; slot_duration_minutes?: number; slots?: { date: string; times: string[] }[] } | undefined;
  const chosen = cal || (calendarId ? String(calendarId) : '');

  return (
    <Card title="Free slots">
      <div className="form-grid">
        <Select value={chosen} onChange={(e) => setCal(e.target.value)}>
          <option value="">Pick a calendar</option>
          {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="row row-end">
        <Button className="btn-sm" busy={slots.loading} disabled={!chosen} onClick={() => {
            const next = { path: { id: Number(chosen) }, query: { start: new Date(`${start}T00:00:00`).toISOString(), end: new Date(`${end}T23:59:59`).toISOString() } };
            if (JSON.stringify(next) === JSON.stringify(req)) slots.reload();
            else setReq(next);
          }}>Find slots</Button>
      </div>
      {data && (
        <>
          <div className="muted">{data.timezone} · {data.slot_duration_minutes} min · click a time to put it in the booking form</div>
          {!data.slots?.length && <div className="muted">No free slots in that range.</div>}
          {data.slots?.map((d) => (
            <div key={d.date}>
              <div className="strong" style={{ fontSize: 13, marginBottom: 4 }}>{dayLabel(`${d.date}T12:00:00`)}</div>
              <div className="chips">
                {d.times.map((t) => (
                  <Button key={t} variant="ghost" className="btn-sm" onClick={() => onPick(Number(chosen), t, data.timezone)}>{time(t)}</Button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

function ContactAppointments({ contacts, onOpen }: { contacts: { value: string | number; label: string }[]; onOpen: (id: number) => void }) {
  const [contact, setContact] = useState('');
  const res = useApi('list-contact-appointments', contact ? { path: { id: contact } } : null);
  const data = res.data as { upcoming?: Appt[]; past?: Appt[] } | undefined;
  const section = (label: string, list?: Appt[]) => (
    <div>
      <div className="strong" style={{ fontSize: 13, marginBottom: 4 }}>{label} ({list?.length ?? 0})</div>
      {!list?.length ? (
        <div className="muted">None.</div>
      ) : (
        list.map((a) => (
          <div key={a.id} className="row" style={{ padding: '4px 0', cursor: 'pointer' }} onClick={() => onOpen(a.id)}>
            <span style={{ flex: 1 }}>{when(a.start_at)} · {a.title || 'Appointment'}</span>
            <Badge tone="gray">{a.calendar?.name || `#${a.calendar_id}`}</Badge>
            <Status value={a.status} />
          </div>
        ))
      )}
    </div>
  );
  return (
    <Card title="A contact's appointments">
      <Select value={contact} onChange={(e) => setContact(e.target.value)}>
        <option value="">Pick a contact</option>
        {contacts.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </Select>
      {contact && (res.loading && !data ? <div className="muted">Loading…</div> : <>{section('Upcoming', data?.upcoming)}{section('Past', data?.past)}</>)}
    </Card>
  );
}
