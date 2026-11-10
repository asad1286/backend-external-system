import { Fragment, useEffect, useMemo, useState } from 'react';
import { backend } from '../api';
import { useApp } from '../state';
import type { WebhookEvent } from '../state';
import { Badge, Button, Card, Copy, Empty, Json, Notice, Select, when } from '../ui';

type RequestEntry = { at: string; method: string; path: string; status: number; ms: number };

const summary = (e: WebhookEvent) => {
  const b = e.body || {};
  if (e.type === 'call.status') return `${b.channel || 'call'} ${b.direction || ''} → ${b.status}${b.reason ? ` (${b.reason})` : ''}${b.duration_seconds ? ` · ${b.duration_seconds}s` : ''}`;
  if (e.type === 'call.incoming') return `${b.channel} call from ${b.from_name || b.from}`;
  if (e.type === 'message.status') return `#${b.message_id} ${b.channel} → ${b.status}${b.error_message ? ` (${b.error_message})` : ''}`;
  if (e.type === 'message.inbound') return `${b.channel} from ${b.phone}: ${String(b.message || '').slice(0, 80)}`;
  return '';
};

export default function Events() {
  const { events, setEvents, session, live } = useApp();
  const [tab, setTab] = useState<'callbacks' | 'requests'>('callbacks');
  const [type, setType] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestEntry[]>([]);

  useEffect(() => {
    if (tab !== 'requests') return;
    const load = () => backend<RequestEntry[]>('GET', '/api/requests').then(setRequests).catch(() => {});
    load();
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, [tab]);

  const types = useMemo(() => [...new Set(events.map((e) => e.type))], [events]);
  const shown = type ? events.filter((e) => e.type === type) : events;

  const clear = async () => {
    if (!window.confirm('Clear the stored events?')) return;
    await backend('DELETE', '/api/events').catch(() => {});
    setEvents([]);
  };

  return (
    <>
      {session && (
        <Notice tone="info">
          myCRMSIM posts events to the app's <strong>Callback URL</strong>. Set it to <code>{session.config.webhook_url}</code> <Copy text={session.config.webhook_url} />
          {!session.config.public_url_set && <> — this is a localhost address, so open a tunnel to port 4000 and set <code>PUBLIC_URL</code> first.</>}
        </Notice>
      )}
      <div className="tabs">
        <button className={`tab ${tab === 'callbacks' ? 'active' : ''}`} onClick={() => setTab('callbacks')}>Callback events ({events.length})</button>
        <button className={`tab ${tab === 'requests' ? 'active' : ''}`} onClick={() => setTab('requests')}>API requests</button>
        <span className="muted" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
          <span className={`dot ${live ? 'dot-on' : 'dot-off'}`} />
          {live ? 'Live' : 'Reconnecting…'}
        </span>
      </div>

      {tab === 'callbacks' ? (
        <Card
          title="Received"
          actions={
            <>
              <Select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 200 }}>
                <option value="">All events</option>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
              <Button variant="ghost" className="btn-sm" onClick={clear} disabled={!events.length}>Clear</Button>
            </>
          }
          pad={false}
        >
          {shown.length === 0 ? (
            <Empty title="No events yet">Send a message or place a call: its statuses arrive here live.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Received</th><th>Event</th><th>What</th><th>Signature</th><th /></tr></thead>
                <tbody>
                  {shown.map((e) => (
                    <Fragment key={e.id}>
                      <tr>
                        <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(e.received_at)}</td>
                        <td><Badge tone={e.type.startsWith('call') ? 'violet' : 'blue'}>{e.type}</Badge></td>
                        <td>{summary(e)}</td>
                        <td>{e.verified ? <Badge tone="green">valid</Badge> : <Badge tone="red">invalid</Badge>}</td>
                        <td><Button variant="ghost" className="btn-sm" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'JSON'}</Button></td>
                      </tr>
                      {open === e.id && (
                        <tr><td colSpan={5}><Json value={e.body} max={400} /></td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card title="Requests this system made to myCRMSIM" pad={false}>
          {requests.length === 0 ? (
            <Empty title="None yet" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Request</th><th>Status</th><th>Time</th></tr></thead>
                <tbody>
                  {requests.map((r, i) => (
                    <tr key={i}>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                      <td><span className={`method method-${r.method.toLowerCase()}`}>{r.method}</span> <span className="path">{r.path}</span></td>
                      <td><Badge tone={r.status < 300 ? 'green' : r.status < 500 ? 'amber' : 'red'}>{r.status}</Badge></td>
                      <td className="muted">{r.ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
