import { Fragment } from 'react';
import { useApp, useRoute } from './state';
import { Select } from './ui';
import Connect from './pages/Connect';
import Workspaces from './pages/Workspaces';
import Contacts from './pages/Contacts';
import Devices from './pages/Devices';
import Messages from './pages/Messages';
import Calls from './pages/Calls';
import Events from './pages/Events';
import Explorer from './pages/Explorer';
import Tags from './pages/Tags';
import Conversations from './pages/Conversations';
import Groups from './pages/Groups';
import CallCenter from './pages/CallCenter';
import VoiceAgents from './pages/VoiceAgents';
import Opportunities from './pages/Opportunities';
import Appointments from './pages/Appointments';
import Tasks from './pages/Tasks';
import LeadForms from './pages/LeadForms';
import Automations from './pages/Automations';
import AiAgents from './pages/AiAgents';
import DbrCampaigns from './pages/DbrCampaigns';
import SubaccountAdmins from './pages/SubaccountAdmins';

const PAGES = [
  { group: 'Setup', path: '/connect', label: 'Connect', icon: '⚡', title: 'Connection', needsWorkspace: false },
  { group: 'Setup', path: '/workspaces', label: 'Workspaces', icon: '▦', title: 'Workspaces', needsWorkspace: false },
  { group: 'Setup', path: '/devices', label: 'Devices', icon: '▣', title: 'Devices', needsWorkspace: false },
  { group: 'Setup', path: '/subaccount-admins', label: 'Subaccount admins', icon: '♚', title: 'Subaccount admins', needsWorkspace: false },
  { group: 'Contacts', path: '/contacts', label: 'Contacts', icon: '☺', title: 'Contacts', needsWorkspace: true },
  { group: 'Contacts', path: '/tags', label: 'Tags & fields', icon: '#', title: 'Tags & custom fields', needsWorkspace: true },
  { group: 'Messaging', path: '/messages', label: 'Messages', icon: '✉', title: 'Messages', needsWorkspace: true },
  { group: 'Messaging', path: '/conversations', label: 'Conversations', icon: '☰', title: 'Conversations', needsWorkspace: true },
  { group: 'Messaging', path: '/groups', label: 'Group chats', icon: '◎', title: 'Group chats', needsWorkspace: true },
  { group: 'Calling', path: '/calls', label: 'Calls', icon: '☎', title: 'Calls', needsWorkspace: true },
  { group: 'Calling', path: '/call-center', label: 'Call center', icon: '◷', title: 'Call center', needsWorkspace: true },
  { group: 'Calling', path: '/voice-agents', label: 'Voice agents', icon: '♪', title: 'Voice agents', needsWorkspace: true },
  { group: 'CRM', path: '/opportunities', label: 'Opportunities', icon: '◆', title: 'Opportunities', needsWorkspace: true },
  { group: 'CRM', path: '/appointments', label: 'Calendar', icon: '▤', title: 'Calendars & appointments', needsWorkspace: true },
  { group: 'CRM', path: '/tasks', label: 'Tasks', icon: '✓', title: 'Tasks', needsWorkspace: true },
  { group: 'CRM', path: '/lead-forms', label: 'Lead forms', icon: '▭', title: 'Lead forms', needsWorkspace: true },
  { group: 'Automation & AI', path: '/automations', label: 'Automations', icon: '⟳', title: 'Automations', needsWorkspace: true },
  { group: 'Automation & AI', path: '/ai-agents', label: 'AI agents', icon: '✦', title: 'AI agents', needsWorkspace: true },
  { group: 'Automation & AI', path: '/dbr-campaigns', label: 'DBR campaigns', icon: '➚', title: 'DBR campaigns', needsWorkspace: true },
  { group: 'Developer', path: '/events', label: 'Events', icon: '⇄', title: 'Callback events', needsWorkspace: false },
  { group: 'Developer', path: '/explorer', label: 'API Explorer', icon: '⌘', title: 'API Explorer', needsWorkspace: false },
];

const EMPTY = new URLSearchParams();

export default function App() {
  const { session, workspaces, workspaceId, setWorkspaceId, events, toasts } = useApp();
  const { path, params } = useRoute();
  const page = PAGES.find((p) => p.path === path) || PAGES[0];
  const connected = Boolean(session?.connected);

  return (
    <div className="layout">
      <aside className="side">
        <div className="logo">
          <span className="logo-mark">ES</span> External System
        </div>
        {PAGES.map((p, i) => (
          <Fragment key={p.path}>
          {p.group !== PAGES[i - 1]?.group && <div className="nav-group">{p.group}</div>}
          <a href={`#${p.path}`} className={`nav ${p.path === page.path ? 'active' : ''}`}>
            <span className="nav-icon">{p.icon}</span>
            {p.label}
            {p.path === '/events' && events.length > 0 && <span className="nav-count">{events.length}</span>}
          </a>
          </Fragment>
        ))}
        <div className="side-foot">
          <span className={`dot ${connected ? 'dot-on' : 'dot-off'}`} />
          {connected ? `Connected as ${session?.me?.user?.name || 'your account'}` : 'Not connected'}
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <h1>{page.title}</h1>
          {connected && workspaces.length > 0 && (
            <label className="ws-picker">
              Workspace
              <Select value={workspaceId ?? ''} onChange={(e) => setWorkspaceId(Number(e.target.value) || null)}>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} (#{w.id})
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
        <div className="content">
          {!connected && page.path !== '/connect' && page.path !== '/events' ? (
            <div className="notice notice-warn">
              Connect the app to a myCRMSIM account first: <a href="#/connect">Connection</a>.
            </div>
          ) : page.needsWorkspace && !workspaceId ? (
            <div className="notice notice-warn">
              Pick or create a workspace first: <a href="#/workspaces">Workspaces</a>.
            </div>
          ) : (
            <>
              {/* Calls stays mounted: a live call (its audio room) survives moving to another page. */}
              {connected && workspaceId && (
                <div style={{ display: page.path === '/calls' ? 'contents' : 'none' }}>
                  <Calls params={page.path === '/calls' ? params : EMPTY} />
                </div>
              )}
              {page.path === '/connect' && <Connect params={params} />}
              {page.path === '/workspaces' && <Workspaces />}
              {page.path === '/devices' && <Devices />}
              {page.path === '/contacts' && <Contacts />}
              {page.path === '/messages' && <Messages params={params} />}
              {page.path === '/events' && <Events />}
              {page.path === '/explorer' && <Explorer params={params} />}
              {page.path === '/subaccount-admins' && <SubaccountAdmins />}
              {page.path === '/tags' && <Tags />}
              {page.path === '/conversations' && <Conversations params={params} />}
              {page.path === '/groups' && <Groups />}
              {page.path === '/call-center' && <CallCenter />}
              {page.path === '/voice-agents' && <VoiceAgents />}
              {page.path === '/opportunities' && <Opportunities />}
              {page.path === '/appointments' && <Appointments />}
              {page.path === '/tasks' && <Tasks />}
              {page.path === '/lead-forms' && <LeadForms />}
              {page.path === '/automations' && <Automations />}
              {page.path === '/ai-agents' && <AiAgents />}
              {page.path === '/dbr-campaigns' && <DbrCampaigns />}
            </>
          )}
        </div>
      </main>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
