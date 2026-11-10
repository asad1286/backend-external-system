import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { RemoteTrack } from 'livekit-client';
import { ext, ok, errorText } from '../api';
import type { ApiResult } from '../api';
import { useApp } from '../state';
import { contactName, useContactPicker } from '../contacts';
import { Badge, Button, Card, Empty, Field, Input, Notice, ResultBox, Select, clock } from '../ui';

// A call placed from here, as far as we know it. Steps come from three places: the
// Place a call answer, call.status events on the Callback URL, and GET /calls/{id}/status.
type Status = 'dialing' | 'ringing' | 'answered' | 'failed' | 'ended';
type Step = { status: Status | 'placed' | 'ending'; at: number; source: string; reason?: string | null };
type ActiveCall = {
  callId: string;
  channel: string;
  label: string;
  target: Target;
  room: { url: string; token: string; name: string } | null;
  backupLines: string[];
  tried: string[];
  status: Status;
  reason: string | null;
  duration: number | null;
  placedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  steps: Step[];
};
type Target = { contact_id?: number; phone?: string; email?: string };

const RANK: Record<Status, number> = { dialing: 0, ringing: 1, answered: 2, failed: 3, ended: 3 };
const FINAL = (s: Status) => s === 'failed' || s === 'ended';
const LINES = [
  { value: '', label: 'Automatic (Call Routing)' },
  { value: 'imessage', label: 'Mac (FaceTime)' },
  { value: 'android', label: 'Android SIM' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'twilio', label: 'Twilio' },
];
const lineLabel = (v: string) => LINES.find((l) => l.value === v)?.label || v;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function Calls({ params }: { params: URLSearchParams }) {
  const { workspaceId, toast, onEvent, hasScope } = useApp();
  const { contacts } = useContactPicker(workspaceId);

  const [mode, setMode] = useState<'contact' | 'phone' | 'email'>('contact');
  const [contactId, setContactId] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [line, setLine] = useState('');
  const [allowBackup, setAllowBackup] = useState(true);
  const [ringSeconds, setRingSeconds] = useState(5);

  const [readiness, setReadiness] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [apiOff, setApiOff] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [call, setCall] = useState<ActiveCall | null>(null);
  const [history, setHistory] = useState<ActiveCall[]>([]);
  const [now, setNow] = useState(Date.now());
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [roomState, setRoomState] = useState<'none' | 'joining' | 'joined' | 'left' | 'error'>('none');
  const roomRef = useRef<Room | null>(null);
  const callRef = useRef<ActiveCall | null>(null);
  callRef.current = call;

  useEffect(() => {
    const c = params.get('contact');
    if (c) {
      setMode('contact');
      setContactId(c);
    }
  }, [params]);

  // ── Lines and readiness ───────────────────────────────────────────────────────────
  const loadLines = useCallback(async () => {
    if (!workspaceId) return;
    const [r, l] = await Promise.all([
      ext('GET', '/calls/readiness', { query: { workspace_id: workspaceId } }),
      ext('GET', '/calls/lines', { query: { workspace_id: workspaceId } }),
    ]);
    if (r.status === 503) {
      setApiOff(r.data?.message || 'The Calls API is switched off on this server.');
      return;
    }
    setApiOff(null);
    setReadiness(ok(r) ? r.data.data : null);
    setLines(ok(l) && Array.isArray(l.data?.data) ? l.data.data : []);
  }, [workspaceId]);
  useEffect(() => {
    loadLines();
  }, [loadLines]);

  // ── The audio room ───────────────────────────────────────────────────────────────
  const leaveRoom = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      room.disconnect().catch(() => {});
      setRoomState('left');
    }
    document.querySelectorAll('audio[data-call-audio]').forEach((el) => el.remove());
    setAudioBlocked(false);
    setMuted(false);
  }, []);

  const joinRoom = useCallback(
    async (info: { url: string; token: string }) => {
      leaveRoom();
      const room = new Room();
      roomRef.current = room;
      setRoomState('joining');
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.setAttribute('data-call-audio', '1');
        el.style.display = 'none';
        document.body.appendChild(el);
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio));
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current === room) setRoomState('left');
      });
      try {
        await room.connect(info.url, info.token);
        await room.localParticipant.setMicrophoneEnabled(true);
        setAudioBlocked(!room.canPlaybackAudio);
        setRoomState('joined');
      } catch (err: any) {
        setRoomState('error');
        toast(`Couldn't join the audio room: ${err?.message || err}. The call still runs on the line.`, 'error');
      }
    },
    [leaveRoom, toast],
  );

  useEffect(() => () => leaveRoom(), [leaveRoom]);

  // ── Status: forward only, from any source ────────────────────────────────────────
  const applyStatus = useCallback(
    (callId: string, status: Status, source: string, extra: { reason?: string | null; duration?: number | null } = {}) => {
      setCall((c) => {
        if (!c || c.callId !== callId) return c;
        if (FINAL(c.status) || RANK[status] < RANK[c.status] || (status === c.status && c.steps.some((s) => s.status === status))) return c;
        const at = Date.now();
        const next: ActiveCall = {
          ...c,
          status,
          reason: extra.reason ?? (FINAL(status) ? c.reason : null),
          duration: extra.duration ?? c.duration,
          answeredAt: status === 'answered' ? at : c.answeredAt,
          endedAt: FINAL(status) ? at : c.endedAt,
          steps: [...c.steps, { status, at, source, reason: extra.reason }],
        };
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!call || !FINAL(call.status)) return;
    leaveRoom();
    setHistory((h) => (h.some((x) => x.callId === call.callId) ? h : [call, ...h].slice(0, 20)));
  }, [call?.status, leaveRoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // call.status on the Callback URL
  useEffect(
    () =>
      onEvent((e) => {
        const c = callRef.current;
        if (e.type !== 'call.status' || !c || e.body?.call_id !== c.callId) return;
        applyStatus(c.callId, e.body.status, 'callback', { reason: e.body.reason, duration: e.body.duration_seconds });
      }),
    [onEvent, applyStatus],
  );

  // GET /calls/{id}/status — the backstop when a callback doesn't come.
  useEffect(() => {
    if (!call || FINAL(call.status)) return;
    const id = call.callId;
    const timer = window.setInterval(async () => {
      const r = await ext('GET', `/calls/${encodeURIComponent(id)}/status`);
      if (ok(r) && r.data?.data?.status) applyStatus(id, r.data.data.status, 'status endpoint', { reason: r.data.data.reason, duration: r.data.data.duration_seconds });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [call?.callId, call?.status, applyStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!call || FINAL(call.status)) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [call?.callId, call?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──────────────────────────────────────────────────────────────────────
  const currentTarget = (): { target: Target; label: string } | null => {
    if (mode === 'contact') {
      const c = contacts.find((x) => String(x.id) === contactId);
      if (!c) return null;
      return { target: { contact_id: c.id }, label: contactName(c) };
    }
    if (mode === 'phone') return phone.trim() ? { target: { phone: phone.trim() }, label: phone.trim() } : null;
    return email.trim() ? { target: { email: email.trim() }, label: email.trim() } : null;
  };

  const place = async (target: Target, label: string, opts: { channel?: string; tried?: string[] } = {}) => {
    setBusy('start');
    const body: Record<string, unknown> = { workspace_id: workspaceId, ...target };
    const channel = opts.channel ?? line;
    if (channel) body.channel = channel;
    if (allowBackup || opts.tried?.length) body.allow_backup = true;
    if (opts.tried?.length) body.backup_tried = opts.tried;
    const r = await ext('POST', '/calls', { body });
    setResult(r);
    setBusy(null);
    if (!ok(r)) return toast(errorText(r), 'error');
    const d = r.data.data;
    const at = Date.now();
    const next: ActiveCall = {
      callId: d.call_id,
      channel: d.channel,
      label,
      target,
      room: d.room?.token ? { url: d.room.url, token: d.room.token, name: d.room.name } : null,
      backupLines: Array.isArray(d.backup_lines) ? d.backup_lines : [],
      tried: opts.tried || [],
      status: 'dialing',
      reason: null,
      duration: null,
      placedAt: at,
      answeredAt: null,
      endedAt: null,
      steps: [{ status: 'placed', at, source: 'Place a call', reason: d.from_number ? `from ${d.from_number}` : null }],
    };
    setCall(next);
    setNow(at);
    if (next.room) joinRoom(next.room);
    else toast('No audio room for this call (the line rings without browser audio).', 'info');
  };

  const start = () => {
    const t = currentTarget();
    if (!t) return toast(mode === 'contact' ? 'Pick a contact.' : `Enter ${mode === 'phone' ? 'a phone number' : 'an email'}.`, 'error');
    place(t.target, t.label);
  };

  const tryBackup = () => {
    if (!call) return;
    place(call.target, call.label, { channel: '', tried: [...call.tried, call.channel] });
  };

  const end = async () => {
    if (!call) return;
    setBusy('end');
    const id = call.callId;
    const r = await ext('POST', `/calls/${encodeURIComponent(id)}/end`, { body: { channel: call.channel } });
    setBusy(null);
    setResult(r);
    if (!ok(r)) return toast(errorText(r), 'error');
    setCall((c) => (c && c.callId === id ? { ...c, steps: [...c.steps, { status: 'ending', at: Date.now(), source: 'End call' }] } : c));
    leaveRoom();
    // The line's own "ended" normally follows; don't wait on it forever.
    window.setTimeout(() => applyStatus(id, 'ended', 'End call', { reason: 'hung_up_here' }), 8000);
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(muted);
    setMuted(!muted);
  };

  const missedCall = async () => {
    const t = currentTarget();
    if (!t || t.target.email) return toast('A missed call needs a contact or a phone number.', 'error');
    setBusy('missed');
    const r = await ext('POST', '/calls/missed-call', { body: { workspace_id: workspaceId, ...t.target, ring_seconds: ringSeconds } });
    setBusy(null);
    setResult(r);
    if (!ok(r)) return toast(errorText(r), 'error');
    toast(`Missed call queued on ${r.data?.data?.channel || 'a line'} (${r.data?.data?.ring_seconds}s).`, 'ok');
  };

  const live = call && !FINAL(call.status);
  const talkSeconds = call?.answeredAt ? ((call.endedAt || now) - call.answeredAt) / 1000 : 0;
  const totalSeconds = call ? ((call.endedAt || now) - call.placedAt) / 1000 : 0;

  return (
    <>
      {apiOff && (
        <Notice tone="warn">
          <strong>Calls API is off on this myCRMSIM server.</strong> {apiOff} (It is switched on with <code>EXT_CALLS_API_ENABLED=true</code> on the backend.)
        </Notice>
      )}
      {!hasScope('calls.write') && <Notice tone="warn">This install has no <code>calls.write</code> scope: placing calls will be refused. Add it to the app and install again.</Notice>}

      {call && (
        <div className="call-hero">
          <div className="call-top">
            <div className="call-who">
              {call.label}
              <div className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
                {lineLabel(call.channel)} · call {call.callId.slice(0, 8)}… {call.tried.length > 0 && `· backup after ${call.tried.map(lineLabel).join(', ')}`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="call-timer">{mmss(call.answeredAt ? talkSeconds : totalSeconds)}</div>
              <div className="muted">{call.answeredAt ? 'talking' : FINAL(call.status) ? 'total' : 'since placed'}</div>
            </div>
          </div>
          <div className="call-steps">
            {(['dialing', 'ringing', 'answered'] as Status[]).map((s) => (
              <span key={s} className={`call-step ${RANK[call.status] >= RANK[s] && call.steps.some((x) => x.status === s) ? 'on' : ''}`}>{s}</span>
            ))}
            {FINAL(call.status) && <span className={`call-step ${call.status === 'failed' ? 'bad' : 'on'}`}>{call.status}{call.reason ? ` · ${call.reason}` : ''}</span>}
          </div>
          <div className="row">
            {live && <Button variant="danger" busy={busy === 'end'} onClick={end}>End call</Button>}
            {live && call.room && <Button variant="ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.4)' }} onClick={toggleMute} disabled={roomState !== 'joined'}>{muted ? 'Unmute' : 'Mute'}</Button>}
            {audioBlocked && <Button variant="success" onClick={() => roomRef.current?.startAudio().then(() => setAudioBlocked(false))}>Enable sound</Button>}
            {call.status === 'failed' && call.backupLines.filter((l) => !call.tried.includes(l) && l !== call.channel).length > 0 && (
              <Button variant="success" busy={busy === 'start'} onClick={tryBackup}>Try backup line ({call.backupLines.filter((l) => !call.tried.includes(l) && l !== call.channel).map(lineLabel).join(', ')})</Button>
            )}
            {!live && <Button variant="ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.4)' }} onClick={() => setCall(null)}>Close</Button>}
            <span className="muted" style={{ marginLeft: 'auto' }}>
              Audio: {call.room ? roomState : 'none (rings on the device)'}
            </span>
          </div>
        </div>
      )}

      <div className="grid-2">
        <Card title="Place a call">
          <div className="tabs">
            {(['contact', 'phone', 'email'] as const).map((m) => (
              <button key={m} className={`tab ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
                {m === 'contact' ? 'Contact' : m === 'phone' ? 'Number' : 'Email (FaceTime)'}
              </button>
            ))}
          </div>
          {mode === 'contact' && (
            <Field label="Contact">
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">Choose…</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)} {c.phone_number ? `· ${c.phone_number}` : c.email ? `· ${c.email}` : ''}</option>)}
              </Select>
            </Field>
          )}
          {mode === 'phone' && <Field label="Phone number"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+61412345678" /></Field>}
          {mode === 'email' && <Field label="Apple ID email" hint="Only the Mac (FaceTime) can call an email address."><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@icloud.com" /></Field>}
          <Field label="Line">
            <Select value={line} onChange={(e) => setLine(e.target.value)}>
              {LINES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </Select>
          </Field>
          <label className="check"><input type="checkbox" checked={allowBackup} onChange={(e) => setAllowBackup(e.target.checked)} /> Offer the backup line when this one fails</label>
          <div className="row">
            <Button className="btn-lg" busy={busy === 'start'} disabled={Boolean(live)} onClick={start}>☎ Call</Button>
            <span className="muted">Allow the microphone when the browser asks.</span>
          </div>
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '4px 0' }} />
          <div className="row">
            <Field label="Missed call: ring for (seconds)"><Input type="number" min={3} max={60} value={ringSeconds} onChange={(e) => setRingSeconds(Number(e.target.value))} style={{ width: 110 }} /></Field>
            <Button variant="ghost" busy={busy === 'missed'} onClick={missedCall} style={{ alignSelf: 'end' }}>Place a missed call</Button>
          </div>
          <ResultBox result={result} />
        </Card>

        <Card title="Lines" actions={<Button variant="ghost" className="btn-sm" onClick={loadLines}>Reload</Button>}>
          {readiness && (
            <div className="grid-3">
              <div className="ready-tile"><span className="muted">Mac (FaceTime)</span><strong>{readiness.facetime?.ready ? <Badge tone="green">ready</Badge> : <Badge tone="red">{readiness.facetime?.reason || 'not ready'}</Badge>}</strong></div>
              <div className="ready-tile"><span className="muted">Android audio</span><strong>{readiness.android?.audio ? <Badge tone="green">ready</Badge> : <Badge tone="gray">{readiness.android?.reason || 'off'}</Badge>}</strong></div>
              <div className="ready-tile"><span className="muted">Missed call</span><strong>{readiness.missed_call?.ready ? <Badge tone="green">ready</Badge> : <Badge tone="red">{readiness.missed_call?.reason || 'not ready'}</Badge>}</strong></div>
            </div>
          )}
          {readiness?.routing?.length > 0 && (
            <div className="muted">Call Routing: {readiness.routing.map((g: string[]) => g.map(lineLabel).join(' + ')).join(' → ')}</div>
          )}
          {lines.length === 0 ? (
            <Empty title="No lines">{apiOff ? 'The Calls API is off.' : 'Connect a Mac, Android phone, WhatsApp number or Twilio in myCRMSIM.'}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Line</th><th>Number</th><th>Status</th><th>Calling</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={`${l.channel}-${l.id}`}>
                      <td><div className="strong">{l.name || lineLabel(l.channel)}</div><div className="muted">{lineLabel(l.channel)}</div></td>
                      <td className="muted">{l.number || '—'}</td>
                      <td><Badge>{l.status}</Badge></td>
                      <td>{l.calling_enabled ? <Badge tone="green">on</Badge> : <Badge tone="gray">off</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="This call, step by step">
          {!call ? (
            <Empty title="No call yet">Steps from the API answer, the Callback URL and the status endpoint show up here.</Empty>
          ) : (
            <div className="timeline">
              {call.steps.map((s, i) => (
                <div key={i} className="timeline-item">
                  <span className="muted">{clock(new Date(s.at).toISOString())}</span>
                  <span><Badge>{s.status}</Badge> <span className="muted">via {s.source}</span>{s.reason ? <span className="muted"> · {s.reason}</span> : null}</span>
                </div>
              ))}
              {call.duration !== null && FINAL(call.status) && <div className="muted" style={{ paddingTop: 8 }}>Talk time reported: {mmss(call.duration)}</div>}
            </div>
          )}
        </Card>
        <Card title="Calls from this session" pad={false}>
          {history.length === 0 ? (
            <Empty title="None yet" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Who</th><th>Line</th><th>Result</th><th>Talk</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.callId}>
                      <td><div className="strong">{h.label}</div><div className="muted">{clock(new Date(h.placedAt).toISOString())}</div></td>
                      <td className="muted">{lineLabel(h.channel)}</td>
                      <td><Badge>{h.status}</Badge>{h.reason && <div className="muted">{h.reason}</div>}</td>
                      <td className="muted">{h.duration !== null ? mmss(h.duration) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
