# External System

A third-party system built on the myCRMSIM API, the way a customer would build one:
it installs on a myCRMSIM account with OAuth, then manages workspaces, contacts,
messages and calls, and receives message and call events on its Callback URL.

```
backend/    Express (port 4000) — OAuth install, keeps the tokens, calls myCRMSIM,
            receives callbacks at /webhooks/mycrmsim
frontend/   React + Vite (port 5173) — the screens; talks only to backend/
```

The old single-file OAuth test harness (`server.js`) is still here; its notes are in
`README.old-harness.md`. It also uses port 4000, so stop it before starting `backend/`.

## Screens

Every endpoint in the API docs has a screen (except the OAuth calls, which the backend runs). The sidebar groups them:

| Group | Screen | What it does | API |
|---|---|---|---|
| Setup | Connect | Install the app, see the account, scopes and token; refresh or disconnect | OAuth, `GET /integration/me` |
| | Workspaces | List, create, edit (incl. inbound webhook), delete; pick the workspace the other screens use | `/ext/workspaces` |
| | Devices | Every line with its health; rename, assign, set default, delete; look up by id | `/ext/devices` |
| | Subaccount admins | Invite, edit workspaces and device limits, activate/deactivate, delete | `/ext/subaccount-admins` |
| Contacts | Contacts | List, create; per contact: details, edit, tags, notes, DND, iMessage check | `/ext/contacts` |
| | Tags & fields | Tag library (create, rename, delete) and custom fields | `/ext/tags`, `/ext/custom-fields` |
| Messaging | Messages | Send on any channel (effects, replies); react, edit, unsend, notify anyway; scheduled messages | `/ext/messages` + `message.status` / `message.inbound` |
| | Conversations | Inbox with filters, threads, unread/starred/archived/AI-paused | `/ext/conversations` |
| | Group chats | List and sync groups, create iMessage groups, participants, rename, send | `/ext/groups` |
| Calling | Calls | Place a call and talk in the browser (LiveKit), end, backup line, missed call; live status | `/ext/calls…` + `call.status` |
| | Call center | Recent calls with stages, ringing calls (decline), routing editor, AI calls, WhatsApp call lookup | `/ext/calls…` |
| | Voice agents | Agents, inbound agent, provider catalog, call log with transcripts | `/ext/voice-agents` |
| CRM | Opportunities | Pipeline board and table; move stage, won/lost, edit, activity | `/ext/pipelines`, `/ext/opportunities` |
| | Calendar | Week view, book from free slots, reschedule, cancel, no-show, complete | `/ext/calendars`, `/ext/appointments` |
| | Tasks | Filters, complete/reopen, edit, delete | `/ext/tasks` |
| | Lead forms | Forms, embed snippet, on/off, edit, submissions | `/ext/lead-forms` |
| Automation & AI | Automations | Workflows: steps, activate/deactivate, settings, enroll/remove contacts; create from template or a validated plan; node catalog | `/ext/workflows` |
| | AI agents | Agents, models, edit, duplicate, delete | `/ext/ai-agents` |
| | DBR campaigns | Preflight, campaigns, preview/stop/resume; create on an agent or with a new one (website research, job polling) | `/ext/dbr-campaigns` |
| Developer | Events | Every callback received (signature checked) and every API request made | — |
| | API Explorer | All endpoints from the API docs, with a form to try each one | everything |

The section screens build their forms from the docs data (`frontend/src/data/endpoints.json`, see below) through `frontend/src/kit`, so a field added in the docs shows up after `npm run sync-endpoints`.

## Run

```bash
cd backend
cp .env.example .env      # fill in CLIENT_ID and CLIENT_SECRET
npm install
npm run dev
```

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

## Set up the app in myCRMSIM

1. Integrations → Custom App Integration → create the app.
   - **Redirect URI:** `http://localhost:4000/oauth/callback` (or `REDIRECT_URI` in `.env`)
   - **Scopes:** everything you want to try; calls need `calls.read` and `calls.write`
   - **Callback URL:** this backend's public address + `/webhooks/mycrmsim`
2. Once it is approved, put its Client ID and Secret in `backend/.env`.
3. Open http://localhost:5173 → Connect → **Install on myCRMSIM**.

### Receiving events (Callback URL)

myCRMSIM can't reach `localhost`. Open a tunnel to the backend, then tell the backend
its public address so the Connect screen shows the right Callback URL:

```bash
ngrok http 4000
```

Set `PUBLIC_URL=https://<your-tunnel>` in `backend/.env`, restart the backend, and use
`https://<your-tunnel>/webhooks/mycrmsim` as the app's Callback URL.

### Which myCRMSIM

`backend/.env` points at production by default (`MYCRMSIM_API_URL`,
`MYCRMSIM_DASHBOARD_URL`). For a local myCRMSIM backend use
`MYCRMSIM_API_URL=http://localhost:5005`.

Calls work only where the Calls API is switched on (`EXT_CALLS_API_ENABLED=true` on
that myCRMSIM backend); otherwise the Calls screen says it is off.

## Keeping the API Explorer current

The endpoint list is copied from the API docs repo (`myCRMSIM-Api-Docs`, next to this
folder). After the docs change:

```bash
cd frontend && npm run sync-endpoints
```

## Notes

- Tokens and the last 500 events live in `backend/data/store.json` (one account).
- The access token never reaches the browser: the frontend asks the backend, which
  calls myCRMSIM and refreshes the token when it expires.
- The browser joins a call's audio room with only the room URL and its one-call token.

## Deploy (Render, free web service)

The `Dockerfile` builds the frontend and runs the backend, which serves it, so the whole
system is one web service. Every page asks for a password (Basic auth); only the Callback
URL (`/webhooks/mycrmsim`, signature-checked) and `/healthz` stay open. With
`NODE_ENV=production` (set in the image) it refuses to start without `APP_PASSWORD`.

1. Push this folder to a (private) GitHub repo.
2. Render → **New → Blueprint** → the repo. `render.yaml` creates a free Docker web service with `/healthz` as its health check.
3. Fill the variables it asks for (`<app>` = the service's domain, e.g. `external-system-ab12.onrender.com`):

   | Variable | Value |
   |---|---|
   | `APP_PASSWORD` | a long password |
   | `CLIENT_ID`, `CLIENT_SECRET` | the app's credentials |
   | `PUBLIC_URL`, `FRONTEND_URL` | `https://<app>` |
   | `REDIRECT_URI` | `https://<app>/oauth/callback` |

   The domain is known only after the first deploy: set these three then and redeploy.
4. In myCRMSIM, set the app's Redirect URI to `https://<app>/oauth/callback` and its Callback URL to `https://<app>/webhooks/mycrmsim`.

The free service sleeps after 15 minutes without requests (the next one waits ~1 minute)
and its disk is not kept: after a restart or a new deploy, connect the app again (the
tokens and the event log live in `backend/data/store.json`).
