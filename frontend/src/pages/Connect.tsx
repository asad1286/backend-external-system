import { useEffect, useState } from 'react';
import { backend } from '../api';
import { useApp } from '../state';
import { Badge, Button, Card, Copy, Notice, when } from '../ui';

const CALL_SCOPES = ['calls.read', 'calls.write'];

export default function Connect({ params }: { params: URLSearchParams }) {
  const { session, loadingSession, reloadSession, toast, workspaces, events } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const error = params.get('error');

  useEffect(() => {
    if (params.get('connected')) {
      toast('Installed. The app is connected.', 'ok');
      window.history.replaceState(null, '', '#/connect');
      reloadSession();
    }
  }, [params, toast, reloadSession]);

  if (loadingSession && !session) return <Card><div className="empty">Loading…</div></Card>;
  if (!session) {
    return (
      <Notice tone="error">
        The backend is not answering. Start it: <code>cd backend && npm run dev</code> (port 4000).
      </Notice>
    );
  }

  const { config, connected, install, me } = session;
  const scopes = me?.scopes || install?.scopes || [];
  const configured = Boolean(config.client_id && config.has_secret);

  const refresh = async () => {
    setBusy('refresh');
    try {
      await backend('POST', '/api/session/refresh');
      toast('Token refreshed.', 'ok');
      await reloadSession();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Forget the tokens in this system? The app stays installed on the myCRMSIM account until you remove it there.')) return;
    setBusy('disconnect');
    await backend('POST', '/api/session/disconnect').catch(() => {});
    await reloadSession();
    setBusy(null);
  };

  const steps = [
    { done: configured, text: <>Create the app in myCRMSIM (Integrations → Custom App Integration) with Redirect URI <code>{config.redirect_uri}</code>. Once approved, put its Client ID and Secret in <code>backend/.env</code>.</> },
    { done: connected, text: <>Install the app on your account with the button on the right.</> },
    { done: workspaces.length > 0, text: <>Pick or create a workspace (<a href="#/workspaces">Workspaces</a>).</> },
    { done: events.length > 0, text: <>Set the app's Callback URL to this system's public address + <code>/webhooks/mycrmsim</code> to receive message and call events.</> },
  ];

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid-2">
        <Card
          title="myCRMSIM account"
          actions={connected ? <Badge tone="green">Connected</Badge> : <Badge tone="red">Not connected</Badge>}
        >
          {connected ? (
            <>
              <dl className="kv">
                <dt>Account</dt>
                <dd>{me?.user ? `${me.user.name} · ${me.user.email}` : session.me_error || '—'}</dd>
                <dt>App</dt>
                <dd>{me?.integration?.name || '—'}</dd>
                <dt>Installed</dt>
                <dd>{when(install?.installed_at)}</dd>
                <dt>Token valid until</dt>
                <dd>{when(install?.expires_at)}</dd>
              </dl>
              <div>
                <div className="muted" style={{ marginBottom: 8 }}>Scopes granted ({scopes.length})</div>
                <div className="chips">
                  {scopes.length ? scopes.map((s) => <Badge key={s} tone={CALL_SCOPES.includes(s) ? 'violet' : 'blue'}>{s}</Badge>) : <span className="muted">none</span>}
                </div>
              </div>
              {!CALL_SCOPES.some((s) => scopes.includes(s)) && (
                <Notice tone="warn">This install has no Calls scope. Add <code>calls.read</code> and <code>calls.write</code> to the app, then install again.</Notice>
              )}
              <div className="row">
                <Button variant="ghost" busy={busy === 'refresh'} onClick={refresh}>Refresh token</Button>
                <a className="btn btn-ghost" href="/oauth/install">Install again</a>
                <Button variant="danger" busy={busy === 'disconnect'} onClick={disconnect}>Disconnect</Button>
              </div>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>
                Opens the myCRMSIM consent page. After you approve, myCRMSIM sends you back here and this system keeps the tokens on its backend.
              </p>
              <div>
                <a className={`btn btn-primary btn-lg ${configured ? '' : 'disabled'}`} href={configured ? '/oauth/install' : undefined} aria-disabled={!configured}>
                  Install on myCRMSIM
                </a>
              </div>
              {!configured && <Notice tone="warn">Set <code>CLIENT_ID</code> and <code>CLIENT_SECRET</code> in <code>backend/.env</code> and restart the backend.</Notice>}
            </>
          )}
        </Card>

        <Card title="Setup">
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={i} className={s.done ? 'done' : ''}>{s.text}</li>
            ))}
          </ol>
        </Card>
      </div>

      <Card title="This system">
        <dl className="kv">
          <dt>myCRMSIM API</dt>
          <dd><code>{config.api_url}</code></dd>
          <dt>Dashboard</dt>
          <dd><code>{config.dashboard_url}</code></dd>
          <dt>Client ID</dt>
          <dd>{config.client_id ? <code>{config.client_id}</code> : <span className="muted">not set</span>}</dd>
          <dt>Redirect URI</dt>
          <dd><code>{config.redirect_uri}</code><Copy text={config.redirect_uri} /></dd>
          <dt>Callback URL</dt>
          <dd><code>{config.webhook_url}</code><Copy text={config.webhook_url} /></dd>
        </dl>
        {!config.public_url_set && (
          <Notice tone="info">
            myCRMSIM can't reach <code>localhost</code>. To receive callback events, open a tunnel to port 4000 (for example <code>ngrok http 4000</code>), set <code>PUBLIC_URL</code> in <code>backend/.env</code> to its address, restart, and use the Callback URL above on the app.
          </Notice>
        )}
      </Card>
    </>
  );
}
