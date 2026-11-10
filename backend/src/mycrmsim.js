// Talking to myCRMSIM: the OAuth code exchange, refreshing the token, and API calls
// made with the stored access token. Only this backend ever holds the tokens and the
// client secret; the browser asks this backend, which asks myCRMSIM.
const crypto = require("crypto");
const config = require("./config");
const store = require("./store");

const TOKEN_PATH = "/api/v1/third_party_integrations/oauth/token";
const REFRESH_EARLY_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 30 * 1000;

// state → { at, returnTo }. Stops a callback that this backend didn't start, and
// remembers which frontend started it (Vite moves to 5174 when 5173 is taken).
const pendingStates = new Map();

const installUrl = (returnTo = null) => {
  const state = crypto.randomBytes(12).toString("hex");
  pendingStates.set(state, { at: Date.now(), returnTo });
  for (const [s, p] of pendingStates) if (Date.now() - p.at > 15 * 60 * 1000) pendingStates.delete(s);
  const query = new URLSearchParams({ redirect_uri: config.REDIRECT_URI, state });
  return `${config.DASHBOARD_URL}/integrations/install/${encodeURIComponent(config.CLIENT_ID)}?${query}`;
};

/** The pending install for this state (removed), or null when this backend didn't start it. */
const takeState = (state) => {
  const pending = state ? pendingStates.get(state) : null;
  if (!pending) return null;
  pendingStates.delete(state);
  return pending;
};

const readJson = async (res) => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { success: false, message: text.slice(0, 500) };
  }
};

const tokenRequest = async (body) => {
  const res = await fetch(`${config.API_URL}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, client_id: config.CLIENT_ID, client_secret: config.CLIENT_SECRET }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await readJson(res);
  if (!res.ok || !data?.success) throw new Error(data?.message || `Token request failed (${res.status})`);
  return data.data;
};

const saveTokens = (tokens, extra = {}) => {
  const install = {
    ...(store.getInstall() || {}),
    ...extra,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || store.getInstall()?.refresh_token,
    scopes: tokens.scopes || store.getInstall()?.scopes || [],
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    refreshed_at: new Date().toISOString(),
  };
  store.setInstall(install);
  return install;
};

const exchangeCode = async (code) => {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: config.REDIRECT_URI });
  return saveTokens(tokens, { installed_at: new Date().toISOString() });
};

// One refresh at a time: two requests that both find the token stale share it.
let refreshing = null;
const refresh = () => {
  if (!refreshing) {
    const install = store.getInstall();
    if (!install?.refresh_token) return Promise.reject(new Error("Not connected: install the app first."));
    refreshing = tokenRequest({ grant_type: "refresh_token", refresh_token: install.refresh_token })
      .then((tokens) => saveTokens(tokens))
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
};

const accessToken = async () => {
  const install = store.getInstall();
  if (!install?.access_token) throw Object.assign(new Error("Not connected: install the app first."), { status: 401 });
  if (Date.now() > install.expires_at - REFRESH_EARLY_MS) return (await refresh()).access_token;
  return install.access_token;
};

/**
 * One API call with the stored token. A 401 is retried once after a refresh (the
 * token may have been revoked early or the clock is off).
 * @returns {Promise<{status: number, data: any, ms: number}>}
 */
const call = async ({ method = "GET", path, query, body }) => {
  const url = new URL(`${config.API_URL}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const send = async (token) => {
    const started = Date.now();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined && method !== "GET" ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined && method !== "GET" ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, data: await readJson(res), ms: Date.now() - started };
  };

  let result = await send(await accessToken());
  if (result.status === 401 && /expired|invalid/i.test(result.data?.message || "")) {
    result = await send((await refresh()).access_token);
  }
  store.addRequest({
    at: new Date().toISOString(),
    method,
    path: url.pathname + url.search,
    status: result.status,
    ms: result.ms,
  });
  return result;
};

/** Is this callback really from myCRMSIM? HMAC-SHA256 of the raw body with the client secret. */
const verifySignature = (rawBody, header) => {
  if (!config.CLIENT_SECRET || !header) return false;
  const expected = `sha256=${crypto.createHmac("sha256", config.CLIENT_SECRET).update(rawBody).digest("hex")}`;
  const given = String(header);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
};

module.exports = { installUrl, takeState, exchangeCode, refresh, call, verifySignature };
