const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// ====== 1) EDIT THESE NAMES ======
const PARTICIPANTS = [
  'Alice',
  'Bob',
  'Charlie',
  'Danielle',
  'Erin',
  'Frank'
];
// Optional: add exclusions (e.g., spouses). Format: { "Alice": ["Bob"], "Bob": ["Alice"] }
const EXCLUSIONS = {
  // 'Alice': ['Bob'],
};
// =================================

let state = null;

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('Unexpected error while handling request', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal server error' });
    } else {
      res.end();
    }
  });
});

startServer();

async function startServer() {
  try {
    await loadState();
    server.listen(PORT, () => {
      console.log(`Secret Santa server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
}

async function handleRequest(req, res) {
  const { method } = req;
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/') && method === 'OPTIONS') {
    sendOptions(res);
    return;
  }

  if (pathname === '/api/state') {
    if (method !== 'GET') {
      sendMethodNotAllowed(res, 'GET');
      return;
    }
    await ensureState();
    const summary = summarizeState();
    sendJson(res, 200, summary);
    return;
  }

  if (pathname === '/api/draw') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res, 'POST');
      return;
    }
    await ensureState();
    const body = await readJson(req).catch((err) => {
      const status = err && err.statusCode ? err.statusCode : 400;
      const message = err && err.message ? err.message : 'Invalid request body';
      sendJson(res, status, { error: message });
      return null;
    });
    if (!body) return;

    const giver = typeof body.giver === 'string' ? body.giver.trim() : '';
    if (!giver) {
      sendJson(res, 400, { error: 'Missing or invalid "giver" name.' });
      return;
    }
    if (!state.participants.includes(giver)) {
      sendJson(res, 404, { error: 'That name is not in the participant list.' });
      return;
    }
    if (state.revealed[giver]) {
      sendJson(res, 409, { error: 'That person already drew a name.' });
      return;
    }
    const recipient = state.assignments[giver];
    if (!recipient) {
      sendJson(res, 500, { error: 'No assignment found. Try resetting the draw.' });
      return;
    }

    state.revealed[giver] = true;
    state.history.push({
      giver,
      recipient,
      revealedAt: new Date().toISOString()
    });

    try {
      await saveState();
    } catch (err) {
      console.error('Failed to persist draw', err);
      state.revealed[giver] = false;
      state.history.pop();
      sendJson(res, 500, { error: 'Could not save the draw. Please try again.' });
      return;
    }

    const summary = summarizeState();
    sendJson(res, 200, {
      giver,
      recipient,
      remaining: summary.remaining,
      total: summary.total,
      takenRecipients: summary.takenRecipients
    });
    return;
  }

  if (pathname === '/api/reset') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res, 'POST');
      return;
    }
    await resetState();
    const summary = summarizeState();
    sendJson(res, 200, {
      message: 'Secret Santa assignments reset.',
      remaining: summary.remaining,
      total: summary.total
    });
    return;
  }

  if ((pathname === '/' || pathname === '/Secret_santa_V1.html') && method === 'GET') {
    await serveHtml(res);
    return;
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  sendNotFound(res);
}

async function ensureState() {
  if (!state) {
    await loadState();
  }
}

async function loadState() {
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isValidState(parsed)) {
      console.warn('Existing state file invalid or outdated. Rebuilding.');
      await resetState();
      return;
    }
    state = normalizeState(parsed);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      await resetState();
      return;
    }
    console.warn('Could not read state file. Creating a new one.', err);
    await resetState();
  }
}

async function resetState() {
  state = await buildFreshState();
  await saveState();
}

async function buildFreshState() {
  const assignments = makeAssignments(PARTICIPANTS, EXCLUSIONS);
  const revealed = Object.fromEntries(PARTICIPANTS.map((name) => [name, false]));
  return {
    participants: [...PARTICIPANTS],
    exclusions: EXCLUSIONS,
    assignments,
    revealed,
    history: [],
    createdAt: new Date().toISOString()
  };
}

async function saveState() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const data = JSON.stringify(state, null, 2);
  await fsp.writeFile(STATE_FILE, data, 'utf8');
}

function summarizeState() {
  const remainingNames = getAvailableGivers(state);
  const takenRecipients = getTakenRecipients(state);
  return {
    participants: [...state.participants],
    revealed: { ...state.revealed },
    remaining: remainingNames.length,
    total: state.participants.length,
    takenRecipients,
    createdAt: state.createdAt
  };
}

function getAvailableGivers(currentState) {
  return currentState.participants.filter((name) => !currentState.revealed[name]);
}

function getTakenRecipients(currentState) {
  const recipients = [];
  for (const [giver, wasRevealed] of Object.entries(currentState.revealed)) {
    if (wasRevealed) {
      const recipient = currentState.assignments[giver];
      if (recipient) recipients.push(recipient);
    }
  }
  return recipients;
}

function isValidState(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  if (!Array.isArray(candidate.participants)) return false;
  if (!arrayEqualIgnoreOrder(candidate.participants, PARTICIPANTS)) return false;
  if (!candidate.assignments || typeof candidate.assignments !== 'object') return false;
  if (!candidate.revealed || typeof candidate.revealed !== 'object') return false;
  return validateAssignments(candidate.assignments, candidate.participants, candidate.exclusions || {});
}

function normalizeState(rawState) {
  const normalized = {
    participants: [...rawState.participants],
    exclusions: rawState.exclusions || {},
    assignments: { ...rawState.assignments },
    revealed: { ...rawState.revealed },
    history: Array.isArray(rawState.history) ? [...rawState.history] : [],
    createdAt: rawState.createdAt || new Date().toISOString()
  };
  for (const name of normalized.participants) {
    if (typeof normalized.revealed[name] !== 'boolean') {
      normalized.revealed[name] = false;
    }
  }
  // Drop stale entries
  for (const key of Object.keys(normalized.revealed)) {
    if (!normalized.participants.includes(key)) {
      delete normalized.revealed[key];
    }
  }
  return normalized;
}

async function serveHtml(res) {
  try {
    const filePath = path.join(__dirname, 'Secret_santa_V1.html');
    const stream = fs.createReadStream(filePath);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('Failed while streaming HTML file', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Could not read HTML file.' });
      } else {
        res.end();
      }
    });
  } catch (err) {
    console.error('Error serving HTML file', err);
    sendJson(res, 500, { error: 'Could not serve HTML file.' });
  }
}

function sendOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  });
  res.end();
}

function sendJson(res, statusCode, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(data);
}

function sendNotFound(res) {
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end('Not Found');
}

function sendMethodNotAllowed(res, allowed) {
  res.writeHead(405, {
    'Content-Type': 'application/json; charset=utf-8',
    'Allow': allowed,
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify({ error: `Method not allowed. Use ${allowed}.` }));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) { // ~1MB
        req.destroy();
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('Invalid JSON payload'), { statusCode: 400 }));
      }
    });
    req.on('error', (err) => {
      reject(Object.assign(err, { statusCode: 400 }));
    });
  });
}

function makeAssignments(names, exclusions) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const shuffled = shuffle([...names]);
    for (let i = 0; i < names.length; i += 1) {
      if (shuffled[i] === names[i]) {
        const j = i === names.length - 1 ? 0 : i + 1;
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
    }
    const mapping = {};
    let ok = true;
    for (let i = 0; i < names.length; i += 1) {
      const giver = names[i];
      const recv = shuffled[i];
      mapping[giver] = recv;
      if (!validatePair(giver, recv, exclusions)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (fixExclusions(mapping, names, exclusions) && validateAssignments(mapping, names, exclusions)) {
      return mapping;
    }
  }
  throw new Error('Could not build assignments with the given exclusions.');
}

function validatePair(giver, recv, exclusions) {
  if (giver === recv) return false;
  const banned = new Set([giver, ...(exclusions[giver] || [])]);
  return !banned.has(recv);
}

function fixExclusions(map, names, exclusions) {
  const isBanned = (giver, recv) => {
    const banned = new Set([giver, ...(exclusions[giver] || [])]);
    return banned.has(recv);
  };

  for (let i = 0; i < names.length; i += 1) {
    const giver = names[i];
    const recv = map[giver];
    if (isBanned(giver, recv) || giver === recv) {
      let swapped = false;
      for (let j = 0; j < names.length; j += 1) {
        if (i === j) continue;
        const other = names[j];
        const otherRecv = map[other];
        if (other === giver || otherRecv === giver) continue;
        if (!isBanned(giver, otherRecv) && !isBanned(other, recv) && giver !== otherRecv && other !== recv) {
          map[giver] = otherRecv;
          map[other] = recv;
          swapped = true;
          break;
        }
      }
      if (!swapped) return false;
    }
  }
  return names.every((name) => map[name] && map[name] !== name);
}

function validateAssignments(mapping, names, exclusions) {
  const seenRecipients = new Set();
  for (const giver of names) {
    const recv = mapping[giver];
    if (!recv || !names.includes(recv)) return false;
    if (giver === recv) return false;
    const banned = new Set([giver, ...(exclusions[giver] || [])]);
    if (banned.has(recv)) return false;
    if (seenRecipients.has(recv)) return false;
    seenRecipients.add(recv);
  }
  return seenRecipients.size === names.length;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function arrayEqualIgnoreOrder(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}
