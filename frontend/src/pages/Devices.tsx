import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ext, ok, errorText } from '../api';
import type { ApiResult } from '../api';
import { useApp } from '../state';
import { Badge, Button, Card, Empty, Input, Notice, ResultBox, Select, when } from '../ui';
import { Props, run, useApi } from '../kit';

type Device = {
  id: number;
  channel: 'android' | 'whatsapp' | 'imessage' | 'rcs';
  name?: string | null;
  number?: string | null;
  status?: string | null;
  health_status?: 'healthy' | 'degraded' | 'offline' | 'unknown' | null;
  health?: Record<string, unknown> | null;
  last_seen_at?: string | null;
  workspace_id?: number | null;
  workspace_name?: string | null;
  is_default?: boolean | null;
  [key: string]: unknown;
};

const CHANNELS = [
  { value: 'android', label: 'Android / SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'imessage', label: 'iMessage (Mac)' },
  { value: 'rcs', label: 'RCS' },
];
const channelLabel = (c: string) => CHANNELS.find((x) => x.value === c)?.label || c;
const HEALTH_TONE: Record<string, string> = { healthy: 'green', degraded: 'amber', offline: 'red', unknown: 'gray' };
const key = (d: Device) => `${d.channel}-${d.id}`;

export default function Devices() {
  const { workspaces, workspaceId, workspace, toast, hasScope } = useApp();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState('');
  const [onlyWorkspace, setOnlyWorkspace] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await ext('GET', '/devices', { query: { channel: channel || undefined } });
    setLoading(false);
    if (!ok(r)) {
      setDevices([]);
      return toast(errorText(r), 'error');
    }
    setDevices(Array.isArray(r.data?.data) ? r.data.data : []);
  }, [channel, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of devices) c[d.channel] = (c[d.channel] || 0) + 1;
    return c;
  }, [devices]);
  const shown = onlyWorkspace && workspaceId ? devices.filter((d) => Number(d.workspace_id) === workspaceId) : devices;

  const update = async (d: Device, body: Record<string, unknown>, done: string) => {
    setBusy(key(d));
    const r = await ext('PATCH', `/devices/${d.channel}/${d.id}`, { body });
    setBusy(null);
    setResult(r);
    if (!ok(r)) return toast(errorText(r), 'error');
    toast(done, 'ok');
    load();
  };

  const remove = async (d: Device) => {
    if (d.workspace_id) {
      return toast(d.channel === 'android' ? 'Unassign this phone from its workspace in myCRMSIM first.' : 'Unassign it from its workspace first (Workspace → none).', 'error');
    }
    if (!window.confirm(`Delete ${channelLabel(d.channel)} device "${d.name || d.number || d.id}"? The connection is removed from the myCRMSIM account.`)) return;
    setBusy(key(d));
    const r = await ext('DELETE', `/devices/${d.channel}/${d.id}`);
    setBusy(null);
    setResult(r);
    if (!ok(r)) return toast(errorText(r), 'error');
    toast('Device deleted.', 'ok');
    load();
  };

  return (
    <>
      {!hasScope('devices.read') && <Notice tone="warn">This install has no <code>devices.read</code> scope: the list will be refused. Add it to the app and install again.</Notice>}

      <div className="grid-3">
        {CHANNELS.map((c) => (
          <button key={c.value} type="button" className="ready-tile" style={{ textAlign: 'left', cursor: 'pointer', background: channel === c.value ? 'var(--brand-soft)' : 'var(--panel)', font: 'inherit', color: 'inherit' }} onClick={() => setChannel(channel === c.value ? '' : c.value)}>
            <span className="muted">{c.label}</span>
            <strong style={{ fontSize: 22 }}>{channel && channel !== c.value ? '—' : counts[c.value] || 0}</strong>
          </button>
        ))}
      </div>

      <Card
        title={`Devices${channel ? ` · ${channelLabel(channel)}` : ''} (${shown.length})`}
        actions={
          <>
            <label className="check"><input type="checkbox" checked={onlyWorkspace} onChange={(e) => setOnlyWorkspace(e.target.checked)} /> Only {workspace?.name || 'this workspace'}</label>
            <Select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 170 }}>
              <option value="">All channels</option>
              {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
            <Button variant="ghost" className="btn-sm" busy={loading} onClick={load}>Reload</Button>
          </>
        }
        pad={false}
      >
        {shown.length === 0 ? (
          <Empty title={loading ? 'Loading…' : 'No devices'}>{!loading && 'Connect a phone, Mac, WhatsApp or RCS line in myCRMSIM.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Device</th><th>Channel</th><th>Health</th><th>Workspace</th><th>Default</th><th /></tr></thead>
              <tbody>
                {shown.map((d) => {
                  const k = key(d);
                  const editable = d.channel !== 'android';
                  return (
                    <Fragment key={k}>
                      <tr>
                        <td>
                          {renaming?.key === k ? (
                            <div className="row">
                              <Input value={renaming.name} onChange={(e) => setRenaming({ key: k, name: e.target.value })} style={{ width: 180 }} autoFocus />
                              <Button className="btn-sm" busy={busy === k} onClick={() => { update(d, { name: renaming.name }, 'Renamed.'); setRenaming(null); }}>Save</Button>
                              <Button variant="ghost" className="btn-sm" onClick={() => setRenaming(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <>
                              <div className="strong">{d.name || `Device #${d.id}`}</div>
                              <div className="muted">#{d.id}{d.number ? ` · ${d.number}` : ''}</div>
                            </>
                          )}
                        </td>
                        <td><Badge tone="gray">{channelLabel(d.channel)}</Badge></td>
                        <td>
                          <Badge tone={HEALTH_TONE[d.health_status || 'unknown'] || 'gray'}>{d.health_status || d.status || 'unknown'}</Badge>
                          <div className="muted">{d.last_seen_at ? `seen ${when(d.last_seen_at)}` : d.status || ''}</div>
                        </td>
                        <td>
                          {editable ? (
                            <Select value={d.workspace_id ?? ''} disabled={busy === k} style={{ minWidth: 160 }} onChange={(e) => update(d, { workspace_id: e.target.value ? Number(e.target.value) : null }, e.target.value ? 'Assigned.' : 'Unassigned.')}>
                              <option value="">— none —</option>
                              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                              {d.workspace_id && !workspaces.some((w) => w.id === Number(d.workspace_id)) && <option value={d.workspace_id}>{d.workspace_name || `#${d.workspace_id}`}</option>}
                            </Select>
                          ) : (
                            <span>{d.workspace_name || (d.workspace_id ? `#${d.workspace_id}` : <span className="muted">none</span>)}</span>
                          )}
                        </td>
                        <td>
                          {editable ? (
                            <label className="check"><input type="checkbox" checked={Boolean(d.is_default)} disabled={busy === k} onChange={(e) => update(d, { is_default: e.target.checked }, e.target.checked ? 'Set as default.' : 'No longer default.')} /> default</label>
                          ) : d.is_default ? <Badge tone="green">default</Badge> : <span className="muted">—</span>}
                        </td>
                        <td>
                          <div className="row row-end">
                            <Button variant="ghost" className="btn-sm" onClick={() => setOpen(open === k ? null : k)}>{open === k ? 'Hide' : 'Details'}</Button>
                            {editable && <Button variant="ghost" className="btn-sm" onClick={() => setRenaming({ key: k, name: d.name || '' })}>Rename</Button>}
                            <Button variant="danger" className="btn-sm" busy={busy === k} onClick={() => remove(d)}>Delete</Button>
                          </div>
                        </td>
                      </tr>
                      {open === k && (
                        <tr>
                          <td colSpan={6}>
                            {!editable && <div className="muted" style={{ marginBottom: 8 }}>Android phones are read-only over the API: rename and assign them in the myCRMSIM dashboard.</div>}
                            <DeviceDetails channel={d.channel} id={d.id} />
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
      <LookupById />
      <ResultBox result={result} />
    </>
  );
}

/** Get device: the full record for one line, health and channel details included. */
function DeviceDetails({ channel, id }: { channel: string; id: number }) {
  const dev = useApi('get-device', { path: { channel, id } });
  if (!dev.data) return <div className="muted">{dev.loading ? 'Loading…' : 'Could not load this device.'}</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Props value={dev.data} />
      <div className="row row-end"><Button variant="ghost" className="btn-sm" busy={dev.loading} onClick={dev.reload}>Refresh</Button></div>
    </div>
  );
}

/** Get device by id (channel-less): for when only the id is known, e.g. from a callback. */
function LookupById() {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ApiResult | null>(null);
  const look = async () => {
    if (!id.trim()) return;
    setBusy(true);
    setRes(await run('get-device-by-id', { path: { id: id.trim() } }));
    setBusy(false);
  };
  return (
    <Card title="Look up a device by id">
      <div className="row">
        <Input type="number" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && look()} placeholder="7022" style={{ width: 160 }} />
        <Button busy={busy} onClick={look}>Look up</Button>
        <span className="muted">No channel needed — handy when a callback only gives you a device id.</span>
      </div>
      {res && (ok(res) ? <Props value={res.data?.data} /> : <Notice tone="error">{errorText(res)}</Notice>)}
    </Card>
  );
}
