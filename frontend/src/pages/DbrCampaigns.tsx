import { useEffect, useRef, useState } from 'react';
import { ok, errorText } from '../api';
import { useApp } from '../state';
import { Badge, Button, Card, Field, Input, Notice, when } from '../ui';
import { DataTable, EndpointForm, Props, ScopeNote, Split, Status, Tabs, run, useAction, useApi } from '../kit';

type Campaign = { campaign_id: string; campaign_name: string; campaign_tag?: string; campaign_stage?: string; campaign_open?: boolean; agent_id?: string; agent_name?: string; agent_status?: string; list_size_estimate?: number; tagged_count?: number; pacing_sentence?: string; next_step?: string; runs?: Record<string, any>; created_at?: string; updated_at?: string };

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function DbrCampaigns() {
  const { workspaceId } = useApp();
  const [includeClosed, setIncludeClosed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useApi('list-dbr-campaigns', { query: { workspace_id: workspaceId, include_closed: includeClosed ? 'true' : undefined } });
  const rows = list.rows as Campaign[];
  const openId = list.raw?.open_campaign_id as string | undefined;

  return (
    <>
      <ScopeNote scopes={['dbr_campaigns.read', 'dbr_campaigns.write']} />
      <Preflight workspaceId={workspaceId!} />
      <Split
        side={
          selectedId ? (
            <CampaignPanel key={selectedId} id={selectedId} workspaceId={workspaceId!} onChanged={list.reload} onClose={() => setSelectedId(null)} />
          ) : (
            <CreatePanel workspaceId={workspaceId!} hasOpen={Boolean(openId)} onCreated={(id) => { list.reload(); if (id) setSelectedId(id); }} />
          )
        }
      >
        <Card
          title={`Campaigns (${rows.length})`}
          actions={
            <>
              <label className="check"><input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include closed</label>
              <Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>
            </>
          }
          pad={false}
        >
          <DataTable
            rows={rows}
            loading={list.loading}
            rowKey={(c) => c.campaign_id}
            selected={selectedId}
            onRow={(c) => setSelectedId(c.campaign_id)}
            empty="No campaigns"
            columns={[
              { label: 'Campaign', render: (c) => <><div className="strong">{c.campaign_name} {c.campaign_id === openId && <Badge tone="green">open</Badge>}</div><div className="muted">{c.campaign_tag ? <code>{c.campaign_tag}</code> : null}</div></> },
              { label: 'Agent', render: (c) => <>{c.agent_name || '—'} {c.agent_status && <Status value={c.agent_status} />}</> },
              { label: 'Stage', render: (c) => <Badge tone="violet">{c.campaign_stage || '—'}</Badge> },
              { label: 'List', render: (c) => `${c.tagged_count ?? 0} / ${c.list_size_estimate ?? '—'}` },
              { label: 'Next step', render: (c) => <span className="muted">{c.next_step || '—'}</span> },
            ]}
          />
        </Card>
      </Split>
    </>
  );
}

function Preflight({ workspaceId }: { workspaceId: number }) {
  const pre = useApi('dbr-preflight', { query: { workspace_id: workspaceId } }, { quiet: true });
  const d = pre.data as { ok?: boolean; has_key?: boolean; agent_model_configured?: boolean; message?: string; device?: { ok?: boolean; devices?: number; enabled?: number; online?: number } } | undefined;
  const tile = (label: string, good: boolean | undefined, sub?: string) => (
    <div className="stat" style={{ borderColor: good ? 'var(--green)' : 'var(--red)' }}>
      <b style={{ color: good ? 'var(--green)' : 'var(--red)', fontSize: 16 }}>{good ? '✓ Ready' : '✕ Missing'}</b>
      <span>{label}{sub ? ` · ${sub}` : ''}</span>
    </div>
  );
  return (
    <Card title="Preflight" actions={<Button variant="ghost" className="btn-sm" busy={pre.loading} onClick={pre.reload}>Check again</Button>}>
      {!d ? (
        <div className="muted">{pre.loading ? 'Checking…' : pre.result ? errorText(pre.result) : ''}</div>
      ) : (
        <>
          <Notice tone={d.ok ? 'ok' : 'warn'}>{d.message || (d.ok ? 'Ready.' : 'Not ready.')}</Notice>
          <div className="stat-row">
            {tile('AI key', d.has_key)}
            {tile('Reply model', d.agent_model_configured)}
            {tile('Sending device', d.device?.ok, d.device ? `${d.device.online ?? 0} online of ${d.device.devices ?? 0}` : undefined)}
          </div>
        </>
      )}
    </Card>
  );
}

function CampaignPanel({ id, workspaceId, onChanged, onClose }: { id: string; workspaceId: number; onChanged: () => void; onClose: () => void }) {
  const camp = useApi('get-dbr-campaign', { path: { id }, query: { workspace_id: workspaceId } });
  const { act, busy } = useAction();
  const [zone, setZone] = useState(ZONE);
  const c = camp.data as Campaign | undefined;
  const refresh = () => { camp.reload(); onChanged(); };
  const body = { workspace_id: workspaceId };

  if (!c) return <Card title="Campaign" actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>Close</Button>}><div className="muted">{camp.loading ? 'Loading…' : 'Could not load it.'}</div></Card>;
  return (
    <Card title={c.campaign_name} actions={<Button variant="ghost" className="btn-sm" onClick={onClose}>New</Button>}>
      <div className="row"><Badge tone="violet">{c.campaign_stage}</Badge>{c.campaign_open && <Badge tone="green">open</Badge>}<span className="muted">agent {c.agent_name}</span></div>
      {c.pacing_sentence && <Notice tone="info">{c.pacing_sentence}</Notice>}
      {c.next_step && <div><strong>Next step:</strong> {c.next_step}</div>}
      {c.runs && (
        <div className="stat-row">
          {Object.entries(c.runs).filter(([, v]) => typeof v === 'number').map(([k, v]) => <div key={k} className="stat"><b>{v as number}</b><span>{k} runs</span></div>)}
        </div>
      )}
      <Field label="Preview">
        <div className="row">
          <Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Timezone, e.g. Australia/Sydney" style={{ flex: 1 }} />
          <Button busy={busy === 'preview'} onClick={() => act('preview-dbr-campaign', { path: { id }, body: { ...body, timezone: zone.trim() || undefined } }, { key: 'preview', onDone: refresh })}>Preview campaign</Button>
        </div>
      </Field>
      <div className="row">
        <Button variant="ghost" busy={busy === 'resume'} onClick={() => act('resume-dbr-campaign', { path: { id }, body }, { key: 'resume', onDone: refresh })}>Resume</Button>
        <Button variant="ghost" busy={busy === 'stop'} onClick={() => act('stop-dbr-campaign', { path: { id }, body }, { key: 'stop', confirm: 'Stop this campaign? Sending stops and the agent is paused.', onDone: refresh })}>Stop</Button>
        <span style={{ flex: 1 }} />
        <Button variant="danger" busy={busy === 'del'} onClick={() => act('delete-dbr-campaign', { path: { id }, query: body }, { key: 'del', confirm: `Delete “${c.campaign_name}”?`, done: 'Campaign deleted.', onDone: () => { onClose(); onChanged(); } })}>Delete</Button>
      </div>
      <Props value={c} omit={['runs', 'pacing_sentence', 'next_step']} />
      <div className="muted">Updated {when(c.updated_at)}</div>
    </Card>
  );
}

function CreatePanel({ workspaceId, hasOpen, onCreated }: { workspaceId: number; hasOpen: boolean; onCreated: (id?: string) => void }) {
  const [tab, setTab] = useState<'existing' | 'new'>('existing');
  const agents = useApi('list-ai-agents', { query: { workspace_id: workspaceId, limit: 100 } }, { quiet: true });
  return (
    <Card title="New campaign">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'existing', label: 'Existing agent' }, { id: 'new', label: 'New agent' }]} />
      {hasOpen && <Notice tone="warn">A campaign is already open. Close it first, or set continue_open_campaign.</Notice>}
      {tab === 'existing' ? (
        <EndpointForm
          slug="create-dbr-campaign"
          fixed={{ workspace_id: workspaceId }}
          choices={{ agent_id: (agents.rows as any[]).map((a) => ({ value: a.id, label: `${a.name} (${a.status})` })) }}
          submit="Create campaign"
          onDone={(r) => onCreated(r.data?.data?.campaign_id)}
        />
      ) : (
        <NewAgent workspaceId={workspaceId} onCreated={onCreated} />
      )}
    </Card>
  );
}

function NewAgent({ workspaceId, onCreated }: { workspaceId: number; onCreated: (id?: string) => void }) {
  const { toast } = useApp();
  const calendars = useApi('list-calendars', { query: { workspace_id: workspaceId } }, { quiet: true });
  const [url, setUrl] = useState('');
  const [researching, setResearching] = useState(false);
  const [research, setResearch] = useState<any>(null);
  const [job, setJob] = useState<{ job_id: string; status: string; error?: string } | null>(null);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const doResearch = async () => {
    if (!url.trim()) return toast('Enter the website URL.', 'error');
    setResearching(true);
    const r = await run('dbr-research-website', { body: { workspace_id: workspaceId, url: url.trim(), session_id: research?.session_id } });
    setResearching(false);
    if (!ok(r)) return toast(errorText(r), 'error');
    setResearch(r.data.data);
    toast(r.data.data?.message || 'Website read.', 'ok');
  };

  const poll = (jobId: string) => {
    timer.current = window.setTimeout(async () => {
      const r = await run('get-dbr-campaign-job', { path: { job_id: jobId }, query: { workspace_id: workspaceId } });
      if (!ok(r)) {
        setJob({ job_id: jobId, status: 'failed', error: errorText(r) });
        onCreated();
        return;
      }
      const d = r.data.data || {};
      setJob({ job_id: jobId, status: d.status, error: d.message && d.status !== 'done' ? d.message : undefined });
      if (d.status === 'done') {
        toast('Campaign ready.', 'ok');
        onCreated(d.campaign_id);
      } else if (d.status === 'failed' || d.code) {
        onCreated();
      } else poll(jobId);
    }, 3000);
  };

  const slots = research?.slots || {};
  const sugg = research?.suggestions || {};
  const initial = research
    ? {
        website_url: url.trim(),
        session_id: research.session_id,
        research_id: research.research_id,
        business_description: slots.company_description?.value,
        business_name: slots.business_name?.value || slots.company_name?.value,
        offer: sugg.offer,
        timezone: ZONE,
      }
    : { timezone: ZONE };

  return (
    <>
      <Field label="1. Research the website (optional)" hint="Fills the business description and suggests an offer.">
        <div className="row">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" style={{ flex: 1 }} />
          <Button variant="ghost" busy={researching} onClick={doResearch}>Research</Button>
        </div>
      </Field>
      {research && <Notice tone="ok">Read {url}. Research id <code>{research.research_id}</code>{research.expires_at ? `, valid until ${when(research.expires_at)}` : ''}.</Notice>}
      {job ? (
        <Notice tone={job.status === 'done' ? 'ok' : job.error || job.status === 'failed' ? 'error' : 'info'}>
          Job <code>{job.job_id}</code>: <Status value={job.status} /> {job.error || (job.status !== 'done' && job.status !== 'failed' ? 'Writing the agent — usually 1–3 minutes…' : '')}
          {(job.status === 'done' || job.status === 'failed' || job.error) && <> <button type="button" className="linkish" onClick={() => setJob(null)}>start another</button></>}
        </Notice>
      ) : (
        <>
          <strong style={{ fontSize: 13 }}>2. Campaign</strong>
          <EndpointForm
            slug="create-dbr-campaign-new-agent"
            fixed={{ workspace_id: workspaceId }}
            initial={initial}
            choices={{ calendar_id: (calendars.rows as any[]).map((c) => ({ value: String(c.id), label: c.name })) }}
            submit="Create campaign + agent"
            onDone={(r) => {
              const id = r.data?.data?.job_id;
              if (!id) return;
              setJob({ job_id: id, status: r.data.data.status || 'queued' });
              poll(id);
            }}
          />
        </>
      )}
    </>
  );
}
