// Settings, from backend/.env (see .env.example).
const path = require("path");

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  // No .env: the environment (or the defaults below) decides.
}

const trimSlash = (url) => String(url || "").trim().replace(/\/+$/, "");

const PORT = Number(process.env.PORT || 4000);
const PUBLIC_URL = trimSlash(process.env.PUBLIC_URL) || `http://localhost:${PORT}`;

module.exports = {
  PORT,
  PUBLIC_URL,
  DASHBOARD_URL: trimSlash(process.env.MYCRMSIM_DASHBOARD_URL) || "https://app.mycrmsim.com",
  API_URL: trimSlash(process.env.MYCRMSIM_API_URL) || "https://backend.mysmsgateway.app",
  CLIENT_ID: String(process.env.CLIENT_ID || "").trim(),
  CLIENT_SECRET: String(process.env.CLIENT_SECRET || "").trim(),
  FRONTEND_URL: trimSlash(process.env.FRONTEND_URL) || "http://localhost:5173",
  // Must match the app's Redirect URI in myCRMSIM exactly.
  REDIRECT_URI: String(process.env.REDIRECT_URI || "").trim() || `http://localhost:${PORT}/oauth/callback`,
  WEBHOOK_URL: `${PUBLIC_URL}/webhooks/mycrmsim`,
  DATA_FILE: path.join(__dirname, "..", "data", "store.json"),
  // The built frontend (frontend/dist, or FRONTEND_DIST in the Docker image). When it
  // exists this backend serves it too, so one service is the whole system.
  FRONTEND_DIST: process.env.FRONTEND_DIST || path.join(__dirname, "..", "..", "frontend", "dist"),
  // Basic auth for everything except the Callback URL and /healthz. Required when
  // NODE_ENV=production: the system acts on the connected account with its token.
  APP_USER: String(process.env.APP_USER || "admin").trim(),
  APP_PASSWORD: String(process.env.APP_PASSWORD || ""),
  PRODUCTION: process.env.NODE_ENV === "production",
};
