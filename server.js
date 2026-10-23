#!/usr/bin/env node
// Claude Sessions — read-only local viewer for Claude Code sessions across multiple accounts.
// Zero dependencies. Usage: node server.js [--port 4780] [--dir /extra/claude/config/dir]...
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const readline = require('readline');

const HOME = os.homedir();
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`claude-code-session-manager — read-only local viewer for Claude Code sessions

Usage: node server.js [options]
  --port <n>    port to listen on (default 4780, or $PORT)
  --dir <path>  extra Claude config dir to include (repeatable)
  -h, --help    show this help

Auto-discovers ~/.claude and ~/.claude_* / ~/.claude-* (plus $CLAUDE_CONFIG_DIR).`);
  process.exit(0);
}
if (Number(process.versions.node.split('.')[0]) < 18) { console.error('Node 18+ required'); process.exit(1); }
const argVals = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
const PORT = Number(argVals('--port')[0] || process.env.PORT || 4780);
const CACHE_FILE = path.join(process.env.XDG_CACHE_HOME || path.join(HOME, '.cache'), 'claude-code-session-manager', 'index.json');
const PUBLIC = path.join(__dirname, 'public');

// ---------- account discovery ----------
async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }
async function readJson(p) { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return null; } }

async function discoverAccounts() {
  const dirs = new Set([path.join(HOME, '.claude')]);
  for (const e of await fsp.readdir(HOME, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && /^\.claude[_-]/.test(e.name)) dirs.add(path.join(HOME, e.name));
  }
  if (process.env.CLAUDE_CONFIG_DIR) dirs.add(path.resolve(process.env.CLAUDE_CONFIG_DIR));
  for (const d of argVals('--dir')) dirs.add(path.resolve(d.replace(/^~/, HOME)));

  const accounts = [];
  for (const dir of dirs) {
    if (!(await exists(path.join(dir, 'projects')))) continue;
    // default ~/.claude keeps its identity in ~/.claude.json; custom dirs keep it inside the dir
    const cfg = (await readJson(path.join(dir, '.claude.json')))
      || (dir === path.join(HOME, '.claude') ? await readJson(path.join(HOME, '.claude.json')) : null);
    const oa = (cfg && cfg.oauthAccount) || {};
    accounts.push({
      id: path.basename(dir).replace(/^\./, ''),
      dir,
      isDefault: dir === path.join(HOME, '.claude'),
      email: oa.emailAddress || null,
      name: oa.displayName || oa.fullName || null,
      org: oa.organizationName || null,
      orgType: oa.organizationType || null,
      plan: oa.seatTier || oa.billingType || null,
    });
  }
  accounts.sort((a, b) => (b.isDefault - a.isDefault) || a.id.localeCompare(b.id));
  return accounts;
}

// ---------- session summary index (cached on disk by mtime+size) ----------
const CACHE_VERSION = 2; // bump when summary fields change
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { /* fresh */ }
if (cache.__v !== CACHE_VERSION) cache = { __v: CACHE_VERSION };
let cacheDirty = false;

const isSystemText = (t) => /^\s*<(system-reminder|command-|local-command|user-prompt-submit-hook|bash-)/.test(t) || /^\s*\[Request interrupted/.test(t) || /^\s*Caveat:/.test(t);
const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
  return '';
};
const decodeDir = (name) => name.replace(/^-/, '/').replace(/-/g, '/');

async function summarize(file, projectDir) {
  const s = {
    cwd: null, branch: null, title: null, firstPrompt: null, start: null, end: null,
    user: 0, assistant: 0, tools: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0,
    models: {}, usage: {}, entrypoint: null, version: null, subagents: 0,
  };
  const seenMsg = new Set(); // Claude Code logs one record per content block; usage repeats per message id
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.timestamp) { if (!s.start) s.start = o.timestamp; s.end = o.timestamp; }
    if (!s.cwd && o.cwd) s.cwd = o.cwd;
    if (!s.branch && o.gitBranch && o.gitBranch !== 'HEAD' && o.gitBranch !== '.invalid') s.branch = o.gitBranch;
    if (!s.entrypoint && o.entrypoint) s.entrypoint = o.entrypoint;
    if (o.version) s.version = o.version;
    if (o.type === 'ai-title' || o.type === 'custom-title') s.title = o.aiTitle || o.customTitle || o.title || s.title;
    if (o.type === 'summary' && o.summary && !s.title) s.title = o.summary;
    if (o.isSidechain) continue;
    if (o.type === 'user' && o.message) {
      const t = textOf(o.message.content);
      if (t && !o.isMeta && !isSystemText(t)) {
        s.user++;
        if (!s.firstPrompt) s.firstPrompt = t.trim().slice(0, 300);
      }
    } else if (o.type === 'assistant' && o.message) {
      const m = o.message.model;
      const mid = o.message.id;
      const fresh = !mid || !seenMsg.has(mid);
      if (mid) seenMsg.add(mid);
      if (fresh) {
        s.assistant++;
        if (m && m !== '<synthetic>') s.models[m] = (s.models[m] || 0) + 1;
      }
      if (Array.isArray(o.message.content)) s.tools += o.message.content.filter((b) => b.type === 'tool_use').length;
      const u = o.message.usage;
      if (u && m && m !== '<synthetic>') {
        const cc = u.cache_creation || {};
        const w1 = cc.ephemeral_1h_input_tokens || 0;
        const w5 = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : Math.max(0, (u.cache_creation_input_tokens || 0) - w1);
        const cur = { in: u.input_tokens || 0, out: u.output_tokens || 0, cr: u.cache_read_input_tokens || 0, w5, w1 };
        // later records of the same message carry final counts; keep the max per field
        s.msgUsage = s.msgUsage || new Map();
        const key = mid || Symbol();
        const prev = s.msgUsage.get(key);
        s.msgUsage.set(key, prev ? { model: m, in: Math.max(prev.in, cur.in), out: Math.max(prev.out, cur.out), cr: Math.max(prev.cr, cur.cr), w5: Math.max(prev.w5, cur.w5), w1: Math.max(prev.w1, cur.w1) } : { model: m, ...cur });
      }
    }
  }
  for (const r of (s.msgUsage || new Map()).values()) {
    const t = s.usage[r.model] || (s.usage[r.model] = { in: 0, out: 0, cr: 0, w5: 0, w1: 0 });
    t.in += r.in; t.out += r.out; t.cr += r.cr; t.w5 += r.w5; t.w1 += r.w1;
    s.tokensIn += r.in; s.tokensOut += r.out; s.cacheRead += r.cr; s.cacheWrite += r.w5 + r.w1;
  }
  delete s.msgUsage;
  const sub = path.join(path.dirname(file), path.basename(file, '.jsonl'), 'subagents');
  s.subagents = (await fsp.readdir(sub).catch(() => [])).filter((f) => f.endsWith('.jsonl')).length;
  if (!s.cwd) s.cwd = decodeDir(projectDir);
  return s;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  }));
}

let indexing = { running: false, done: 0, total: 0 };
let sessions = []; // flat list of summaries
let accounts = [];

async function buildIndex() {
  if (indexing.running) return;
  indexing = { running: true, done: 0, total: 0 };
  accounts = await discoverAccounts();
  const jobs = [];
  for (const acc of accounts) {
    const root = path.join(acc.dir, 'projects');
    for (const pd of await fsp.readdir(root).catch(() => [])) {
      const dirPath = path.join(root, pd);
      for (const f of await fsp.readdir(dirPath).catch(() => [])) {
        if (f.endsWith('.jsonl')) jobs.push({ acc, projectDir: pd, file: path.join(dirPath, f), id: f.slice(0, -6) });
      }
    }
  }
  indexing.total = jobs.length;
  const out = [];
  const seen = new Set();
  await pool(jobs, 12, async (j) => {
    const st = await fsp.stat(j.file).catch(() => null);
    if (!st) { indexing.done++; return; }
    const key = j.file;
    seen.add(key);
    let c = cache[key];
    if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
      const summary = await summarize(j.file, j.projectDir).catch(() => null);
      if (!summary) { indexing.done++; return; }
      c = cache[key] = { mtime: st.mtimeMs, size: st.size, s: summary };
      cacheDirty = true;
    }
    out.push({ account: j.acc.id, id: j.id, projectDir: j.projectDir, size: st.size, mtime: st.mtimeMs, birth: st.birthtimeMs, ...c.s });
    indexing.done++;
  });
  for (const k of Object.keys(cache)) if (k !== '__v' && !seen.has(k)) { delete cache[k]; cacheDirty = true; }
  out.sort((a, b) => (b.end || '').localeCompare(a.end || ''));
  // The same session file copied into several accounts (e.g. a bulk copy) must not be billed twice:
  // among files with identical id + size, the oldest one is the original, the rest are copies.
  const groups = new Map();
  for (const s of out) { const k = s.id + ':' + s.size; (groups.get(k) || groups.set(k, []).get(k)).push(s); }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.birth || 0) - (b.birth || 0) || accounts.findIndex((x) => x.id === a.account) - accounts.findIndex((x) => x.id === b.account));
    for (const c of g.slice(1)) c.copyOf = g[0].account;
  }
  sessions = out;
  if (cacheDirty) {
    await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fsp.writeFile(CACHE_FILE, JSON.stringify(cache)).catch(() => {});
    cacheDirty = false;
  }
  indexing.running = false;
}

// ---------- pricing (estimates at API list price; edit pricing.json) ----------
let pricing = { multipliers: { cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 }, models: {} };
function loadPricing() {
  try { pricing = JSON.parse(fs.readFileSync(path.join(__dirname, 'pricing.json'), 'utf8')); } catch { /* keep defaults */ }
}
loadPricing();
function priceFor(model) {
  let best = null;
  for (const k of Object.keys(pricing.models)) if (model.startsWith(k) && (!best || k.length > best.length)) best = k;
  return best ? pricing.models[best] : null;
}
// cost of a { model: {in,out,cr,w5,w1} } map → { usd, unpriced: [models] }
function costOf(usage) {
  const mul = pricing.multipliers || {};
  let usd = 0; const unpriced = [];
  for (const [model, u] of Object.entries(usage || {})) {
    const p = priceFor(model);
    if (!p) { unpriced.push(model); continue; }
    const cr = p.cacheRead != null ? p.cacheRead : p.in * (mul.cacheRead ?? 0.1);
    usd += (u.in * p.in + u.out * p.out + u.cr * cr + u.w5 * p.in * (mul.cacheWrite5m ?? 1.25) + u.w1 * p.in * (mul.cacheWrite1h ?? 2)) / 1e6;
  }
  return { usd, unpriced };
}

// ---------- plan usage snapshots (written by the Claude Code status line script, see README) ----------
const SNAP_DIR = path.join(HOME, '.claude', 'usage-snapshots');
function usageOf(id) {
  let o;
  try { o = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, id + '.json'), 'utf8')); } catch { return null; }
  const now = Date.now() / 1000;
  const win = (w) => (w && typeof w.used_percentage === 'number'
    ? { used: w.used_percentage, resetsAt: w.resets_at || null, expired: !!w.resets_at && w.resets_at <= now } : null);
  return { savedAt: o.savedAt || null, fiveHour: win(o.five_hour), sevenDay: win(o.seven_day) };
}

// ---------- views over the index ----------
function accountsView() {
  return accounts.map((a) => {
    const ss = sessions.filter((s) => s.account === a.id);
    const own = ss.filter((s) => !s.copyOf);
    return {
      ...a, dir: a.dir.replace(HOME, '~'),
      sessions: ss.length,
      folders: new Set(ss.map((s) => s.cwd)).size,
      messages: ss.reduce((n, s) => n + s.user + s.assistant, 0),
      tokensOut: ss.reduce((n, s) => n + s.tokensOut, 0),
      copies: ss.length - own.length,
      tokens: own.reduce((n, s) => n + s.tokensIn + s.tokensOut + s.cacheRead + s.cacheWrite, 0),
      cost: own.reduce((n, s) => n + costOf(s.usage).usd, 0),
      cost30d: own.filter((s) => s.end && Date.now() - Date.parse(s.end) < 30 * 864e5).reduce((n, s) => n + costOf(s.usage).usd, 0),
      lastActive: ss.reduce((m, s) => (s.end && s.end > m ? s.end : m), ''),
      usage: usageOf(a.id),
      launch: a.isDefault ? 'claude' : `CLAUDE_CONFIG_DIR=${a.dir.replace(HOME, '~')} claude`,
    };
  });
}

function foldersView() {
  const map = new Map();
  for (const s of sessions) {
    let f = map.get(s.cwd);
    if (!f) { f = { cwd: s.cwd, sessions: 0, lastActive: '', perAccount: {}, exists: null }; map.set(s.cwd, f); }
    f.sessions++;
    f.perAccount[s.account] = (f.perAccount[s.account] || 0) + 1;
    if (s.end && s.end > f.lastActive) f.lastActive = s.end;
  }
  const list = [...map.values()];
  for (const f of list) f.exists = fs.existsSync(f.cwd);
  return list.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}

const pub = (s) => {
  const { usage, ...rest } = s;
  const c = costOf(usage);
  return { ...rest, tokens: s.tokensIn + s.tokensOut + s.cacheRead + s.cacheWrite, cost: c.usd, unpriced: c.unpriced, usage, resume: resumeCmd(s) };
};
function resumeCmd(s) {
  const acc = accounts.find((a) => a.id === s.account);
  const env = acc && !acc.isDefault ? `CLAUDE_CONFIG_DIR=${acc.dir.replace(HOME, '~')} ` : '';
  return `cd ${JSON.stringify(s.cwd)} && ${env}claude --resume ${s.id}`;
}

function sessionsView(q) {
  let list = sessions;
  if (q.account) list = list.filter((s) => s.account === q.account);
  if (q.cwd) list = list.filter((s) => s.cwd === q.cwd);
  if (q.q) {
    const n = q.q.toLowerCase();
    list = list.filter((s) => [s.title, s.firstPrompt, s.cwd, s.branch, s.id].some((x) => x && x.toLowerCase().includes(n)));
  }
  list = list.map(pub);
  if (q.sort === 'cost') list = list.filter((s) => !s.copyOf).sort((a, b) => b.cost - a.cost);
  return list.slice(0, Number(q.limit) || 500);
}

function statsView() {
  const perDay = {};
  const models = {};
  for (const s of sessions) {
    if (s.end) perDay[s.end.slice(0, 10)] = (perDay[s.end.slice(0, 10)] || 0) + 1;
    for (const [m, n] of Object.entries(s.models)) models[m] = (models[m] || 0) + n;
  }
  let cost = 0, tokens = 0, unpriced = new Set();
  for (const s of sessions) { if (s.copyOf) continue; const c = costOf(s.usage); cost += c.usd; c.unpriced.forEach((m) => unpriced.add(m)); tokens += s.tokensIn + s.tokensOut + s.cacheRead + s.cacheWrite; }
  return { perDay, models, totalSessions: sessions.length, copies: sessions.filter((s) => s.copyOf).length, cost, tokens, unpriced: [...unpriced], pricingUpdated: pricing.updated || null };
}

// ---------- transcript ----------
async function transcript(accId, id) {
  const s = sessions.find((x) => x.account === accId && x.id === id);
  if (!s) return null;
  const file = path.join(accounts.find((a) => a.id === accId).dir, 'projects', s.projectDir, id + '.jsonl');
  const msgs = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  const clip = (t, n = 6000) => (typeof t === 'string' && t.length > n ? t.slice(0, n) + `\n… (${t.length - n} more chars)` : t);
  for await (const line of rl) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if ((o.type !== 'user' && o.type !== 'assistant') || !o.message || o.isSidechain) continue;
    const content = typeof o.message.content === 'string' ? [{ type: 'text', text: o.message.content }] : (o.message.content || []);
    const blocks = [];
    for (const b of content) {
      if (b.type === 'text' && b.text) blocks.push({ k: 'text', text: clip(b.text), system: o.type === 'user' && (o.isMeta || isSystemText(b.text)) });
      else if (b.type === 'thinking' && b.thinking) blocks.push({ k: 'thinking', text: clip(b.thinking, 3000) });
      else if (b.type === 'tool_use') blocks.push({ k: 'tool', name: b.name, input: clip(JSON.stringify(b.input, null, 2), 2500) });
      else if (b.type === 'tool_result') blocks.push({ k: 'result', error: !!b.is_error, text: clip(typeof b.content === 'string' ? b.content : textOf(b.content), 2500) });
    }
    if (blocks.length) msgs.push({ role: o.type, time: o.timestamp, model: o.message.model, blocks });
  }
  return { session: pub(s), messages: msgs };
}

// ---------- full-text search ----------
async function search(q, limit = 60) {
  const needle = q.toLowerCase();
  if (needle.length < 2) return [];
  const hits = [];
  await pool(sessions, 8, async (s) => {
    if (hits.length >= limit * 3) return;
    const file = path.join(accounts.find((a) => a.id === s.account).dir, 'projects', s.projectDir, s.id + '.jsonl');
    let raw;
    try { if (s.size > 200 * 1024 * 1024) return; raw = await fsp.readFile(file, 'utf8'); } catch { return; }
    const low = raw.toLowerCase();
    let at = low.indexOf(needle), count = 0, snippet = null;
    while (at !== -1 && count < 1000) {
      if (!snippet) {
        const ls = raw.lastIndexOf('\n', at) + 1;
        let le = raw.indexOf('\n', at); if (le < 0) le = raw.length;
        try {
          const o = JSON.parse(raw.slice(ls, le));
          const t = textOf(o.message && o.message.content);
          const i = t.toLowerCase().indexOf(needle);
          if (i >= 0 && o.type !== 'attachment') snippet = { role: o.type, text: t.slice(Math.max(0, i - 80), i + 160) };
        } catch { /* partial line */ }
      }
      count++;
      at = low.indexOf(needle, at + needle.length);
    }
    if (snippet) hits.push({ ...pub(s), snippet, matches: count });
  });
  return hits.sort((a, b) => b.matches - a.matches).slice(0, limit);
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const json = (res, data, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

const server = http.createServer(async (req, res) => {
  // DNS-rebinding guard: only answer to localhost host headers
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end('forbidden'); }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const url = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(url.searchParams);
  try {
    switch (url.pathname) {
      case '/api/status': return json(res, { indexing, home: HOME });
      case '/api/accounts': return json(res, accountsView());
      case '/api/folders': return json(res, foldersView());
      case '/api/sessions': return json(res, sessionsView(q));
      case '/api/stats': return json(res, statsView());
      case '/api/reindex': loadPricing(); buildIndex(); return json(res, { ok: true });
      case '/api/search': return json(res, await search(q.q || ''));
      case '/api/session': {
        if (!/^[\w-]+$/.test(q.id || '')) return json(res, { error: 'bad id' }, 400);
        const t = await transcript(q.account, q.id);
        return t ? json(res, t) : json(res, { error: 'not found' }, 404);
      }
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    const data = await fsp.readFile(file).catch(() => null);
    if (!data) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    json(res, { error: String(e.message || e) }, 500);
  }
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use — try --port ${PORT + 1}` : e.message);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Sessions → http://localhost:${PORT}`);
  buildIndex().then(() => console.log(`Indexed ${sessions.length} sessions from ${accounts.length} account(s)`));
});
