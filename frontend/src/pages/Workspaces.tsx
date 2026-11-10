import { useEffect, useState } from 'react';
import { ext, ok, errorText } from '../api';
import type { ApiResult } from '../api';
import { useApp, go } from '../state';
import { Badge, Button, Card, Empty, Field, Input, ResultBox, when } from '../ui';
import { EndpointForm, Props, Tabs, useApi } from '../kit';

const blank = { name: '', email: '', phone_number: '', address: '', url: '', inbound_webhook_url: '' };

export default function Workspaces() {
  const { workspaces, reloadWorkspaces, workspaceId, setWorkspaceId, toast } = useApp();
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const reload = async () => {
    setLoading(true);
    await reloadWorkspaces();
    setLoading(false);
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!form.name.trim()) return toast('A workspace needs a name.', 'error');
    setBusy('create');
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
    const r = await ext('POST', '/workspaces', { body });
    setResult(r);
    setBusy(null);
    if (!ok(r)) return toast(errorText(r), 'error');
    toast(`Workspace "${form.name}" created.`, 'ok');
    setForm(blank);
    await reloadWorkspaces();
    const id = r.data?.data?.id;
    if (id) setWorkspaceId(Number(id));
  };

  const remove = async (id: number, name: string) => {
    if (!window.confirm(`Delete workspace "${name}" (#${id}) on the myCRMSIM account? This is a real sub-account and can't be undone.`)) return;
    setBusy(`del-${id}`);
    const r = await ext('DELETE', `/workspaces/${id}`);
    setResult(r);
    setBusy(null);
    if (!ok(r)) return toast(errorText(r), 'error');
    toast('Workspace deleted.', 'ok');
    if (selectedId === id) setSelectedId(null);
    reloadWorkspaces();
  };

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)' }}>
      <Card title={`Workspaces (${workspaces.length})`} actions={<Button variant="ghost" className="btn-sm" busy={loading} onClick={reload}>Reload</Button>} pad={false}>
        {workspaces.length === 0 ? (
          <Empty title="No workspaces yet">Create one on the right.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Type</th><th>Contact</th><th>Created</th><th /></tr>
              </thead>
              <tbody>
                {workspaces.map((w) => (
                  <tr key={w.id} className={`clickable ${w.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(w.id)}>
                    <td>
                      <div className="strong">{w.name}</div>
                      <div className="muted">#{w.id}</div>
                    </td>
                    <td><Badge tone={w.user_type === 'Custom Location' ? 'violet' : 'blue'}>{w.user_type || 'workspace'}</Badge></td>
                    <td className="muted">{[w.phone_number, w.email].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="muted">{when(w.created_at)}</td>
                    <td>
                      <div className="row row-end" onClick={(e) => e.stopPropagation()}>
                        {w.id === workspaceId ? <Badge tone="green">In use</Badge> : <Button variant="ghost" className="btn-sm" onClick={() => setWorkspaceId(w.id)}>Use</Button>}
                        <Button variant="ghost" className="btn-sm" onClick={() => { setWorkspaceId(w.id); go('/contacts'); }}>Contacts</Button>
                        <Button variant="danger" className="btn-sm" busy={busy === `del-${w.id}`} onClick={() => remove(w.id, w.name)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedId ? (
        <WorkspacePanel key={selectedId} id={selectedId} onChanged={reloadWorkspaces} onClose={() => setSelectedId(null)} />
      ) : (
      <Card title="Create a workspace">
        <Field label="Name *"><Input value={form.name} onChange={set('name')} placeholder="Acme HQ" /></Field>
        <div className="form-grid">
          <Field label="Email"><Input value={form.email} onChange={set('email')} placeholder="hq@acme.com" /></Field>
          <Field label="Phone"><Input value={form.phone_number} onChange={set('phone_number')} placeholder="+61400000000" /></Field>
        </div>
        <Field label="Address"><Input value={form.address} onChange={set('address')} /></Field>
        <Field label="Website"><Input value={form.url} onChange={set('url')} placeholder="https://acme.com" /></Field>
        <Field label="Inbound webhook URL" hint="Optional. Makes it a Custom Location workspace: its inbound messages go to this URL.">
          <Input value={form.inbound_webhook_url} onChange={set('inbound_webhook_url')} placeholder="https://…" />
        </Field>
        <div className="row row-end"><Button busy={busy === 'create'} onClick={create}>Create workspace</Button></div>
        <ResultBox result={result} />
      </Card>
      )}
    </div>
  );
}

function WorkspacePanel({ id, onChanged, onClose }: { id: number; onChanged: () => Promise<void> | void; onClose: () => void }) {
  const [side, setSide] = useState<'details' | 'edit'>('details');
  const ws = useApi('get-workspace', { path: { id } });
  const w = ws.data as Record<string, any> | undefined;
  return (
    <Card title={w?.name || `Workspace #${id}`} actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>New workspace</Button>}>
      <Tabs value={side} onChange={setSide} tabs={[{ id: 'details', label: 'Details' }, { id: 'edit', label: 'Edit' }]} />
      {!w ? (
        <div className="muted">{ws.loading ? 'Loading…' : 'Could not load this workspace.'}</div>
      ) : side === 'details' ? (
        <Props value={w} />
      ) : (
        <EndpointForm
          slug="update-workspace"
          path={{ id }}
          initial={w}
          changesOnly
          submit="Save changes"
          onDone={() => {
            ws.reload();
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
