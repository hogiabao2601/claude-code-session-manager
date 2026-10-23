'use strict';
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (p) => fetch('/api/' + p).then((r) => r.json());
const COLORS = ['var(--a0)', 'var(--a1)', 'var(--a2)', 'var(--a3)', 'var(--a4)'];
let accounts = [];
const accIdx = (id) => Math.max(0, accounts.findIndex((a) => a.id === id));
const accColor = (id) => COLORS[accIdx(id) % COLORS.length];
const accLabel = (id) => { const a = accounts.find((x) => x.id === id); return a ? (a.email || a.id) : id; };
const chip = (id, extra = '') => `<span class="chip" title="${esc(accLabel(id))}"><i style="background:${accColor(id)}"></i>${esc(accShort(id))}${extra}</span>`;
const accShort = (id) => { const a = accounts.find((x) => x.id === id); return a && a.email ? a.email.split('@')[0] + (a.org ? ' · ' + a.org : '') : id; };

const fmtN = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const ago = (iso) => {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'; if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
const untilTs = (ts) => { const s = ts - Date.now() / 1000; if (s <= 0) return 'now'; const m = Math.round(s / 60); if (m < 60) return m + ' min'; if (m < 2880) return Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; return Math.floor(m / 1440) + ' d ' + Math.round((m % 1440) / 60) + ' h'; };
function usageBlock(u) {
  if (!u || (!u.fiveHour && !u.sevenDay)) return '<div class="muted small" style="margin-top:12px" title="Filled in once a Claude Code session in this account has run with the status line snapshot (see README).">Plan usage: no data yet. Use Claude Code in this account.</div>';
  const age = u.savedAt ? Math.round(Date.now() / 1000 - u.savedAt) : null;
  const row = (label, w) => {
    if (!w) return `<div class="u-row"><span class="lbl">${label}</span><span class="muted">not reported</span></div>`;
    if (w.expired) return `<div class="u-row"><span class="lbl">${label}</span><div class="u-bar"></div><span class="txt">Window reset ${esc(new Date(w.resetsAt * 1000).toLocaleString())}; current usage unknown until the next session</span></div>`;
    const used = Math.min(100, Math.max(0, w.used)), color = used >= 90 ? '#d4493b' : used >= 70 ? 'var(--a4)' : 'var(--a2)';
    return `<div class="u-row"><span class="lbl">${label}</span><div class="u-bar"><i style="width:${used}%;background:${color}"></i></div><span class="txt"><b>${Math.round(used)}% used</b> · ${Math.round(100 - used)}% left${w.resetsAt ? ` · resets in ${untilTs(w.resetsAt)} (${esc(new Date(w.resetsAt * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))})` : ''}</span></div>`;
  };
  const stale = age != null && age > 3600;
  return `<div class="usage">${row('5-hour', u.fiveHour)}${row('Weekly', u.sevenDay)}<div class="muted small">${stale ? '⚠ ' : ''}Last seen ${age == null ? '—' : ago(new Date(u.savedAt * 1000).toISOString())}${stale ? ' · may be out of date; updates while you use Claude Code here' : ''}</div></div>`;
}
const dur = (a, b) => { const m = Math.round((new Date(b) - new Date(a)) / 60000); return m < 1 ? '<1 min' : m < 60 ? m + ' min' : (m / 60).toFixed(1) + ' h'; };
let HOME = '';
const short = (p) => (HOME && p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 1400); };
const copy = (t) => navigator.clipboard.writeText(t).then(() => toast('Copied'));
const hl = (text, q) => { const e = esc(text); if (!q) return e; return e.replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`); };
const fmtCost = (c) => (c > 0 && c < 0.01 ? '<$0.01' : '$' + (c >= 1000 ? Math.round(c).toLocaleString() : c.toFixed(2)));
const costCell = (s) => s.copyOf ? `<span class="muted" title="Same session file exists in ${esc(accLabel(s.copyOf))} — counted there, not here">copy</span>` : `<span title="${s.unpriced && s.unpriced.length ? 'No price for: ' + esc(s.unpriced.join(', ')) + ' (add to pricing.json)' : 'Estimated at API list prices'}">${s.cost || !(s.unpriced || []).length ? fmtCost(s.cost) : '—'}${s.unpriced && s.unpriced.length ? '<sup>?</sup>' : ''}</span>`;
const title = (s) => s.title || (s.firstPrompt ? s.firstPrompt.replace(/\s+/g, ' ').slice(0, 110) : '(no prompt)');

// ---------- theme ----------
const root = document.documentElement;
try { const t = localStorage.getItem('theme'); if (t) root.dataset.theme = t; } catch {}
$('#theme').onclick = () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch {}
};
const rescan = async () => { await api('reindex'); toast('Rescanning…'); waitIndex(); };
$('#reindex').onclick = rescan;

// ---------- auto rescan (runs while this tab is open) ----------
let autoTimer = null;
const hm = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const fmtH = (h) => h < 1 ? Math.round(h * 60) + ' min' : h + ' h';
function showAuto(saved) {
  const msg = $('#autoMsg');
  if (!saved || !saved.on) { msg.className = 'auto-msg'; msg.textContent = 'Auto-rescan is off.'; return; }
  msg.className = 'auto-msg ok';
  msg.textContent = `✓ Active: every ${fmtH(saved.h)}. Next rescan ${hm(new Date(saved.next))}. Works while this tab is open.`;
}
function startAuto(saved) {
  clearInterval(autoTimer); autoTimer = null;
  if (!saved || !saved.on) return;
  autoTimer = setInterval(() => {
    saved.next = Date.now() + saved.h * 3600e3;
    try { localStorage.setItem('autoRescan', JSON.stringify(saved)); } catch {}
    showAuto(saved); rescan();
  }, saved.h * 3600e3);
}
$('#autoApply').onclick = () => {
  const on = $('#autoOn').checked, h = parseFloat($('#autoH').value);
  if (on && !(h >= 1 / 60)) { const m = $('#autoMsg'); m.className = 'auto-msg err'; m.textContent = 'Enter a number of hours (minimum 1 minute = 0.017).'; return; }
  const saved = { on, h, next: Date.now() + h * 3600e3 };
  try { localStorage.setItem('autoRescan', JSON.stringify(saved)); } catch {}
  startAuto(saved); showAuto(saved);
  toast(on ? `Auto-rescan set: every ${fmtH(h)}` : 'Auto-rescan turned off');
};
try {
  const a = JSON.parse(localStorage.getItem('autoRescan') || 'null');
  if (a) { $('#autoOn').checked = !!a.on; $('#autoH').value = a.h || 1; if (a.on) a.next = Date.now() + a.h * 3600e3; startAuto(a); }
  showAuto(a);
} catch { showAuto(null); }

// ---------- indexing status ----------
async function waitIndex() {
  for (;;) {
    const st = await api('status');
    HOME = st.home;
    const i = st.indexing;
    $('#indexStatus').textContent = i.running ? `Indexing ${i.done}/${i.total}…` : '';
    if (!i.running) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  accounts = await api('accounts');
  route();
}

// ---------- views ----------
function accountFilter(sel) {
  return `<select id="fAcc"><option value="">All accounts</option>${accounts.map((a) => `<option value="${esc(a.id)}" ${sel === a.id ? 'selected' : ''}>${esc(accShort(a.id))}</option>`).join('')}</select>`;
}

async function overview() {
  const [stats, recent, top] = await Promise.all([api('stats'), api('sessions?limit=8'), api('sessions?limit=10&sort=cost')]);
  let range = 60; try { range = Number(localStorage.getItem('range')) || 60; } catch {}
  const days = [];
  for (let i = range - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push([d, stats.perDay[d] || 0]); }
  const max = Math.max(1, ...days.map((d) => d[1]));
  const models = Object.entries(stats.models).sort((a, b) => b[1] - a[1]).slice(0, 6);
  app.innerHTML = `
    <div class="head"><div><h1>Overview</h1><div class="muted">${accounts.length} account${accounts.length === 1 ? '' : 's'} · ${stats.totalSessions - stats.copies} sessions found on this Mac${stats.copies ? ` (+${stats.copies} copies shared between accounts)` : ''} · ${fmtN(stats.tokens)} tokens · <b>${fmtCost(stats.cost)}</b> estimated API-equivalent cost</div></div></div>
    <div class="cards">${accounts.map((a) => `
      <div class="card link" data-go="#/sessions?account=${esc(a.id)}">
        <div class="acc-top"><div class="avatar" style="background:${accColor(a.id)}">${esc((a.name || a.email || a.id)[0].toUpperCase())}</div>
          <div style="min-width:0"><div class="acc-name">${esc(a.name || a.id)} ${a.isDefault ? '<span class="tag">default</span>' : ''}</div><div class="acc-mail">${esc(a.email || 'not signed in')}${a.org ? ' · ' + esc(a.org) : ''}</div></div></div>
        <div class="kv"><div><b>${a.folders}</b><span>folders</span></div><div><b>${a.sessions}</b><span>sessions</span></div><div><b>${ago(a.lastActive)}</b><span>last active</span></div>
          <div><b>${fmtN(a.tokens)}</b><span>tokens</span></div><div><b>${fmtCost(a.cost)}</b><span>est. cost</span></div><div><b>${fmtCost(a.cost30d)}</b><span>last 30 days</span></div></div>
        ${usageBlock(a.usage)}
        <div class="muted small" style="margin-top:12px">Config <span class="mono">${esc(a.dir)}</span></div>
        <div class="cmd"><code class="mono">${esc(a.launch)}</code><button class="btn small" data-copy="${esc(a.launch)}">Copy</button></div>
      </div>`).join('')}</div>
    <div class="grid2">
      <div><h2>Sessions per day · last <select id="range" class="range">${[7, 14, 30, 60, 90, 180, 365].map((n) => `<option value="${n}" ${n === range ? 'selected' : ''}>${n}</option>`).join('')}</select> days</h2><div class="card"><div class="bars">${days.map(([d, n]) => `<div title="${d}: ${n}" style="height:${(n / max) * 100}%"></div>`).join('')}</div><div class="axis">${days.map(([d], i) => `<span>${(days.length - 1 - i) % Math.ceil(days.length / 8) === 0 ? `<b>${new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</b>` : ''}</span>`).join('')}</div></div></div>
      <div><h2>Models used</h2><div class="card">${models.map(([m, n]) => `<div class="model-row"><span>${esc(m)}</span><span class="muted">${fmtN(n)} replies</span></div>`).join('') || '<span class="muted">—</span>'}</div></div>
    </div>
    <h2>Most expensive sessions</h2>${sessionTable(top)}
    <h2>Recent sessions</h2>${sessionTable(recent)}
    <p class="muted small">Cost is an estimate: tokens × Anthropic API list prices${stats.pricingUpdated ? ' (as of ' + esc(stats.pricingUpdated) + ')' : ''}, including prompt-cache reads and writes. Subscription plans (Pro, Max, Team) are not billed per token, so treat it as relative usage. Prices live in <span class="mono">pricing.json</span>.${stats.unpriced.length ? ' <b>No price for:</b> ' + esc(stats.unpriced.join(', ')) + '.' : ''}</p>`;
  $('#range').onchange = (e) => { try { localStorage.setItem('range', e.target.value); } catch {} overview(); };
}

// Clickable "Last active" header: desc (newest first) is the default, a click flips it.
function lastActiveTh(page, params, extra = {}) {
  const asc = params.get('dir') === 'asc';
  const p = new URLSearchParams(extra);
  for (const k of ['q', 'account']) if (params.get(k)) p.set(k, params.get(k));
  if (!asc) p.set('dir', 'asc');
  return `<span class="right sortable" data-go="#/${page}?${p}">Last active ${asc ? '↑' : '↓'}</span>`;
}

function sessionTable(list, q, activeTh = '<span class="right">Last active</span>') {
  if (!list.length) return '<div class="table"><div class="empty">No sessions.</div></div>';
  return `<div class="table"><div class="row sess th"><span>Session</span><span>Account</span><span class="right">Msgs</span><span class="right">Tokens</span><span class="right">Est. cost</span>${activeTh}</div>${list.map((s) => `
    <div class="row sess" data-go="#/session/${esc(s.account)}/${esc(s.id)}">
      <div style="min-width:0"><div class="t">${hl(title(s), q)}</div><div class="sub">${esc(short(s.cwd))}${s.branch ? ' · ' + esc(s.branch) : ''}</div></div>
      <div>${chip(s.account)}</div><div class="right">${s.user + s.assistant}</div><div class="right">${fmtN(s.tokens)}</div><div class="right">${costCell(s)}</div><div class="right muted">${ago(s.end)}</div>
    </div>`).join('')}</div>`;
}

async function folders(params) {
  const q = (params.get('q') || '').toLowerCase(), acc = params.get('account') || '';
  let list = await api('folders');
  if (acc) list = list.filter((f) => f.perAccount[acc]);
  if (q) list = list.filter((f) => f.cwd.toLowerCase().includes(q));
  if (params.get('dir') === 'asc') list = [...list].sort((a, b) => a.lastActive.localeCompare(b.lastActive));
  app.innerHTML = `
    <div class="head"><div><h1>Folders</h1><div class="muted">${list.length} places where Claude Code was started</div></div>
      <div class="tools"><input type="search" id="fQ" placeholder="Filter folders…" value="${esc(params.get('q') || '')}">${accountFilter(acc)}</div></div>
    ${list.length ? `<div class="table"><div class="row folder th"><span>Folder</span><span>Accounts used</span><span class="right">Sessions</span>${lastActiveTh('folders', params)}</div>${list.map((f) => `
      <div class="row folder" data-go="#/sessions?cwd=${encodeURIComponent(f.cwd)}">
        <div style="min-width:0"><div class="t">${esc(short(f.cwd).split('/').pop() || f.cwd)}</div><div class="sub ${f.exists ? '' : 'gone'}">${esc(short(f.cwd))}${f.exists ? '' : ' · folder no longer exists'}</div></div>
        <div class="chips">${Object.entries(f.perAccount).map(([a, n]) => chip(a, ` <b>${n}</b>`)).join('')}</div>
        <div class="right">${f.sessions}</div><div class="right muted">${ago(f.lastActive)}</div>
      </div>`).join('')}</div>` : '<div class="table"><div class="empty">No folders match.</div></div>'}`;
  bindFilters('folders', params.get('dir') ? { dir: params.get('dir') } : {});
}

async function sessions(params) {
  const acc = params.get('account') || '', cwd = params.get('cwd') || '', q = params.get('q') || '';
  const list = await api(`sessions?account=${encodeURIComponent(acc)}&cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(q)}`);
  if (params.get('dir') === 'asc') list.reverse();
  app.innerHTML = `
    ${cwd ? `<div class="crumb"><a href="#/folders">Folders</a> / ${esc(short(cwd))}</div>` : ''}
    <div class="head"><div><h1>${cwd ? esc(short(cwd).split('/').pop()) : 'Sessions'}</h1><div class="muted">${list.length} session${list.length === 1 ? '' : 's'}${cwd ? ' in ' + esc(short(cwd)) : ''}</div></div>
      <div class="tools"><input type="search" id="fQ" placeholder="Filter by title, prompt, branch…" value="${esc(q)}">${accountFilter(acc)}</div></div>
    ${sessionTable(list, q, lastActiveTh('sessions', params, cwd ? { cwd } : {}))}`;
  bindFilters('sessions', { ...(cwd ? { cwd } : {}), ...(params.get('dir') ? { dir: params.get('dir') } : {}) });
}

async function session(accId, id) {
  const d = await api(`session?account=${encodeURIComponent(accId)}&id=${encodeURIComponent(id)}`);
  if (d.error) { app.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const s = d.session;
  const models = Object.keys(s.models).join(', ');
  app.innerHTML = `
    <div class="crumb"><a href="#/folders">Folders</a> / <a href="#/sessions?cwd=${encodeURIComponent(s.cwd)}">${esc(short(s.cwd))}</a></div>
    <div class="head"><div style="min-width:0"><h1>${esc(title(s))}</h1>
      <div class="meta">${chip(s.account)}${s.branch ? `<span class="tag">⎇ ${esc(s.branch)}</span>` : ''}<span class="tag">${s.user} prompts</span><span class="tag">${s.assistant} replies</span><span class="tag">${s.tools} tool calls</span>
      <span class="tag">${fmtN(s.tokensIn + s.cacheRead + s.cacheWrite)} in · ${fmtN(s.tokensOut)} out</span><span class="tag"><b>${costCell(s)}</b> est.</span>${models ? `<span class="tag">${esc(models)}</span>` : ''}
      ${s.start ? `<span class="tag">${dur(s.start, s.end)} · ${new Date(s.start).toLocaleString()}</span>` : ''}<span class="tag">${fmtSize(s.size)}</span>${s.subagents ? `<span class="tag">${s.subagents} subagents</span>` : ''}</div></div>
      <div class="tools"><button class="btn" data-copy="${esc(s.resume)}">Copy resume command</button></div></div>
    <div class="cmd"><code class="mono">${esc(s.resume)}</code></div>
    ${Object.keys(s.usage || {}).length ? `<h2>Tokens by model</h2><div class="table"><div class="row mrow th"><span>Model</span><span class="right">Input</span><span class="right">Output</span><span class="right">Cache read</span><span class="right">Cache write</span></div>${Object.entries(s.usage).map(([m, u]) => `<div class="row mrow" style="cursor:default"><span class="t">${esc(m)}</span><span class="right">${fmtN(u.in)}</span><span class="right">${fmtN(u.out)}</span><span class="right">${fmtN(u.cr)}</span><span class="right">${fmtN(u.w5 + u.w1)}</span></div>`).join('')}</div>` : ''}
    <div class="thread">${d.messages.map(renderMsg).join('') || '<div class="empty">Empty session.</div>'}</div>`;
}

function renderMsg(m) {
  const body = m.blocks.map((b) => {
    if (b.k === 'text') return `<div class="bubble ${b.system ? 'sys' : ''}">${esc(b.text)}</div>`;
    if (b.k === 'thinking') return `<details class="blk"><summary>💭 Thinking</summary><pre>${esc(b.text)}</pre></details>`;
    if (b.k === 'tool') return `<details class="blk"><summary>🔧 ${esc(b.name)}</summary><pre>${esc(b.input)}</pre></details>`;
    return `<details class="blk ${b.error ? 'err' : ''}"><summary>${b.error ? '⚠️ Error result' : '↩ Result'}</summary><pre>${esc(b.text)}</pre></details>`;
  }).join('');
  return `<div class="msg ${m.role}"><div class="who"><b>${m.role === 'user' ? 'You' : 'Claude'}</b><span>${m.time ? new Date(m.time).toLocaleTimeString() : ''}</span>${m.model ? `<span>${esc(m.model)}</span>` : ''}</div>${body}</div>`;
}

async function search(params) {
  const q = params.get('q') || '';
  app.innerHTML = `
    <div class="head"><div><h1>Search</h1><div class="muted">Full-text search across every conversation, all accounts</div></div>
      <div class="tools"><input type="search" id="fQ" placeholder="Search conversations…" value="${esc(q)}" style="min-width:340px" autofocus></div></div>
    <div id="res">${q ? '<div class="empty">Searching…</div>' : '<div class="table"><div class="empty">Type a phrase and press Enter.</div></div>'}</div>`;
  $('#fQ').onkeydown = (e) => { if (e.key === 'Enter') location.hash = '#/search?q=' + encodeURIComponent(e.target.value); };
  if (!q) return;
  const hits = await api('search?q=' + encodeURIComponent(q));
  $('#res').innerHTML = hits.length ? `<div class="table">${hits.map((s) => `
    <div class="row" style="grid-template-columns:minmax(0,1fr) 150px" data-go="#/session/${esc(s.account)}/${esc(s.id)}">
      <div style="min-width:0"><div class="t">${esc(title(s))}</div><div class="sub">${esc(short(s.cwd))} · ${ago(s.end)} · ${s.matches} match${s.matches === 1 ? '' : 'es'}</div>
      <div class="snip">${esc(s.snippet.role === 'user' ? 'You: ' : 'Claude: ')}${hl(s.snippet.text.replace(/\s+/g, ' '), q)}</div></div>${chip(s.account)}</div>`).join('')}</div>`
    : '<div class="table"><div class="empty">No matches.</div></div>';
}

function bindFilters(page, keep = {}) {
  const go = () => {
    const p = new URLSearchParams(keep);
    if ($('#fQ').value) p.set('q', $('#fQ').value);
    if ($('#fAcc').value) p.set('account', $('#fAcc').value);
    location.hash = `#/${page}?${p}`;
  };
  $('#fAcc').onchange = go;
  let t; $('#fQ').oninput = () => { clearTimeout(t); t = setTimeout(() => { go(); const el = $('#fQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 350); };
  const el = $('#fQ'); if (el.value) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}


function usage() {
  const ex = accounts.find((a) => !a.isDefault);
  const code = (t) => `<div class="cmd"><code class="mono">${esc(t)}</code><button class="btn small" data-copy="${esc(t)}">Copy</button></div>`;
  app.innerHTML = `
    <div class="head"><div><h1>Usage</h1><div class="muted">How to run, set up and read this app</div></div></div>
    <div class="guide">
      <section class="card"><h3>1 · What it does</h3>
        <p>Claude Code keeps every conversation as a file under its config folder (<span class="mono">~/.claude/projects</span>). If you sign in with several Claude accounts, each one gets its own config folder. This app reads them all, <b>read-only</b>, and shows which folders you started Claude Code in, which account each session used, and the full conversations. Nothing is uploaded; the server only listens on <span class="mono">localhost</span>.</p></section>
      <section class="card"><h3>2 · Run it</h3>
        <p>Needs Node 18 or newer. No install step and no dependencies.</p>
        ${code('git clone https://github.com/hogiabao2601/claude-code-session-manager && cd claude-code-session-manager')}
        ${code('node server.js')}
        <p class="muted small">Open <span class="mono">http://localhost:4780</span>. Options: <span class="mono">--port 5000</span>, <span class="mono">--dir /path/to/extra/config</span> (repeatable), <span class="mono">--help</span>.</p></section>
      <section class="card"><h3>3 · Use several Claude accounts</h3>
        <p>Claude Code reads its config folder from <span class="mono">CLAUDE_CONFIG_DIR</span> (default <span class="mono">~/.claude</span>). Give each account its own folder and an alias, then sign in once per account:</p>
        ${code("# add to ~/.zshrc or ~/.bashrc\nalias claude.work='CLAUDE_CONFIG_DIR=$HOME/.claude_work claude'")}
        <p class="muted small">Run <span class="mono">claude.work</span> and use <span class="mono">/login</span> the first time. Name the folder <span class="mono">~/.claude_something</span> or <span class="mono">~/.claude-something</span> and this app finds it automatically; for any other location pass <span class="mono">--dir</span>. Then hit <b>Rescan</b>.</p></section>
      <section class="card"><h3>4 · Your accounts on this machine</h3>
        ${accounts.length ? `<div class="table" style="box-shadow:none"><div class="row th" style="grid-template-columns:1fr 1.2fr 1.4fr"><span>Account</span><span>Config folder</span><span>Start Claude with</span></div>${accounts.map((a) => `<div class="row" style="grid-template-columns:1fr 1.2fr 1.4fr;cursor:default"><div class="t">${chip(a.id)}<div class="sub">${esc(a.email || 'not signed in')}</div></div><span class="mono sub">${esc(a.dir)}</span><span class="mono sub" title="${esc(a.launch)}">${esc(a.launch)}</span></div>`).join('')}</div>` : '<p class="muted">No Claude config folders with sessions were found. Start Claude Code once, then press Rescan.</p>'}
        ${ex ? '' : '<p class="muted small" style="margin-top:10px">Only one account found. See step 3 to add another.</p>'}</section>
      <section class="card"><h3>5 · Finding things</h3>
        <ul><li><b>Overview</b> — one card per account, activity chart, recent sessions.</li>
        <li><b>Folders</b> — every place Claude Code was started. The coloured chips show which accounts used it and how many sessions each; click a row to list that folder's sessions.</li>
        <li><b>Sessions</b> — filter by account, folder, or words in the title, first prompt or branch.</li>
        <li><b>Session page</b> — the whole conversation, tool calls collapsed, token counts, and <b>Copy resume command</b> that restarts the session under the right account.</li>
        <li><b>Search</b> — full-text search over every message in every account (a few seconds on a large history).</li></ul></section>
      <section class="card"><h3>6 · Good to know</h3>
        <ul><li>Sessions are the top-level conversation files; subagent runs are counted per session but their tokens are not included in totals.</li>
        <li>Claude Code can auto-delete old transcripts (default 30 days), so older sessions may be gone. Raise <span class="mono">cleanupPeriodDays</span> in its settings to keep them.</li>
        <li>Summaries are cached in <span class="mono">~/.cache/claude-code-session-manager</span>; delete it any time. <b>Rescan</b> picks up new sessions.</li>
        <li>Works wherever Node runs and Claude Code stores its files in <span class="mono">~/.claude*</span> (macOS, Linux).</li></ul></section>
    </div>`;
}

// ---------- router ----------
async function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  const r = parts[0] || 'overview';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === (r === 'session' ? 'sessions' : r)));
  window.scrollTo(0, 0);
  if (r === 'overview') await overview();
  else if (r === 'folders') await folders(params);
  else if (r === 'sessions') await sessions(params);
  else if (r === 'session') await session(parts[1], parts[2]);
  else if (r === 'search') await search(params);
  else if (r === 'usage') usage();
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]'); if (c) { e.stopPropagation(); return copy(c.dataset.copy); }
  const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go;
});
addEventListener('hashchange', route);
waitIndex();
