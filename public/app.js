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
let HOME = '', TRASH = '';
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
    HOME = st.home; TRASH = st.trash || '';
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
  cfgDetail.length = 0;
  const [stats, recent, top] = await Promise.all([api('stats'), api('sessions?limit=8'), api('sessions?limit=10&sort=cost')]);
  let range = 60; try { range = Number(localStorage.getItem('range')) || 60; } catch {}
  let perDayView = 'combined'; try { perDayView = localStorage.getItem('perDayView') === 'accounts' ? 'accounts' : 'combined'; } catch {}
  const dayKeys = [];
  for (let i = range - 1; i >= 0; i--) dayKeys.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  const chart = (counts, color) => {
    const vals = dayKeys.map((d) => counts[d] || 0), max = Math.max(1, ...vals), step = Math.ceil(dayKeys.length / 8);
    return `<div class="bars">${dayKeys.map((d, i) => `<div title="${d}: ${vals[i]}" style="height:${(vals[i] / max) * 100}%${color ? ';background:' + color : ''}"></div>`).join('')}</div><div class="axis">${dayKeys.map((d, i) => `<span>${(dayKeys.length - 1 - i) % step === 0 ? `<b>${new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</b>` : ''}</span>`).join('')}</div>`;
  };
  const total = (counts) => dayKeys.reduce((n, d) => n + (counts[d] || 0), 0);
  const perDayHtml = perDayView === 'accounts'
    ? accounts.map((a) => `<div class="card" style="margin-bottom:10px"><div class="chart-head">${chip(a.id)}<span class="muted small">${total(stats.perDayAccount[a.id] || {})} sessions · peak ${Math.max(0, ...dayKeys.map((d) => (stats.perDayAccount[a.id] || {})[d] || 0))}/day</span></div>${chart(stats.perDayAccount[a.id] || {}, accColor(a.id))}</div>`).join('')
    : `<div class="card"><div class="chart-head"><span class="muted small">All accounts combined</span><span class="muted small">${total(stats.perDay)} sessions · peak ${Math.max(0, ...dayKeys.map((d) => stats.perDay[d] || 0))}/day</span></div>${chart(stats.perDay)}</div>`;
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
        <div class="muted small" style="margin-top:12px">Global configuration</div>${cfgPills(a.config, 'Global · ' + accShort(a.id))}
        <div class="muted small" style="margin-top:12px">Config <span class="mono">${esc(a.dir)}</span></div>
        <div class="cmd"><code class="mono">${esc(a.launch)}</code><button class="btn small" data-copy="${esc(a.launch)}">Copy</button></div>
      </div>`).join('')}</div>
    <div class="grid2">
      <div><h2>Sessions per day · last <select id="range" class="range">${[7, 14, 30, 60, 90, 180, 365].map((n) => `<option value="${n}" ${n === range ? 'selected' : ''}>${n}</option>`).join('')}</select> days <select id="perDayView" class="range"><option value="combined" ${perDayView === 'combined' ? 'selected' : ''}>combined</option><option value="accounts" ${perDayView === 'accounts' ? 'selected' : ''}>per account</option></select></h2>${perDayHtml}</div>
      <div><h2>Models used</h2><div class="card">${models.map(([m, n]) => `<div class="model-row"><span>${esc(m)}</span><span class="muted">${fmtN(n)} replies</span></div>`).join('') || '<span class="muted">—</span>'}</div></div>
    </div>
    <h2>Most expensive sessions</h2>${sessionTable(top)}
    <h2>Recent sessions</h2>${sessionTable(recent)}
    <p class="muted small">Cost is an estimate: tokens × Anthropic API list prices${stats.pricingUpdated ? ' (as of ' + esc(stats.pricingUpdated) + ')' : ''}, including prompt-cache reads and writes. Subscription plans (Pro, Max, Team) are not billed per token, so treat it as relative usage. Prices live in <span class="mono">pricing.json</span>.${stats.unpriced.length ? ' <b>No price for:</b> ' + esc(stats.unpriced.join(', ')) + '.' : ''}</p>`;
  $('#perDayView').onchange = (e) => { try { localStorage.setItem('perDayView', e.target.value); } catch {} overview(); };
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

const CFG_KINDS = [['hooks', 'hooks'], ['plugins', 'plugins'], ['skills', 'skills'], ['agents', 'agents'], ['mcp', 'MCP']];
const cfgDetail = [];
function cfgPills(c, scope = '') {
  if (!c) return '';
  return `<div class="cfg">${CFG_KINDS.map(([k, label]) => {
    const x = c[k] || { count: 0, names: [] };
    const names = (x.names || []);
    const tip = names.length ? names.slice(0, 60).join(', ') + (names.length > 60 ? ` … +${names.length - 60} more` : '') : 'none';
    const extra = k === 'plugins' && x.installed != null ? ` <span class="muted">/ ${x.installed} installed</span>` : '';
    const idx = cfgDetail.push({ title: `${scope ? scope + ' · ' : ''}${label}`, names, installed: x.installed, kind: k }) - 1;
    return `<span class="pill ${x.count ? '' : 'zero'}" data-detail="${idx}" title="Click for details"><b>${x.count}</b> ${label}${extra}</span>`;
  }).join('')}</div>`;
}

async function shared(params) {
  const q = (params.get('q') || '').toLowerCase(), flat = params.get('group') === 'none', only = params.get('author') || '', sort = params.get('sort') || 'newest';
  const d = await api('shared');
  const authorsAll = d.authors, people = d.people;
  let list = d.items.filter((i) => (!only || (only === '—' ? !i.author : i.author === only)) && (!q || [i.title, i.author, i.id].some((x) => x && x.toLowerCase().includes(q))));
  const by = { newest: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''), oldest: (a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''), title: (a, b) => a.title.localeCompare(b.title) }[sort] || (() => 0);
  list = [...list].sort(by);
  const kind = (i) => (i.files ? `multi-file · ${i.files} files` : 'single page');
  const row = (i) => `<div class="row shr">
      <input type="checkbox" class="sel" data-id="${esc(i.id)}">
      <div style="min-width:0"><a class="t" href="${esc(i.url)}" target="_blank" rel="noopener" title="Open in claude.ai">${hl(i.title, q)}</a><div class="sub" title="Version ${esc(i.version || '')}">${kind(i)}${i.version ? ' · v' + esc(i.version.split('-')[1] || '') : ''} · <span class="mono">${esc(i.id)}</span></div></div>
      <div><select class="au" data-id="${esc(i.id)}"><option value="">Unassigned</option>${people.map((p) => `<option ${p === i.author ? 'selected' : ''}>${esc(p)}</option>`).join('')}<option value="__add">+ Add new person…</option></select></div>
      <div class="right" title="${i.updatedAt ? esc(new Date(i.updatedAt).toLocaleString()) : ''}">${i.updatedAt ? ago(i.updatedAt) : '—'}<div class="muted small">${i.updatedAt ? esc(new Date(i.updatedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })) : ''}</div></div>
      <div class="right"><button class="btn small" data-copy="${esc(i.url)}">Copy</button></div>
    </div>`;
  const head = '<div class="row shr th"><span></span><span>Artifact</span><span>Author</span><span class="right">Last updated</span><span></span></div>';
  let body;
  if (!d.items.length) body = '<div class="table"><div class="empty">No shared artifacts saved yet. Ask Claude: “refresh my shared artifacts”.</div></div>';
  else if (!list.length) body = '<div class="table"><div class="empty">No shared artifacts match.</div></div>';
  else if (flat) body = `<div class="table">${head}${list.map(row).join('')}</div>`;
  else {
    const g = new Map(); for (const i of list) (g.get(i.author || '') || g.set(i.author || '', []).get(i.author || '')).push(i);
    const keys = [...g.keys()].sort((a, b) => (a === '') - (b === '') || g.get(b).length - g.get(a).length || a.localeCompare(b));
    body = keys.map((k) => `<div class="group-h">${k ? esc(k) : 'Unassigned'} <span class="muted small">${g.get(k).length} artifact${g.get(k).length === 1 ? '' : 's'}</span></div><div class="table">${head}${g.get(k).map(row).join('')}</div>`).join('');
  }
  app.innerHTML = `
    <div class="head"><div><h1>Shared with me</h1><div class="muted">${list.length} of ${d.items.length} artifact${d.items.length === 1 ? '' : 's'} shared with you${d.updatedAt ? ' · list saved ' + ago(d.updatedAt) : ''}</div></div>
      <div class="tools"><input type="search" id="fQ" placeholder="Search title or author…" value="${esc(params.get('q') || '')}">
        <select id="fAuthor"><option value="">All authors</option><option value="—" ${only === '—' ? 'selected' : ''}>Unassigned</option>${authorsAll.map((a) => `<option ${a === only ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        <select id="fGroup"><option value="">Group by author</option><option value="none" ${flat ? 'selected' : ''}>Flat list</option></select>
        <select id="fSort">${[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['title', 'Title A–Z']].map(([v, l]) => `<option value="${v}" ${sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <p class="muted small">“Last updated” is the time of the artifact's latest published version (claude.ai does not give creation dates). Claude.ai does not tell us who wrote a shared artifact, so set the author yourself: add people to the list once, then pick one in each row, or tick several rows and use “Set author for selected”. Authors are saved on this Mac. The list itself is refreshed by asking Claude: “refresh my shared artifacts”.</p>
    <div class="people-box"><span class="muted small">People:</span>${people.map((p) => `<span class="tag">${esc(p)}<button data-rmperson="${esc(p)}" title="Remove from the list">×</button></span>`).join('') || '<span class="muted small">none yet</span>'}<button class="btn small" id="addPerson">+ Add person</button></div>
    <div class="bulk"><label class="muted small"><input type="checkbox" id="selAll"> Select all shown</label>
      <select id="bulkAuthor"><option value="">Choose person…</option>${people.map((p) => `<option>${esc(p)}</option>`).join('')}</select><button class="btn small" id="bulkApply">Set author for selected</button><button class="btn small" id="bulkClear">Clear author</button></div>
    ${body}`;
  const save = async (ids, author) => {
    const r = await fetch('/api/shared-author', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, author }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) return toast(r.error);
    toast(`Saved (${r.updated})`);
    return true;
  };
  const go = () => {
    const p = new URLSearchParams();
    if ($('#fQ').value) p.set('q', $('#fQ').value);
    if ($('#fAuthor').value) p.set('author', $('#fAuthor').value);
    if ($('#fGroup').value) p.set('group', $('#fGroup').value);
    if ($('#fSort').value !== 'newest') p.set('sort', $('#fSort').value);
    location.hash = `#/shared?${p}`;
  };
  $('#fAuthor').onchange = go; $('#fGroup').onchange = go; $('#fSort').onchange = go;
  let t; $('#fQ').oninput = () => { clearTimeout(t); t = setTimeout(() => { go(); const el = $('#fQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 350); };
  const el = $('#fQ'); if (el.value) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  const picked = () => [...document.querySelectorAll('.sel:checked')].map((c) => c.dataset.id);
  $('#selAll').onchange = (e) => document.querySelectorAll('.sel').forEach((c) => { c.checked = e.target.checked; });
  const postPeople = (body) => fetch('/api/shared-people', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  const askName = () => { const n = (prompt('Name of the person (as you want it shown):') || '').trim(); return n; };
  document.querySelectorAll('select.au').forEach((sel) => {
    sel.onchange = async () => {
      let v = sel.value;
      if (v === '__add') { v = askName(); if (!v) return route(); const r = await postPeople({ add: v }); if (r.error) { toast(r.error); return route(); } }
      if (await save([sel.dataset.id], v)) route();
    };
  });
  $('#addPerson').onclick = async () => { const n = askName(); if (!n) return; const r = await postPeople({ add: n }); if (r.error) toast(r.error); else route(); };
  document.querySelectorAll('[data-rmperson]').forEach((b) => { b.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); if (!confirm(`Remove ${b.dataset.rmperson} from the list?`)) return; const r = await postPeople({ remove: b.dataset.rmperson }); if (r.error) toast(r.error); else route(); }; });
  $('#bulkApply').onclick = async () => {
    const ids = picked(), name = $('#bulkAuthor').value.trim();
    if (!ids.length) return toast('Tick some rows first');
    if (!name) return toast('Choose a person first');
    if (await save(ids, name)) route();
  };
  $('#bulkClear').onclick = async () => { const ids = picked(); if (!ids.length) return toast('Tick some rows first'); if (await save(ids, '')) route(); };
}

async function artifacts(params) {
  const q = (params.get('q') || '').toLowerCase(), acc = params.get('account') || '', cwd = params.get('cwd') || '';
  const group = params.get('group') === 'folder', hideGone = params.get('deleted') !== '1';
  const all = await api('artifacts');
  const folderSet = [...new Set(all.map((a) => a.cwd))].sort();
  let list = all.filter((a) => (!acc || a.accounts.includes(acc)) && (!cwd || a.cwd === cwd) && (!hideGone || !a.deleted)
    && (!q || [a.name, a.description, a.file, a.cwd, a.id, ...a.sessions.map((s) => s.title)].some((x) => x && x.toLowerCase().includes(q))));
  const row = (a) => {
    const s = a.sessions[0];
    return `<div class="row art">
      <div style="min-width:0"><a class="t ${a.deleted ? 'gone-art' : ''}" href="${esc(a.url)}" target="_blank" rel="noopener" title="Open in claude.ai">${hl(a.name, q)}</a>${a.deleted ? ' <span class="tag">deleted</span>' : ''}<div class="sub">${hl(a.description || '', q)}</div></div>
      <div style="min-width:0"><a href="#/sessions?cwd=${encodeURIComponent(a.cwd)}" class="sub" title="${esc(a.cwd)}">${esc(short(a.cwd))}</a></div>
      <div style="min-width:0"><a href="#/session/${esc(s.account)}/${esc(s.id)}" class="sub" title="Open the session that published it">${esc(s.title || s.id)}</a>${a.sessions.length > 1 ? `<div class="muted small">+${a.sessions.length - 1} more session${a.sessions.length > 2 ? 's' : ''}</div>` : ''}</div>
      <div>${a.accounts.map((x) => chip(x)).join(' ')}</div>
      <div class="right muted" title="Created ${esc(new Date(a.created).toLocaleString())}">${ago(a.updated)}<div class="small">${a.publishes} publish${a.publishes === 1 ? '' : 'es'}</div></div>
      <div class="right"><button class="btn small" data-copy="${esc(a.url)}">Copy link</button></div>
    </div>`;
  };
  const head = '<div class="row art th"><span>Artifact</span><span>Folder</span><span>Published from session</span><span>Account</span><span class="right">Updated</span><span></span></div>';
  let body;
  if (!list.length) body = '<div class="table"><div class="empty">No artifacts match.</div></div>';
  else if (group) {
    const g = new Map(); for (const a of list) (g.get(a.cwd) || g.set(a.cwd, []).get(a.cwd)).push(a);
    body = [...g.entries()].map(([c, items]) => `<div class="group-h">${esc(short(c))} <span class="muted small">${items.length} artifact${items.length === 1 ? '' : 's'}</span></div><div class="table">${head}${items.map(row).join('')}</div>`).join('');
  } else body = `<div class="table">${head}${list.map(row).join('')}</div>`;
  app.innerHTML = `
    <div class="head"><div><h1>Artifacts</h1><div class="muted">${list.length} of ${all.length} artifact${all.length === 1 ? '' : 's'} published from your sessions</div></div>
      <div class="tools"><input type="search" id="fQ" placeholder="Search name, description, folder, session…" value="${esc(params.get('q') || '')}">${accountFilter(acc)}
        <select id="fCwd"><option value="">All folders</option>${folderSet.map((c) => `<option value="${esc(c)}" ${c === cwd ? 'selected' : ''}>${esc(short(c))}</option>`).join('')}</select>
        <select id="fGroup"><option value="">Flat list</option><option value="folder" ${group ? 'selected' : ''}>Group by folder</option></select>
        <label class="muted small"><input type="checkbox" id="fDel" ${hideGone ? '' : 'checked'}> show deleted</label></div></div>
    <p class="muted small">Found by reading the Artifact tool calls in your session transcripts, so it lists artifacts published from Claude Code on this Mac. Click a name to open it on claude.ai (sign in with the account shown). Artifacts can only be deleted on claude.ai.</p>
    ${body}`;
  const go = () => {
    const p = new URLSearchParams();
    if ($('#fQ').value) p.set('q', $('#fQ').value);
    if ($('#fAcc').value) p.set('account', $('#fAcc').value);
    if ($('#fCwd').value) p.set('cwd', $('#fCwd').value);
    if ($('#fGroup').value) p.set('group', $('#fGroup').value);
    if ($('#fDel').checked) p.set('deleted', '1');
    location.hash = `#/artifacts?${p}`;
  };
  for (const id of ['#fAcc', '#fCwd', '#fGroup', '#fDel']) $(id).onchange = go;
  let t; $('#fQ').oninput = () => { clearTimeout(t); t = setTimeout(() => { go(); const el = $('#fQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 350); };
  const el = $('#fQ'); if (el.value) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

async function projects(params) {
  cfgDetail.length = 0;
  const q = (params.get('q') || '').toLowerCase(), acc = params.get('account') || '';
  let list = await api('projects');
  if (acc) list = list.filter((f) => f.accounts.includes(acc));
  if (q) list = list.filter((f) => f.cwd.toLowerCase().includes(q) || f.sessions.some((s) => [s.title, s.firstPrompt, s.id].some((x) => x && x.toLowerCase().includes(q))));
  const open = new Set((params.get('open') || '').split(',').filter(Boolean));
  const missing = list.filter((f) => !f.exists);
  const removable = missing.filter((f) => f.removable);
  if (params.get('missing')) list = missing;
  app.innerHTML = `
    <div class="head"><div><h1>Projects</h1><div class="muted">${list.length} folder${list.length === 1 ? '' : 's'} · ${list.reduce((n, f) => n + f.sessionCount, 0)} sessions · with the hooks, plugins, skills, agents and MCP servers configured for each folder</div></div>
      <div class="tools"><input type="search" id="fQ" placeholder="Filter folders, sessions, ids…" value="${esc(params.get('q') || '')}">${accountFilter(acc)}</div></div>
    ${missing.length ? `<div class="cfg" style="margin:0 0 14px;align-items:center"><span class="muted">${missing.length} folder${missing.length === 1 ? '' : 's'} no longer exist</span> <a class="btn small" href="#/projects?${new URLSearchParams({ ...(params.get('missing') ? {} : { missing: 1 }), ...(acc ? { account: acc } : {}) })}">${params.get('missing') ? 'Show all folders' : 'Show only missing'}</a>${removable.length ? `<button class="btn small danger" data-remove-all="${removable.length}" data-sessions="${removable.reduce((n, f) => n + f.sessionCount, 0)}">Remove all missing (${removable.length})</button>` : ''}</div>` : ''}
    <p class="muted small">Counts are project-level files only (<span class="mono">.claude/settings*.json</span>, <span class="mono">.claude/skills</span>, <span class="mono">.claude/agents</span>, <span class="mono">.mcp.json</span>, and MCP servers saved for the folder). Global ones are on the Overview page. Hover a pill to see the names.</p>
    ${list.map((f) => `
      <details class="proj" ${open.has(f.cwd) || q ? 'open' : ''}>
        <summary>
          <div style="min-width:0"><div class="ptitle">${esc(short(f.cwd).split('/').pop() || f.cwd)}</div><div class="sub ${f.exists ? '' : 'gone'}" style="margin-left:16px">${esc(short(f.cwd))}${f.exists ? '' : ' · folder no longer exists'}</div></div>
          <div class="pmeta"><div>${f.accounts.map((a) => chip(a)).join(' ')}</div><div class="muted small">${f.sessionCount} session${f.sessionCount === 1 ? '' : 's'} · ${ago(f.lastActive)}</div>${f.removable ? `<button class="btn small danger" style="margin-top:6px" data-remove="${esc(f.cwd)}" data-sessions="${f.sessionCount}">Remove</button>` : ''}</div>
          ${f.config ? cfgPills(f.config, short(f.cwd).split('/').pop() || f.cwd) : '<div class="muted small" style="grid-column:1/-1;margin-left:16px">No configuration to read (folder is gone).</div>'}
        </summary>
        <div class="psess"><div class="prow th"><span>Session</span><span>Session ID</span><span>Last message</span><span class="right">Last active</span></div>
          ${f.sessions.map((s) => `
          <div class="prow" data-go="#/session/${esc(s.account)}/${esc(s.id)}">
            <div style="min-width:0"><div class="t">${hl(title(s), q)}</div><div class="sub">${chip(s.account)} ${s.copy ? '<span class="tag">copy</span> ' : ''}<span class="muted">${s.messages} msgs</span></div></div>
            <div class="sid"><code class="mono">${hl(s.id, q)}</code><button class="btn small" data-copy="${esc(s.id)}">Copy</button></div>
            <div class="lm">${s.lastMessage ? `<b>${s.lastMessage.role === 'user' ? 'You' : 'Claude'}:</b> ${esc(s.lastMessage.text.replace(/\s+/g, ' '))}` : '<span class="muted">—</span>'}</div>
            <div class="right muted">${ago(s.end)}</div>
          </div>`).join('')}</div>
      </details>`).join('') || '<div class="table"><div class="empty">No folders match.</div></div>'}`;
  bindFilters('projects');
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
  else if (r === 'projects') await projects(params);
  else if (r === 'artifacts') await artifacts(params);
  else if (r === 'shared') await shared(params);
  else if (r === 'sessions') await sessions(params);
  else if (r === 'session') await session(parts[1], parts[2]);
  else if (r === 'search') await search(params);
  else if (r === 'usage') usage();
}
async function removeMissing(cwd, nSessions, nFolders) {
  const what = cwd ? `the ${nSessions} session${nSessions === 1 ? '' : 's'} of ${short(cwd)}` : `${nSessions} session${nSessions === 1 ? '' : 's'} from ${nFolders} missing folder${nFolders === 1 ? '' : 's'}`;
  if (!confirm(`Remove ${what} from Claude Code?\n\nThe folder no longer exists on disk. The session files are moved to a trash folder, not deleted, so you can restore them${TRASH ? ' from ' + short(TRASH) : ''}.`)) return;
  const r = await fetch('/api/remove-missing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: cwd || null }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  if (r.error) return toast(r.error);
  toast(r.sessions ? `Moved ${r.sessions} session${r.sessions === 1 ? '' : 's'} to trash` : 'Nothing to remove');
  if (r.trash) console.info('Trash:', r.trash);
  waitIndex();
}
function showDetail(d) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  const render = (q) => {
    const list = d.names.filter((n) => !q || n.toLowerCase().includes(q));
    return list.length ? `<ul>${list.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<div class="muted" style="padding:12px 0">None.</div>';
  };
  bg.innerHTML = `<div class="modal" role="dialog"><header><h3>${esc(d.title)} <span class="muted">(${d.names.length}${d.kind === 'plugins' && d.installed != null ? ` enabled of ${d.installed} installed` : ''})</span></h3><button class="btn small" data-close>Close</button></header>
    <div class="mbody">${d.names.length > 8 ? '<input type="search" placeholder="Filter…">' : ''}<div id="mlist">${render('')}</div></div></div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.onclick = (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  const inp = bg.querySelector('input'); if (inp) { inp.oninput = () => { bg.querySelector('#mlist').innerHTML = render(inp.value.toLowerCase()); }; inp.focus(); }
}
document.addEventListener('click', (e) => {
  const pill = e.target.closest('[data-detail]');
  if (pill) { e.preventDefault(); e.stopPropagation(); return showDetail(cfgDetail[Number(pill.dataset.detail)]); }
  const rm = e.target.closest('[data-remove], [data-remove-all]');
  if (rm) { e.preventDefault(); e.stopPropagation(); return removeMissing(rm.dataset.remove || null, Number(rm.dataset.sessions), Number(rm.dataset.removeAll || 1)); }
  const c = e.target.closest('[data-copy]'); if (c) { e.stopPropagation(); return copy(c.dataset.copy); }
  const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go;
});
addEventListener('hashchange', route);
waitIndex();
