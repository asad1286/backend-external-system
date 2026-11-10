// External system — a third-party app built on the myCRMSIM API.
//
//   /oauth/install, /oauth/callback   install the app on a myCRMSIM account
//   /api/*                            what the frontend uses (session, proxy, events)
//   /webhooks/mycrmsim                the app's Callback URL: message.status,
//                                     message.inbound and call.status events
//
// Run: cp .env.example .env (fill in CLIENT_ID / CLIENT_SECRET), npm install, npm run dev.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const config = require("./config");
const store = require("./store");
const mycrmsim = require("./mycrmsim");

if (config.PRODUCTION && !config.APP_PASSWORD) {
  console.error("APP_PASSWORD is not set. In production every page needs a password: set APP_PASSWORD (and optionally APP_USER).");
  process.exit(1);
}

const app = express();
app.set("trust proxy", true);

app.get("/healthz", (req, res) => res.json({ ok: true }));

// ── Live events for the browser (Server-Sent Events) ───────────────────────────────────
const listeners = new Set();
const broadcast = (event) => {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) res.write(line);
};

// ── The Callback URL. Raw body first: the signature is over the exact bytes. ───────────
app.post("/webhooks/mycrmsim", express.raw({ type: "*/*", limit: "2mb" }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  let body = null;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ ok: false, message: "Body is not JSON." });
  }
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    received_at: new Date().toISOString(),
    type: req.get("X-MyCRMSIM-Event") || body?.event || "unknown",
    verified: mycrmsim.verifySignature(raw, req.get("X-MyCRMSIM-Signature")),
    body,
  };
  store.addEvent(event);
  broadcast({ kind: "webhook", event });
  // Answer at once: myCRMSIM waits 4 seconds and never retries.
  res.json({ ok: true });
});

// ── Password (Basic auth) — after the Callback URL, which myCRMSIM calls without one ──
const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
if (config.APP_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = String(req.get("authorization") || "").split(" ");
    if (scheme === "Basic" && encoded) {
      const raw = Buffer.from(encoded, "base64").toString("utf8");
      const i = raw.indexOf(":");
      if (i > 0 && same(raw.slice(0, i), config.APP_USER) && same(raw.slice(i + 1), config.APP_PASSWORD)) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="External System", charset="UTF-8"').status(401).send("Password required.");
  });
}

app.use(express.json({ limit: "2mb" }));

// ── OAuth ─────────────────────────────────────────────────────────────────────────────
// The frontend that started the install, from its Referer: FRONTEND_URL, PUBLIC_URL
// (this backend serving the built frontend), or any localhost port (Vite takes the next free one). Anything else gets FRONTEND_URL.
const frontendOf = (req) => {
  try {
    const origin = new URL(req.get("referer") || "").origin;
    if (origin === new URL(config.FRONTEND_URL).origin || origin === new URL(config.PUBLIC_URL).origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  } catch {
    // No or odd Referer.
  }
  return config.FRONTEND_URL;
};

app.get("/oauth/install", (req, res) => {
  const frontend = frontendOf(req);
  if (!config.CLIENT_ID || !config.CLIENT_SECRET) {
    return res.redirect(`${frontend}/#/connect?error=${encodeURIComponent("Set CLIENT_ID and CLIENT_SECRET in backend/.env first.")}`);
  }
  res.redirect(mycrmsim.installUrl(frontend));
});

app.get("/oauth/callback", async (req, res) => {
  const pending = req.query.state ? mycrmsim.takeState(String(req.query.state)) : null;
  const frontend = pending?.returnTo || config.FRONTEND_URL;
  const back = (params) => res.redirect(`${frontend}/#/connect?${new URLSearchParams(params)}`);
  if (req.query.error) return back({ error: `myCRMSIM said: ${req.query.error}` });
  if (!req.query.code) return back({ error: "The callback came back without a code." });
  if (req.query.state && !pending) {
    return back({ error: "This install was not started here (unknown state). Start it again." });
  }
  try {
    await mycrmsim.exchangeCode(String(req.query.code));
    back({ connected: "1" });
  } catch (err) {
    back({ error: err.message });
  }
});

// ── Session ───────────────────────────────────────────────────────────────────────────
const publicConfig = () => ({
  api_url: config.API_URL,
  dashboard_url: config.DASHBOARD_URL,
  redirect_uri: config.REDIRECT_URI,
  webhook_url: config.WEBHOOK_URL,
  public_url_set: !config.PUBLIC_URL.startsWith("http://localhost"),
  client_id: config.CLIENT_ID || null,
  has_secret: Boolean(config.CLIENT_SECRET),
});

app.get("/api/session", async (req, res) => {
  const install = store.getInstall();
  const session = {
    config: publicConfig(),
    connected: Boolean(install?.access_token),
    install: install
      ? { scopes: install.scopes || [], installed_at: install.installed_at, refreshed_at: install.refreshed_at, expires_at: new Date(install.expires_at).toISOString() }
      : null,
    me: null,
    me_error: null,
  };
  if (session.connected) {
    try {
      const r = await mycrmsim.call({ path: "/api/v1/integration/me" });
      if (r.status === 200 && r.data?.success) session.me = r.data.data;
      else session.me_error = r.data?.message || `HTTP ${r.status}`;
    } catch (err) {
      session.me_error = err.message;
    }
  }
  res.json(session);
});

app.post("/api/session/refresh", async (req, res) => {
  try {
    const install = await mycrmsim.refresh();
    res.json({ ok: true, expires_at: new Date(install.expires_at).toISOString(), scopes: install.scopes });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// Forgets the tokens here. The install stays on the myCRMSIM account until it is removed there.
app.post("/api/session/disconnect", (req, res) => {
  store.setInstall(null);
  res.json({ ok: true });
});

// ── The API, through this backend ─────────────────────────────────────────────────────
// { method, path, query, body } → myCRMSIM, with the stored token. Only the app API.
const ALLOWED = /^\/api\/v1\/(ext|integration)\//;
app.post("/api/call", async (req, res) => {
  const { method = "GET", path, query, body } = req.body || {};
  const verb = String(method).toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(verb)) return res.status(400).json({ message: "Unsupported method." });
  if (typeof path !== "string" || !ALLOWED.test(path) || path.includes("..")) {
    return res.status(400).json({ message: "path must start with /api/v1/ext/ or /api/v1/integration/." });
  }
  try {
    res.json(await mycrmsim.call({ method: verb, path, query, body }));
  } catch (err) {
    res.status(err.status || 502).json({ status: err.status || 502, data: { success: false, message: err.message }, ms: 0 });
  }
});

app.get("/api/requests", (req, res) => res.json(store.requests()));

// ── Events ────────────────────────────────────────────────────────────────────────────
app.get("/api/events", (req, res) => res.json(store.events()));
app.delete("/api/events", (req, res) => {
  store.clearEvents();
  res.json({ ok: true });
});

app.get("/api/events/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write(": connected\n\n");
  listeners.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    listeners.delete(res);
  });
});

// ── The built frontend, when there is one (production / Docker) ──────────────────────────
if (fs.existsSync(path.join(config.FRONTEND_DIST, "index.html"))) {
  app.use(express.static(config.FRONTEND_DIST, { index: "index.html", maxAge: "1h" }));
  console.log(`  Serving the frontend from ${config.FRONTEND_DIST}`);
}

app.listen(config.PORT, () => {
  console.log(`External system backend on http://localhost:${config.PORT}`);
  console.log(`  myCRMSIM API      ${config.API_URL}`);
  console.log(`  myCRMSIM dashboard ${config.DASHBOARD_URL}`);
  console.log(`  Redirect URI      ${config.REDIRECT_URI}`);
  console.log(`  Callback URL      ${config.WEBHOOK_URL}`);
  console.log(`  Password          ${config.APP_PASSWORD ? `on (user ${config.APP_USER})` : "off"}`);
  if (!config.CLIENT_ID || !config.CLIENT_SECRET) console.warn("  CLIENT_ID / CLIENT_SECRET are not set: the install button stays off.");
});
