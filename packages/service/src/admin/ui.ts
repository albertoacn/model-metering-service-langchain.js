/* eslint-disable max-len */

/**
 * Returns the complete HTML for the admin web interface.
 * Served by GET /admin in server.ts.
 *
 * Self-contained: no external dependencies, no build step.
 * The page calls the existing /v1/admin/api-keys REST endpoints directly.
 */
export function adminUI(): string {
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>API Key Manager</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2e3148;
    --accent: #6c63ff; --accent-hover: #8b85ff;
    --text: #e2e4f0; --muted: #7b7f9e; --danger: #e05c5c;
    --green: #4caf82; --yellow: #f0b429;
    --radius: 8px; --font: 'Inter', system-ui, sans-serif;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font); min-height: 100vh; }
  header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 1.1rem; font-weight: 600; }
  header span { color: var(--muted); font-size: 0.85rem; }
  main { max-width: 1100px; margin: 0 auto; padding: 28px 24px; }
  h2 { font-size: 0.95rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 14px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 24px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  label { display: block; font-size: 0.82rem; color: var(--muted); margin-bottom: 4px; }
  input, select { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 8px 10px; font-size: 0.9rem; outline: none; transition: border-color .15s; }
  input:focus, select:focus { border-color: var(--accent); }
  .row { display: flex; gap: 10px; align-items: flex-end; }
  .row > * { flex: 1; }
  button { cursor: pointer; border: none; border-radius: 6px; padding: 9px 18px; font-size: 0.9rem; font-weight: 500; transition: background .15s; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-sm { padding: 5px 12px; font-size: 0.8rem; }
  .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text); }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
  .btn-danger { background: transparent; border: 1px solid var(--danger); color: var(--danger); }
  .btn-danger:hover { background: var(--danger); color: #fff; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th { text-align: left; color: var(--muted); font-weight: 500; font-size: 0.78rem; text-transform: uppercase; letter-spacing: .05em; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,.02); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 0.75rem; font-weight: 500; }
  .badge-green { background: rgba(76,175,130,.15); color: var(--green); }
  .badge-yellow { background: rgba(240,180,41,.15); color: var(--yellow); }
  .badge-red { background: rgba(224,92,92,.15); color: var(--danger); }
  .bar-wrap { height: 6px; background: var(--border); border-radius: 3px; min-width: 80px; overflow: hidden; }
  .bar { height: 100%; border-radius: 3px; background: var(--accent); transition: width .3s; }
  .bar.warn { background: var(--yellow); }
  .bar.full { background: var(--danger); }
  .mono { font-family: 'Fira Mono', monospace; font-size: 0.82rem; }
  .key-cell { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .edit-row { display: none; background: rgba(108,99,255,.04); }
  .edit-row.open { display: table-row; }
  .edit-row td { padding: 12px; }
  .edit-form { display: flex; gap: 10px; align-items: flex-end; }
  .edit-form > div { flex: 1; }
  #detail-panel { display: none; }
  #detail-panel.open { display: block; }
  .usage-table th, .usage-table td { padding: 7px 10px; }
  .section-tabs { display: flex; gap: 4px; margin-bottom: 16px; }
  .tab { padding: 6px 16px; border-radius: 6px; font-size: 0.85rem; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--muted); }
  .tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .toast { position: fixed; bottom: 20px; right: 20px; background: var(--surface); border: 1px solid var(--border); padding: 10px 18px; border-radius: var(--radius); font-size: 0.85rem; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .empty { color: var(--muted); text-align: center; padding: 28px; font-size: 0.9rem; }
</style>
</head>
<body>
<header>
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  <h1>API Key Manager</h1>
  <span id="key-count"></span>
</header>
<main>
  <!-- Create -->
  <h2>Create API Key</h2>
  <div class="card">
    <div class="grid2">
      <div><label>API Key</label><input id="new-key" placeholder="sk-my-key" /></div>
      <div><label>Token Limit</label><input id="new-limit" type="number" value="100000" min="1" /></div>
      <div><label>Reset Schedule</label>
        <select id="new-schedule">
          <option value="none">None</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      <div style="display:flex;align-items:flex-end">
        <button class="btn-primary" style="width:100%" onclick="createKey()">Create Key</button>
      </div>
    </div>
  </div>

  <!-- List -->
  <h2>API Keys</h2>
  <div class="card" style="padding:0;overflow:hidden">
    <table id="keys-table">
      <thead>
        <tr>
          <th>Key</th><th>Usage</th><th>Tokens</th><th>Cost</th><th>Schedule</th><th>Next Reset</th><th></th>
        </tr>
      </thead>
      <tbody id="keys-body"></tbody>
    </table>
  </div>

  <!-- Detail -->
  <div id="detail-panel">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <h2 id="detail-title">Usage History</h2>
      <button class="btn-ghost btn-sm" onclick="closeDetail()">✕ Close</button>
    </div>
    <div class="section-tabs">
      <button class="tab active" onclick="switchTab('events')">Events</button>
      <button class="tab" onclick="switchTab('summary')">Summary</button>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div id="tab-events"></div>
      <div id="tab-summary" style="display:none"></div>
    </div>
  </div>
</main>

<div class="toast" id="toast"></div>

<script>
let currentDetailKey = null;
let currentTab = 'events';

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

function toast(msg, ok = true) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = ok ? 'var(--accent)' : 'var(--danger)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function bar(count, limit) {
  const pct = limit > 0 ? Math.min(100, Math.round(count / limit * 100)) : 0;
  const cls = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : '';
  return '<div class="bar-wrap"><div class="bar ' + cls + '" style="width:' + pct + '%"></div></div>';
}

function badge(schedule) {
  if (schedule === 'none') return '<span class="badge badge-yellow">none</span>';
  return '<span class="badge badge-green">' + schedule + '</span>';
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtCost(n) {
  return '$' + (n || 0).toFixed(4);
}

async function loadKeys() {
  const { data } = await api('GET', '/v1/admin/api-keys');
  const tbody = document.getElementById('keys-body');
  document.getElementById('key-count').textContent = data.length + ' key' + (data.length !== 1 ? 's' : '');

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No API keys yet</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(k => {
    const pct = k.token_limit > 0 ? Math.round(k.token_count / k.token_limit * 100) : 0;
    return \`
      <tr>
        <td><span class="mono key-cell" title="\${k.api_key}">\${k.api_key}</span></td>
        <td>\${bar(k.token_count, k.token_limit)}<span style="font-size:.75rem;color:var(--muted)">\${pct}%</span></td>
        <td style="color:var(--muted);font-size:.82rem">\${k.token_count.toLocaleString()} / \${k.token_limit.toLocaleString()}</td>
        <td>\${fmtCost(k.total_cost)}</td>
        <td>\${badge(k.reset_schedule)}</td>
        <td style="font-size:.82rem;color:var(--muted)">\${fmtDate(k.reset_at)}</td>
        <td style="white-space:nowrap;display:flex;gap:6px">
          <button class="btn-ghost btn-sm" onclick="toggleEdit('\${k.api_key}')">Edit</button>
          <button class="btn-ghost btn-sm" onclick="openDetail('\${k.api_key}')">Usage</button>
        </td>
      </tr>
      <tr class="edit-row" id="edit-\${k.api_key}">
        <td colspan="7">
          <div class="edit-form">
            <div><label>Token Limit</label><input id="el-\${k.api_key}" type="number" value="\${k.token_limit}" /></div>
            <div><label>Reset Schedule</label>
              <select id="es-\${k.api_key}">
                \${['none','daily','weekly','monthly'].map(s => '<option value="' + s + '"' + (s === k.reset_schedule ? ' selected' : '') + '>' + s + '</option>').join('')}
              </select>
            </div>
            <div style="display:flex;align-items:flex-end;gap:6px">
              <button class="btn-primary btn-sm" onclick="saveKey('\${k.api_key}')">Save</button>
              <button class="btn-ghost btn-sm" onclick="toggleEdit('\${k.api_key}')">Cancel</button>
            </div>
          </div>
        </td>
      </tr>
    \`;
  }).join('');

  if (currentDetailKey) openDetail(currentDetailKey);
}

async function createKey() {
  const key = document.getElementById('new-key').value.trim();
  const limit = parseInt(document.getElementById('new-limit').value);
  const schedule = document.getElementById('new-schedule').value;
  if (!key) return toast('Key name is required', false);
  if (!limit || limit < 1) return toast('Token limit must be a positive number', false);

  const { ok, data } = await api('POST', '/v1/admin/api-keys', { api_key: key, token_limit: limit, reset_schedule: schedule });
  if (!ok) return toast(data.error || 'Failed to create key', false);
  document.getElementById('new-key').value = '';
  toast('Key created');
  loadKeys();
}

function toggleEdit(key) {
  const row = document.getElementById('edit-' + key);
  row.classList.toggle('open');
}

async function saveKey(key) {
  const limit = parseInt(document.getElementById('el-' + key).value);
  const schedule = document.getElementById('es-' + key).value;
  if (!limit || limit < 1) return toast('Token limit must be a positive number', false);

  const { ok, data } = await api('PATCH', '/v1/admin/api-keys/' + key, { token_limit: limit, reset_schedule: schedule });
  if (!ok) return toast(data.error || 'Failed to update key', false);
  toast('Saved');
  loadKeys();
}

async function openDetail(key) {
  currentDetailKey = key;
  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('detail-title').textContent = 'Usage — ' + key;
  document.getElementById('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await loadTab(currentTab);
}

function closeDetail() {
  currentDetailKey = null;
  document.getElementById('detail-panel').classList.remove('open');
}

async function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.textContent.toLowerCase() === tab));
  document.getElementById('tab-events').style.display = tab === 'events' ? '' : 'none';
  document.getElementById('tab-summary').style.display = tab === 'summary' ? '' : 'none';
  await loadTab(tab);
}

async function loadTab(tab) {
  if (!currentDetailKey) return;
  if (tab === 'events') {
    const { data } = await api('GET', '/v1/admin/api-keys/' + currentDetailKey + '/usage');
    const el = document.getElementById('tab-events');
    if (!data.length) { el.innerHTML = '<div class="empty">No events yet</div>'; return; }
    el.innerHTML = '<table class="usage-table"><thead><tr><th>Time</th><th>Model</th><th>Provider</th><th>Input</th><th>Output</th><th>Cost</th></tr></thead><tbody>' +
      data.map(e => '<tr><td style="color:var(--muted);font-size:.8rem">' + new Date(e.ts).toLocaleString() + '</td><td class="mono">' + e.model + '</td><td>' + e.provider + '</td><td>' + e.input_tokens + '</td><td>' + e.output_tokens + '</td><td>' + fmtCost(e.cost) + '</td></tr>').join('') +
      '</tbody></table>';
  } else {
    const { data } = await api('GET', '/v1/admin/api-keys/' + currentDetailKey + '/usage/summary');
    const el = document.getElementById('tab-summary');
    if (!data.length) { el.innerHTML = '<div class="empty">No usage yet</div>'; return; }
    el.innerHTML = '<table class="usage-table"><thead><tr><th>Date</th><th>Model</th><th>Provider</th><th>Requests</th><th>Total Tokens</th><th>Cost</th></tr></thead><tbody>' +
      data.map(r => '<tr><td>' + r.date + '</td><td class="mono">' + r.model + '</td><td>' + r.provider + '</td><td>' + r.requests + '</td><td>' + r.total_tokens.toLocaleString() + '</td><td>' + fmtCost(r.cost) + '</td></tr>').join('') +
      '</tbody></table>';
  }
}

loadKeys();
setInterval(loadKeys, 10000);
</script>
</body>
</html>`;
}