// The install (tokens) and the last events, kept in backend/data/store.json so a
// restart doesn't lose the connection. One install: this is a single-account demo.
const fs = require("fs");
const path = require("path");
const { DATA_FILE } = require("./config");

const MAX_EVENTS = 500;
const MAX_REQUESTS = 200;

const empty = () => ({ install: null, events: [], requests: [] });

let state = empty();
try {
  state = { ...empty(), ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
} catch {
  // First run, or an unreadable file: start clean.
}

let timer = null;
const save = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  }, 200);
};

module.exports = {
  getInstall: () => state.install,
  setInstall: (install) => {
    state.install = install;
    save();
  },
  events: () => state.events,
  addEvent: (event) => {
    state.events.unshift(event);
    state.events.length = Math.min(state.events.length, MAX_EVENTS);
    save();
  },
  clearEvents: () => {
    state.events = [];
    save();
  },
  requests: () => state.requests,
  addRequest: (entry) => {
    state.requests.unshift(entry);
    state.requests.length = Math.min(state.requests.length, MAX_REQUESTS);
    save();
  },
};
