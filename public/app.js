// SplitPair frontend — plain JavaScript, no build step.
// Convention: amounts are integers in minor units (cents). Users are 1 and 2.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const modal = $('#modal');

// ---------- categories ----------
const EXPENSE_CATS = [
  ['General', '🧾'], ['Groceries', '🛒'], ['Dining out', '🍽️'], ['Rent & mortgage', '🏠'], ['Utilities', '💡'],
  ['Internet & phone', '📶'], ['Transport', '🚇'], ['Car & fuel', '⛽'], ['Household', '🧺'], ['Furniture', '🛋️'],
  ['Entertainment', '🎬'], ['Travel', '✈️'], ['Health', '💊'], ['Shopping', '🛍️'], ['Clothing', '👕'], ['Gifts', '🎁'],
  ['Pets', '🐾'], ['Subscriptions', '🔁'], ['Insurance', '🛡️'], ['Kids', '🧸'], ['Taxes', '🏛️'], ['Other', '📦'],
];
const INCOME_CATS = [
  ['Salary', '💼'], ['Refund', '↩️'], ['Reimbursement', '🧾'], ['Gift received', '🎁'], ['Interest & dividends', '📈'],
  ['Sale', '🏷️'], ['Rental income', '🔑'], ['Tax refund', '🏛️'], ['Other income', '💰'],
];
const CAT_ICON = Object.fromEntries([...EXPENSE_CATS, ...INCOME_CATS]);
const iconFor = (t) => (t.kind === 'payment' ? '🤝' : CAT_ICON[t.category] || (t.kind === 'income' ? '💰' : '🧾'));
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'CNY', 'HKD', 'SGD', 'TWD', 'KRW', 'INR', 'MXN', 'BRL', 'SEK', 'NOK', 'DKK', 'PLN', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'ZAR', 'AED'];
const FREQ_LABEL = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', yearly: 'Yearly' };

// ---------- money ----------
const digitsCache = {};
function minorDigits(cur) {
  if (!(cur in digitsCache)) {
    try { digitsCache[cur] = new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; }
    catch { digitsCache[cur] = 2; }
  }
  return digitsCache[cur];
}
const fmt = (c, cur) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(c / 10 ** minorDigits(cur)); }
  catch { return `${(c / 100).toFixed(2)} ${cur}`; }
};
const toMinor = (v, cur) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 10 ** minorDigits(cur)) : NaN;
};
const toMajorStr = (c, cur) => (c / 10 ** minorDigits(cur)).toFixed(minorDigits(cur));

// Positive = user 2 owes user 1.
const net1 = (t) => (t.kind === 'income' ? -(t.paid1 - t.share1) : t.paid1 - t.share1);
// Positive = partner owes me.
const myNet = (t) => (S.me === 1 ? net1(t) : -net1(t));
const other = () => (S.me === 1 ? 2 : 1);
const name = (u) => S.users[u];
const youOr = (u) => (u === S.me ? 'You' : name(u));

// ---------- api ----------
let S = null; // app state from /api/data
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'splitpair' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('Not logged in'); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
async function load() {
  S = await api('/data');
  render();
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- login ----------
async function showLogin() {
  let users = { 1: 'User 1', 2: 'User 2' };
  try { users = (await api('/config')).users; } catch {}
  let who = Number(localStorage.getItem('sp_last_user') || 1);
  app.innerHTML = `
    <form class="login card" id="loginForm">
      <img class="logo" src="/icon.svg" alt="">
      <h1 style="text-align:center;margin:0">SplitPair</h1>
      <p class="muted" style="text-align:center;margin:4px 0 0">Who's this?</p>
      <div class="who">
        <button type="button" data-u="1">${esc(users[1])}</button>
        <button type="button" data-u="2">${esc(users[2])}</button>
      </div>
      <label class="f" for="pw">Password</label>
      <input id="pw" type="password" autocomplete="current-password" required>
      <div class="err" id="loginErr"></div>
      <button class="btn primary" style="width:100%;margin-top:8px">Log in</button>
    </form>`;
  const mark = () => $$('.who button').forEach((b) => b.classList.toggle('on', Number(b.dataset.u) === who));
  mark();
  $$('.who button').forEach((b) => (b.onclick = () => { who = Number(b.dataset.u); mark(); $('#pw').focus(); }));
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/login', { method: 'POST', body: { user: who, password: $('#pw').value } });
      localStorage.setItem('sp_last_user', who);
      await load();
    } catch (err) { $('#loginErr').textContent = err.message; }
  };
}

// ---------- rendering helpers ----------
const fmtDate = (iso, opts = { month: 'short', day: 'numeric' }) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, opts);
const monthKey = (iso) => iso.slice(0, 7);
const monthLabel = (key) => new Date(key + '-15T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function balances(txs = S.transactions) {
  const by = {};
  for (const t of txs) by[t.currency] = (by[t.currency] || 0) + myNet(t);
  return by;
}

function subtitle(t) {
  if (t.kind === 'payment') {
    const from = t.paid1 ? 1 : 2;
    return `${youOr(from)} paid ${from === S.me ? name(other()) : 'you'}`;
  }
  const verb = t.kind === 'income' ? 'received' : 'paid';
  if (t.paid1 && t.paid2) return `Both ${verb} ${fmt(t.amount, t.currency)}`;
  return `${youOr(t.paid1 ? 1 : 2)} ${verb} ${fmt(t.amount, t.currency)}`;
}
function effectLabel(t) {
  const n = myNet(t);
  if (t.kind === 'payment') return `<b>${fmt(t.amount, t.currency)}</b><span class="muted">settled</span>`;
  if (n === 0) {
    const mine = S.me === 1 ? t.share1 : t.share2;
    return mine ? `<span class="muted">personal</span>` : `<span class="muted">not involved</span>`;
  }
  const word = t.kind === 'income' ? (n > 0 ? 'you get' : 'you owe') : n > 0 ? 'you lent' : 'you borrowed';
  return `<span class="${n > 0 ? 'pos' : 'neg'}">${word}<b>${fmt(Math.abs(n), t.currency)}</b></span>`;
}
function txRow(t) {
  const group = t.group_id && S.groups.find((g) => g.id === t.group_id);
  const extras = [t.recurring_id ? '🔁' : '', t.comment_count ? `💬${t.comment_count}` : '', t.has_receipt ? '📎' : ''].filter(Boolean).join(' ');
  return `<button class="item" data-tx="${t.id}">
    <div class="ico">${iconFor(t)}</div>
    <div class="grow">
      <div class="ttl">${t.kind === 'income' ? '<span class="inc">＋</span> ' : ''}${esc(t.description)}</div>
      <div class="muted small">${fmtDate(t.date)} · ${esc(subtitle(t))}${group ? ` · ${esc(group.name)}` : ''} ${extras}</div>
    </div>
    <div class="amt">${effectLabel(t)}</div>
  </button>`;
}
function txList(txs, { monthTotals = false } = {}) {
  if (!txs.length) return `<div class="list"><div class="empty">Nothing here yet.</div></div>`;
  let html = '', cur = null, chunk = [];
  const flush = () => {
    if (!chunk.length) return;
    html += `<div class="month"><span>${monthLabel(cur)}</span>${monthTotals ? `<span>${chunk.length} item${chunk.length > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="list">${chunk.map(txRow).join('')}</div>`;
    chunk = [];
  };
  for (const t of txs) {
    if (monthKey(t.date) !== cur) { flush(); cur = monthKey(t.date); }
    chunk.push(t);
  }
  flush();
  return html;
}
function balanceText(cents, cur) {
  if (cents === 0) return `<span class="muted">All settled up</span>`;
  return cents > 0
    ? `<span class="pos">${esc(name(other()))} owes you ${fmt(cents, cur)}</span>`
    : `<span class="neg">You owe ${esc(name(other()))} ${fmt(-cents, cur)}</span>`;
}

// ---------- router & shell ----------
const TABS = [['home', '🏠', 'Home'], ['activity', '📋', 'Activity'], ['stats', '📊', 'Stats'], ['more', '⚙️', 'More']];
let view = { tab: 'home', filters: { q: '', kind: '', group: '', cat: '', month: '' }, stats: { period: 'month', who: 'total', cur: null }, actMode: 'tx' };

function render() {
  if (!S) return;
  view.tab = (location.hash.replace('#/', '') || 'home').split('?')[0];
  if (!TABS.some((t) => t[0] === view.tab)) view.tab = 'home';
  const title = { home: `Hi, ${esc(name(S.me))}`, activity: 'Activity', stats: 'Stats', more: 'More' }[view.tab];
  app.innerHTML = `
    <header class="top"><div class="inner"><h1>${title}</h1>
      <button class="btn sm" id="settleBtn">Settle up</button></div></header>
    <main class="wrap" id="main">${VIEWS[view.tab]()}</main>
    <button class="fab" id="addBtn">＋ Add</button>
    <nav class="tabs">${TABS.map(([k, i, l]) => `<a href="#/${k}" class="${view.tab === k ? 'on' : ''}"><span>${i}</span>${l}</a>`).join('')}</nav>`;
  $('#addBtn').onclick = () => openForm();
  $('#settleBtn').onclick = () => openSettle();
  bindCommon(app);
  BIND[view.tab]?.();
}
function bindCommon(root) {
  $$('[data-tx]', root).forEach((el) => (el.onclick = () => openDetail(el.dataset.tx)));
}
window.addEventListener('hashchange', render);

// ---------- views ----------
const VIEWS = {
  home() {
    const bal = balances();
    const nonZero = Object.entries(bal).filter(([, v]) => v !== 0);
    const def = S.settings.default_currency || 'USD';
    const balHtml = nonZero.length
      ? nonZero.map(([cur, v]) => `<div class="row between" style="margin:6px 0">
          <div><div class="balance-big">${balanceText(v, cur)}</div></div>
          <button class="btn sm" data-settle="${cur}">Settle</button></div>`).join('')
      : `<div class="balance-big">${balanceText(0, def)}</div>`;
    const activeGroups = S.groups.filter((g) => !g.archived);
    const groupHtml = activeGroups.map((g) => {
      const b = Object.entries(balances(S.transactions.filter((t) => t.group_id === g.id))).filter(([, v]) => v);
      return `<a class="item" href="#/activity" data-group-link="${g.id}">
        <div class="ico">👥</div><div class="grow"><div class="ttl">${esc(g.name)}</div>
        <div class="small">${b.length ? b.map(([c, v]) => balanceText(v, c)).join(' · ') : '<span class="muted">settled</span>'}</div></div></a>`;
    }).join('');
    // This month at a glance, in the default currency.
    const m = S.today.slice(0, 7);
    const thisMonth = S.transactions.filter((t) => monthKey(t.date) === m && t.currency === def);
    const mine = (t) => (S.me === 1 ? t.share1 : t.share2);
    const spent = thisMonth.filter((t) => t.kind === 'expense').reduce((a, t) => a + mine(t), 0);
    const earned = thisMonth.filter((t) => t.kind === 'income').reduce((a, t) => a + mine(t), 0);
    const total = thisMonth.filter((t) => t.kind === 'expense').reduce((a, t) => a + t.amount, 0);
    return `
      <section class="card"><h2>Balance</h2>${balHtml}</section>
      <section class="card"><h2>${monthLabel(m)} · ${def}</h2>
        <div class="kpis">
          <div class="kpi"><b>${fmt(total, def)}</b><span>Total spent together</span></div>
          <div class="kpi"><b class="neg">${fmt(spent, def)}</b><span>Your share of spending</span></div>
          <div class="kpi"><b class="inc">${fmt(earned, def)}</b><span>Your income</span></div>
        </div></section>
      ${groupHtml ? `<h2 class="sec">Groups</h2><div class="list">${groupHtml}</div>` : ''}
      <h2 class="sec">Recent</h2>
      ${txList(S.transactions.slice(0, 15))}
      ${S.transactions.length > 15 ? `<p style="text-align:center"><a href="#/activity">See all ${S.transactions.length} →</a></p>` : ''}`;
  },

  activity() {
    const f = view.filters;
    if (view.actMode === 'log') {
      return `${actModeSeg()}<div id="logList"><div class="empty">Loading…</div></div>`;
    }
    const cats = [...new Set(S.transactions.map((t) => t.category))].sort();
    const months = [...new Set(S.transactions.map((t) => monthKey(t.date)))];
    const txs = filteredTxs();
    const bal = Object.entries(balances(txs)).filter(([, v]) => v);
    return `${actModeSeg()}
      <input type="search" id="q" placeholder="Search descriptions, notes, categories…" value="${esc(f.q)}" style="margin-top:10px">
      <div class="filters">
        <select id="fKind"><option value="">All types</option>
          ${['expense', 'income', 'payment'].map((k) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}s</option>`).join('')}</select>
        <select id="fGroup"><option value="">All groups</option><option value="none" ${f.group === 'none' ? 'selected' : ''}>No group</option>
          ${S.groups.map((g) => `<option value="${g.id}" ${f.group === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
        <select id="fCat"><option value="">All categories</option>
          ${cats.map((c) => `<option ${f.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="fMonth"><option value="">All months</option>
          ${months.map((mk) => `<option value="${mk}" ${f.month === mk ? 'selected' : ''}>${monthLabel(mk)}</option>`).join('')}</select>
      </div>
      ${Object.values(f).some(Boolean) ? `<div class="small" style="margin:6px 4px">${txs.length} result${txs.length === 1 ? '' : 's'}${bal.length ? ' · net ' + bal.map(([c, v]) => balanceText(v, c)).join(' · ') : ''}
        · <a href="#" id="clearF">clear filters</a></div>` : ''}
      <div id="txs">${txList(txs, { monthTotals: true })}</div>`;
  },

  stats() {
    const st = view.stats;
    const currencies = [...new Set(S.transactions.map((t) => t.currency))];
    if (!st.cur || !currencies.includes(st.cur)) st.cur = currencies.includes(S.settings.default_currency) ? S.settings.default_currency : currencies[0] || S.settings.default_currency;
    const cur = st.cur;
    const [from, to] = periodRange(st.period);
    const pick = (t) => (st.who === 'total' ? t.amount : st.who === 'me' ? (S.me === 1 ? t.share1 : t.share2) : (S.me === 1 ? t.share2 : t.share1));
    const inPeriod = S.transactions.filter((t) => t.currency === cur && t.date >= from && t.date <= to && t.kind !== 'payment');
    const exp = inPeriod.filter((t) => t.kind === 'expense');
    const inc = inPeriod.filter((t) => t.kind === 'income');
    const sum = (arr) => arr.reduce((a, t) => a + pick(t), 0);
    const totalExp = sum(exp), totalInc = sum(inc);
    const byCat = (arr) => {
      const m = {};
      for (const t of arr) m[t.category] = (m[t.category] || 0) + pick(t);
      return Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    };
    const catBars = (rows, total, color) => rows.length
      ? rows.map(([c, v]) => `<div class="bar-row"><div>${CAT_ICON[c] || '•'} ${esc(c)}</div>
          <div class="bar"><i style="width:${(100 * v / total).toFixed(1)}%;background:${color}"></i></div>
          <div>${fmt(v, cur)} <span class="muted small">${Math.round(100 * v / total)}%</span></div></div>`).join('')
      : `<div class="muted small">Nothing in this period.</div>`;
    // Who paid what (expenses only), useful for "who's been covering more".
    const paidBy = { 1: 0, 2: 0 };
    for (const t of exp) { paidBy[1] += t.paid1; paidBy[2] += t.paid2; }
    // Last 12 months chart.
    const months = [];
    const d = new Date(S.today + 'T12:00:00');
    for (let i = 11; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 15);
      months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
    }
    const monthly = months.map((mk) => {
      const ts = S.transactions.filter((t) => t.currency === cur && monthKey(t.date) === mk);
      return { mk, e: sum(ts.filter((t) => t.kind === 'expense')), i: sum(ts.filter((t) => t.kind === 'income')) };
    });
    const max = Math.max(1, ...monthly.flatMap((m) => [m.e, m.i]));
    const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${st[key] === v ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
    return `
      <div class="row wrap-row" style="gap:8px;margin-top:6px">
        ${seg('period', [['month', 'This month'], ['last', 'Last month'], ['year', 'This year'], ['12m', '12 months'], ['all', 'All']])}
      </div>
      <div class="row wrap-row" style="gap:8px;margin-top:8px">
        ${seg('who', [['total', 'Total'], ['me', 'Your share'], ['partner', `${name(other())}'s share`]])}
        ${currencies.length > 1 ? `<select id="stCur" style="width:auto">${currencies.map((c) => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select>` : ''}
      </div>
      <section class="card"><h2>${esc(fmtDate(from, { month: 'short', day: 'numeric', year: 'numeric' }))} – ${esc(fmtDate(to, { month: 'short', day: 'numeric', year: 'numeric' }))}</h2>
        <div class="kpis">
          <div class="kpi"><b class="neg">${fmt(totalExp, cur)}</b><span>Spent</span></div>
          <div class="kpi"><b class="inc">${fmt(totalInc, cur)}</b><span>Income</span></div>
          <div class="kpi"><b class="${totalInc - totalExp >= 0 ? 'pos' : 'neg'}">${fmt(totalInc - totalExp, cur)}</b><span>Net</span></div>
        </div></section>
      <section class="card"><h2>Last 12 months</h2>
        <div class="chart" role="img" aria-label="Monthly spending and income">
          ${monthly.map((m) => `<div class="col" title="${monthLabel(m.mk)}: spent ${fmt(m.e, cur)}, income ${fmt(m.i, cur)}">
            <div class="bars"><i style="height:${(100 * m.e / max).toFixed(1)}%"></i><i class="in" style="height:${(100 * m.i / max).toFixed(1)}%"></i></div>
            <div class="lbl">${new Date(m.mk + '-15T12:00:00').toLocaleDateString(undefined, { month: 'narrow' })}</div></div>`).join('')}
        </div>
        <div class="legend"><span><i style="background:var(--neg)"></i>Spent</span><span><i style="background:var(--income)"></i>Income</span></div>
      </section>
      <section class="card"><h2>Spending by category</h2>${catBars(byCat(exp), totalExp, 'var(--neg)')}</section>
      <section class="card"><h2>Income by category</h2>${catBars(byCat(inc), totalInc, 'var(--income)')}</section>
      <section class="card"><h2>Who paid for shared spending</h2>
        ${[1, 2].map((u) => `<div class="bar-row"><div>${esc(name(u))}</div><div class="bar"><i style="width:${(100 * paidBy[u] / Math.max(1, paidBy[1] + paidBy[2])).toFixed(1)}%"></i></div><div>${fmt(paidBy[u], cur)}</div></div>`).join('')}
      </section>`;
  },

  more() {
    const groups = S.groups.map((g) => `<div class="item" style="cursor:default">
      <div class="ico">👥</div><div class="grow"><div class="ttl">${esc(g.name)}</div>
      <div class="muted small">${S.transactions.filter((t) => t.group_id === g.id).length} items${g.archived ? ' · archived' : ''}</div></div>
      <button class="btn sm" data-rename="${g.id}">Rename</button>
      <button class="btn sm" data-archive="${g.id}">${g.archived ? 'Unarchive' : 'Archive'}</button></div>`).join('');
    const rec = S.recurring.map((r) => `<div class="item" style="cursor:default">
      <div class="ico">${iconFor(r.template)}</div><div class="grow"><div class="ttl">${esc(r.template.description)}</div>
      <div class="muted small">${fmt(r.template.amount, r.template.currency)} · ${FREQ_LABEL[r.frequency]} · ${r.active ? 'next ' + fmtDate(r.next_date) : 'paused'}</div></div>
      <button class="btn sm" data-rec-toggle="${r.id}" data-active="${r.active}">${r.active ? 'Pause' : 'Resume'}</button>
      <button class="btn sm danger" data-rec-del="${r.id}">Delete</button></div>`).join('');
    return `
      <h2 class="sec">Groups <span class="muted" style="text-transform:none;letter-spacing:0">(trips, projects, a house…)</span></h2>
      <div class="list">${groups || '<div class="empty">No groups yet.</div>'}
        <form class="item" id="newGroup" style="cursor:default"><input type="text" id="groupName" placeholder="New group name" maxlength="60" required><button class="btn primary sm">Add</button></form></div>
      <h2 class="sec">Recurring</h2>
      <div class="list">${rec || '<div class="empty">No recurring items. Choose “Repeat” when adding an expense or income.</div>'}</div>
      <h2 class="sec">Settings</h2>
      <div class="list">
        <div class="item" style="cursor:default"><div class="grow">Default currency</div>
          <select id="defCur" style="width:auto">${[...new Set([S.settings.default_currency, ...CURRENCIES])].map((c) => `<option ${c === S.settings.default_currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <a class="item" href="/api/export.csv" download><div class="grow">Export everything as CSV</div><span>⬇️</span></a>
        <button class="item" id="showDeleted"><div class="grow">Recently deleted</div><span>🗑️</span></button>
        <button class="item" id="logout"><div class="grow neg">Log out (${esc(name(S.me))})</div></button>
      </div>
      <p class="muted small" style="text-align:center;margin-top:24px">SplitPair · ${S.transactions.length} transactions</p>`;
  },
};

function actModeSeg() {
  return `<div class="seg" id="actMode" style="margin-top:6px">
    <button data-v="tx" class="${view.actMode === 'tx' ? 'on' : ''}">Transactions</button>
    <button data-v="log" class="${view.actMode === 'log' ? 'on' : ''}">Change log</button></div>`;
}
function filteredTxs() {
  const f = view.filters;
  const q = f.q.trim().toLowerCase();
  return S.transactions.filter((t) =>
    (!f.kind || t.kind === f.kind) &&
    (!f.group || (f.group === 'none' ? !t.group_id : t.group_id === f.group)) &&
    (!f.cat || t.category === f.cat) &&
    (!f.month || monthKey(t.date) === f.month) &&
    (!q || `${t.description} ${t.notes} ${t.category}`.toLowerCase().includes(q)));
}
function periodRange(p) {
  const today = S.today;
  const [y, m] = today.split('-').map(Number);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (p === 'month') return [`${today.slice(0, 7)}-01`, today];
  if (p === 'last') return [iso(new Date(y, m - 2, 1)), iso(new Date(y, m - 1, 0))];
  if (p === 'year') return [`${y}-01-01`, today];
  if (p === '12m') return [iso(new Date(y, m - 12, 1)), today];
  return ['0000-01-01', '9999-12-31'];
}

const BIND = {
  home() {
    $$('[data-settle]').forEach((b) => (b.onclick = () => openSettle(b.dataset.settle)));
    $$('[data-group-link]').forEach((a) => (a.onclick = () => {
      view.filters = { q: '', kind: '', group: a.dataset.groupLink, cat: '', month: '' };
      view.actMode = 'tx';
    }));
  },
  activity() {
    $$('#actMode button').forEach((b) => (b.onclick = () => { view.actMode = b.dataset.v; render(); }));
    if (view.actMode === 'log') {
      api('/activity').then((rows) => {
        $('#logList').innerHTML = rows.length
          ? `<div class="list" style="margin-top:10px">${rows.map((r) => `<${r.transaction_id ? `button data-tx="${r.transaction_id}"` : 'div'} class="item">
              <div class="grow"><div>${esc(r.summary)}</div><div class="muted small">${esc(youOr(r.user_id))} · ${new Date(r.created_at).toLocaleString()}</div></div>
            </${r.transaction_id ? 'button' : 'div'}>`).join('')}</div>`
          : '<div class="empty">No activity yet.</div>';
        bindCommon($('#logList'));
      });
      return;
    }
    const f = view.filters;
    const rerenderList = () => {
      // Re-render whole view (keeps it simple) but restore search focus.
      const pos = $('#q').selectionStart;
      render();
      const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos);
    };
    $('#q').oninput = (e) => { f.q = e.target.value; clearTimeout(rerenderList.t); rerenderList.t = setTimeout(rerenderList, 150); };
    $('#fKind').onchange = (e) => { f.kind = e.target.value; render(); };
    $('#fGroup').onchange = (e) => { f.group = e.target.value; render(); };
    $('#fCat').onchange = (e) => { f.cat = e.target.value; render(); };
    $('#fMonth').onchange = (e) => { f.month = e.target.value; render(); };
    const clr = $('#clearF');
    if (clr) clr.onclick = (e) => { e.preventDefault(); view.filters = { q: '', kind: '', group: '', cat: '', month: '' }; render(); };
  },
  stats() {
    $$('[data-seg]').forEach((s) => $$('button', s).forEach((b) => (b.onclick = () => { view.stats[s.dataset.seg] = b.dataset.v; render(); })));
    const c = $('#stCur');
    if (c) c.onchange = (e) => { view.stats.cur = e.target.value; render(); };
  },
  more() {
    $('#newGroup').onsubmit = async (e) => {
      e.preventDefault();
      await api('/groups', { method: 'POST', body: { name: $('#groupName').value } });
      toast('Group added'); load();
    };
    $$('[data-rename]').forEach((b) => (b.onclick = async () => {
      const g = S.groups.find((x) => x.id === b.dataset.rename);
      const n = prompt('Group name', g.name);
      if (n) { await api(`/groups/${g.id}`, { method: 'PUT', body: { name: n, archived: g.archived } }); load(); }
    }));
    $$('[data-archive]').forEach((b) => (b.onclick = async () => {
      const g = S.groups.find((x) => x.id === b.dataset.archive);
      await api(`/groups/${g.id}`, { method: 'PUT', body: { name: g.name, archived: !g.archived } }); load();
    }));
    $$('[data-rec-toggle]').forEach((b) => (b.onclick = async () => {
      await api(`/recurring/${b.dataset.recToggle}`, { method: 'PUT', body: { active: b.dataset.active !== '1' } }); load();
    }));
    $$('[data-rec-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Stop this recurring item? Past transactions are kept.')) return;
      await api(`/recurring/${b.dataset.recDel}`, { method: 'DELETE' }); toast('Recurring item removed'); load();
    }));
    $('#defCur').onchange = async (e) => { await api('/settings', { method: 'PUT', body: { default_currency: e.target.value } }); toast('Saved'); load(); };
    $('#showDeleted').onclick = openDeleted;
    $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); S = null; showLogin(); };
  },
};

// ---------- modal helpers ----------
function openModal(title, body, foot = '') {
  modal.innerHTML = `<div class="dlg-head"><h3>${title}</h3><button class="x" id="mClose" aria-label="Close">✕</button></div>
    <div class="dlg-body">${body}</div>${foot ? `<div class="dlg-foot">${foot}</div>` : ''}`;
  $('#mClose').onclick = () => modal.close();
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
}
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

// ---------- add / edit form ----------
const SPLIT_METHODS = {
  equal: 'Equally',
  exact: 'Exact amounts',
  percent: 'Percentages',
  shares: 'Shares',
  adjust: 'Adjustment',
  only1: null, // labels depend on names, set in form
  only2: null,
};

function openForm(existing = null, preset = {}) {
  const t = existing || {
    kind: preset.kind || 'expense', description: '', amount: 0, currency: S.settings.default_currency || 'USD',
    date: S.today, category: preset.kind === 'income' ? 'Salary' : 'General', group_id: view.filters.group && view.filters.group !== 'none' ? view.filters.group : null,
    notes: '', split: {},
  };
  const sp = { method: 'equal', paidMode: `u${S.me}`, v1: '', v2: '', p1: '', p2: '', ...t.split };
  const rec = existing?.recurring_id && S.recurring.find((r) => r.id === existing.recurring_id);
  let kind = t.kind === 'payment' ? 'expense' : t.kind;

  const catOptions = (k, sel) => (k === 'income' ? INCOME_CATS : EXPENSE_CATS)
    .map(([c, i]) => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${i} ${esc(c)}</option>`).join('');
  const curOptions = [...new Set([t.currency, S.settings.default_currency, ...CURRENCIES])]
    .map((c) => `<option ${c === t.currency ? 'selected' : ''}>${c}</option>`).join('');

  openModal(existing ? 'Edit' : 'Add', `
    <form id="txForm" novalidate>
      <div class="seg" id="kindSeg" style="margin-top:12px">
        <button type="button" data-k="expense">💸 Expense</button>
        <button type="button" data-k="income">💰 Income</button>
      </div>
      <label class="f" for="desc">Description</label>
      <input type="text" id="desc" maxlength="200" value="${esc(t.description)}" placeholder="e.g. Groceries at Trader Joe's" required>
      <div class="grid3">
        <div><label class="f" for="amt">Amount</label>
          <input type="text" inputmode="decimal" id="amt" value="${t.amount ? toMajorStr(t.amount, t.currency) : ''}" placeholder="0.00" required></div>
        <div><label class="f" for="cur">Currency</label><select id="cur">${curOptions}</select></div>
      </div>
      <div class="grid2">
        <div><label class="f" for="date">Date</label><input type="date" id="date" value="${t.date}" required></div>
        <div><label class="f" for="cat">Category</label><select id="cat">${catOptions(kind, t.category)}</select></div>
      </div>

      <label class="f" id="paidLbl">Paid by</label>
      <div class="seg" id="paidSeg">
        <button type="button" data-p="u1">${esc(name(1))}</button>
        <button type="button" data-p="u2">${esc(name(2))}</button>
        <button type="button" data-p="both">Both</button>
      </div>
      <div class="grid2" id="paidBoth" hidden>
        <div><label class="f" for="p1">${esc(name(1))}</label><input type="text" inputmode="decimal" id="p1" value="${esc(sp.p1)}"></div>
        <div><label class="f" for="p2">${esc(name(2))}</label><input type="text" inputmode="decimal" id="p2" value="${esc(sp.p2)}"></div>
      </div>

      <label class="f" for="method" id="splitLbl">Split</label>
      <select id="method">
        ${Object.entries(SPLIT_METHODS).map(([k, l]) => `<option value="${k}" ${sp.method === k ? 'selected' : ''}>${l || ''}</option>`).join('')}
      </select>
      <div class="grid2" id="splitInputs">
        <div><label class="f" for="v1" id="v1l"></label><input type="text" inputmode="decimal" id="v1" value="${esc(sp.v1)}"></div>
        <div><label class="f" for="v2" id="v2l"></label><input type="text" inputmode="decimal" id="v2" value="${esc(sp.v2)}"></div>
      </div>
      <div class="preview" id="preview"></div>

      <div class="grid2">
        <div><label class="f" for="group">Group</label><select id="group"><option value="">None</option>
          ${S.groups.filter((g) => !g.archived || g.id === t.group_id).map((g) => `<option value="${g.id}" ${g.id === t.group_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
        <div><label class="f" for="repeat">Repeat</label><select id="repeat">
          <option value="none">Never</option>
          ${Object.entries(FREQ_LABEL).map(([k, l]) => `<option value="${k}" ${rec?.active && rec.frequency === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      ${rec ? `<label class="small" style="display:flex;gap:8px;margin-top:8px;align-items:center"><input type="checkbox" id="applyFuture"> Also apply these changes to future repeats</label>` : ''}
      <label class="f" for="notes">Notes</label>
      <textarea id="notes" maxlength="2000">${esc(t.notes)}</textarea>
      ${existing ? '' : `<label class="f" for="receipt">Receipt photo (optional)</label><input type="file" id="receipt" accept="image/*">`}
      <div class="err" id="formErr"></div>
    </form>`,
    `<button class="btn" type="button" id="cancelBtn">Cancel</button><button class="btn primary" id="saveBtn">Save</button>`);

  const form = $('#txForm');
  const opt = (k) => $(`#method option[value=${k}]`);
  let paidMode = sp.paidMode;

  const sync = () => {
    $$('#kindSeg button').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
    $$('#paidSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === paidMode));
    $('#paidBoth').hidden = paidMode !== 'both';
    $('#paidLbl').textContent = kind === 'income' ? 'Received by' : 'Paid by';
    $('#splitLbl').textContent = kind === 'income' ? 'Belongs to' : 'Split';
    opt('only1').textContent = kind === 'income' ? `All ${name(1)}'s` : `All for ${name(1)} (${name(1)} owes the full amount)`;
    opt('only2').textContent = kind === 'income' ? `All ${name(2)}'s` : `All for ${name(2)} (${name(2)} owes the full amount)`;
    opt('equal').textContent = kind === 'income' ? 'Shared equally' : 'Equally';
    const m = $('#method').value;
    const cur = $('#cur').value;
    const labels = { exact: [cur, cur], percent: ['%', '%'], shares: ['shares', 'shares'], adjust: [`+ ${cur}`, `+ ${cur}`] }[m];
    $('#splitInputs').hidden = !labels;
    if (labels) {
      $('#v1l').textContent = `${name(1)} (${labels[0]})`;
      $('#v2l').textContent = `${name(2)} (${labels[1]})`;
    }
    preview();
  };
  const preview = () => {
    const r = computeSplit(readForm());
    const el = $('#preview');
    if (r.error) { el.innerHTML = `<span class="muted">${esc(r.error)}</span>`; return; }
    const cur = $('#cur').value;
    const n = net1({ kind, ...r });
    const shareWord = kind === 'income' ? 'gets' : 'share';
    el.innerHTML = `${esc(name(1))} ${shareWord}: <b>${fmt(r.share1, cur)}</b> · ${esc(name(2))} ${shareWord}: <b>${fmt(r.share2, cur)}</b><br>
      ${n === 0 ? '<span class="muted">No one owes anything (personal)</span>'
        : `→ <b class="${(n > 0) === (S.me === 1) ? 'pos' : 'neg'}">${esc(name(n > 0 ? 2 : 1))} owes ${esc(name(n > 0 ? 1 : 2))} ${fmt(Math.abs(n), cur)}</b>`}`;
  };
  const readForm = () => ({
    kind, amount: toMinor($('#amt').value, $('#cur').value), currency: $('#cur').value,
    method: $('#method').value, paidMode, v1: $('#v1').value, v2: $('#v2').value, p1: $('#p1').value, p2: $('#p2').value,
  });
  // Fill sensible defaults whenever the split method changes.
  const defaultsFor = (m) => {
    const f = readForm();
    const half = Number.isFinite(f.amount) ? toMajorStr(Math.floor(f.amount / 2), f.currency) : '';
    const rest = Number.isFinite(f.amount) ? toMajorStr(f.amount - Math.floor(f.amount / 2), f.currency) : '';
    const d = { exact: [half, rest], percent: ['50', '50'], shares: ['1', '1'], adjust: ['0', '0'] }[m];
    if (d) { $('#v1').value = d[0]; $('#v2').value = d[1]; }
  };
  // For exact amounts and percentages, typing one side fills in the other.
  const complement = (src, dst, isPaid) => {
    const f = readForm();
    const m = isPaid ? 'exact' : f.method;
    const v = $(src).value;
    if (m === 'percent') { const n = parseFloat(v); if (Number.isFinite(n)) $(dst).value = String(+(100 - n).toFixed(4)); }
    else if (m === 'exact' && Number.isFinite(f.amount)) { const c = toMinor(v, f.currency); if (Number.isFinite(c)) $(dst).value = toMajorStr(f.amount - c, f.currency); }
  };

  $$('#kindSeg button').forEach((b) => (b.onclick = () => {
    if (kind === b.dataset.k) return;
    kind = b.dataset.k;
    $('#cat').innerHTML = catOptions(kind, kind === 'income' ? 'Salary' : 'General');
    sync();
  }));
  $$('#paidSeg button').forEach((b) => (b.onclick = () => {
    paidMode = b.dataset.p;
    if (paidMode === 'both' && !$('#p1').value) {
      const f = readForm();
      if (Number.isFinite(f.amount)) { $('#p1').value = toMajorStr(Math.floor(f.amount / 2), f.currency); $('#p2').value = toMajorStr(f.amount - Math.floor(f.amount / 2), f.currency); }
    }
    sync();
  }));
  $('#method').onchange = () => { defaultsFor($('#method').value); sync(); };
  $('#v1').oninput = () => { complement('#v1', '#v2'); preview(); };
  $('#v2').oninput = () => { complement('#v2', '#v1'); preview(); };
  $('#p1').oninput = () => { complement('#p1', '#p2', true); preview(); };
  $('#p2').oninput = () => { complement('#p2', '#p1', true); preview(); };
  $('#amt').oninput = preview;
  $('#cur').onchange = sync;
  $('#cancelBtn').onclick = () => modal.close();
  form.onsubmit = (e) => { e.preventDefault(); $('#saveBtn').click(); };

  $('#saveBtn').onclick = async () => {
    const f = readForm();
    const r = computeSplit(f);
    const err = $('#formErr');
    if (!$('#desc').value.trim()) return (err.textContent = 'Please enter a description.');
    if (r.error) return (err.textContent = r.error);
    const body = {
      kind, description: $('#desc').value, amount: f.amount, currency: f.currency, date: $('#date').value,
      category: $('#cat').value, group_id: $('#group').value || null, notes: $('#notes').value, ...r,
      split: { method: f.method, paidMode, v1: f.v1, v2: f.v2, p1: f.p1, p2: f.p2 },
      repeat: $('#repeat').value, apply_to_future: $('#applyFuture')?.checked || false,
    };
    // Don't create a recurrence when editing a non-recurring item... unless the user chose Repeat on a new one.
    if (existing && !existing.recurring_id) delete body.repeat;
    $('#saveBtn').disabled = true;
    try {
      let id = existing?.id;
      if (existing) await api(`/transactions/${id}`, { method: 'PUT', body });
      else id = (await api('/transactions', { method: 'POST', body })).id;
      const file = $('#receipt')?.files?.[0];
      if (file) await uploadReceipt(id, file);
      modal.close();
      toast(existing ? 'Saved' : kind === 'income' ? 'Income added' : 'Expense added');
      await load();
    } catch (e2) {
      err.textContent = e2.message;
      $('#saveBtn').disabled = false;
    }
  };
  sync();
  if (!existing) setTimeout(() => $('#desc').focus(), 50);
}

// Turns form inputs into {paid1, paid2, share1, share2} in minor units, or {error}.
function computeSplit(f) {
  const A = f.amount;
  if (!Number.isFinite(A) || A <= 0) return { error: 'Enter an amount to see the split.' };
  let paid1, paid2;
  if (f.paidMode === 'u1') [paid1, paid2] = [A, 0];
  else if (f.paidMode === 'u2') [paid1, paid2] = [0, A];
  else {
    paid1 = toMinor(f.p1, f.currency); paid2 = toMinor(f.p2, f.currency);
    if (!Number.isFinite(paid1) || !Number.isFinite(paid2) || paid1 < 0 || paid2 < 0) return { error: 'Enter how much each person paid.' };
    if (paid1 + paid2 !== A) return { error: `Paid amounts add up to ${fmt(paid1 + paid2, f.currency)}, not ${fmt(A, f.currency)}.` };
  }
  let s1;
  const n1 = parseFloat(f.v1), n2 = parseFloat(f.v2);
  switch (f.method) {
    case 'equal': {
      // Odd cent goes to whoever didn't pay (or user 2), like rounding in the payer's favour.
      const lo = Math.floor(A / 2);
      s1 = A % 2 && paid1 >= paid2 ? lo : A - lo;
      break;
    }
    case 'exact': {
      const a = toMinor(f.v1, f.currency), b = toMinor(f.v2, f.currency);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return { error: 'Enter each person\'s amount.' };
      if (a + b !== A) return { error: `Amounts add up to ${fmt(a + b, f.currency)}, not ${fmt(A, f.currency)}.` };
      s1 = a; break;
    }
    case 'percent':
      if (!Number.isFinite(n1) || !Number.isFinite(n2) || n1 < 0 || n2 < 0) return { error: 'Enter percentages.' };
      if (Math.abs(n1 + n2 - 100) > 0.001) return { error: `Percentages add up to ${+(n1 + n2).toFixed(3)}%, not 100%.` };
      s1 = Math.round((A * n1) / 100); break;
    case 'shares':
      if (!Number.isFinite(n1) || !Number.isFinite(n2) || n1 < 0 || n2 < 0 || n1 + n2 <= 0) return { error: 'Enter shares (e.g. 2 and 1).' };
      s1 = Math.round((A * n1) / (n1 + n2)); break;
    case 'adjust': {
      const a = toMinor(f.v1 || 0, f.currency), b = toMinor(f.v2 || 0, f.currency);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return { error: 'Enter adjustments (extra amount for each person).' };
      if (a + b > A) return { error: 'Adjustments are larger than the total.' };
      s1 = a + Math.floor((A - a - b) / 2); break;
    }
    case 'only1': s1 = A; break;
    case 'only2': s1 = 0; break;
    default: return { error: 'Choose a split method.' };
  }
  return { paid1, paid2, share1: s1, share2: A - s1 };
}

async function uploadReceipt(id, file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.8, data;
  do { data = c.toDataURL('image/jpeg', q); q -= 0.1; } while (data.length > 880_000 && q > 0.2);
  await api(`/transactions/${id}/receipt`, { method: 'PUT', body: { mime: 'image/jpeg', data: data.split(',')[1] } });
}

// ---------- settle up ----------
function openSettle(currency) {
  const bal = balances();
  const cur = currency || Object.entries(bal).find(([, v]) => v)?.[0] || S.settings.default_currency;
  const v = bal[cur] || 0;
  // Default direction: whoever owes pays.
  let from = v < 0 ? S.me : v > 0 ? other() : S.me;
  openModal('Settle up', `
    <p class="muted small" style="margin-top:12px">Record a payment between you (cash, bank transfer, Venmo…). Current balance: ${balanceText(v, cur)}</p>
    <div class="seg" id="dirSeg">
      <button type="button" data-from="1">${esc(name(1))} → ${esc(name(2))}</button>
      <button type="button" data-from="2">${esc(name(2))} → ${esc(name(1))}</button>
    </div>
    <div class="grid3">
      <div><label class="f" for="sAmt">Amount</label><input type="text" inputmode="decimal" id="sAmt" value="${v ? toMajorStr(Math.abs(v), cur) : ''}"></div>
      <div><label class="f" for="sCur">Currency</label><select id="sCur">${[...new Set([cur, ...Object.keys(bal), ...CURRENCIES])].map((c) => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    </div>
    <label class="f" for="sDate">Date</label><input type="date" id="sDate" value="${S.today}">
    <label class="f" for="sNotes">Notes</label><input type="text" id="sNotes" placeholder="e.g. Venmo">
    <div class="err" id="sErr"></div>`,
    `<button class="btn" id="sCancel">Cancel</button><button class="btn primary" id="sSave">Record payment</button>`);
  const sync = () => $$('#dirSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.from) === from));
  $$('#dirSeg button').forEach((b) => (b.onclick = () => { from = Number(b.dataset.from); sync(); }));
  $('#sCur').onchange = () => { const nb = balances()[$('#sCur').value] || 0; $('#sAmt').value = nb ? toMajorStr(Math.abs(nb), $('#sCur').value) : ''; };
  sync();
  $('#sCancel').onclick = () => modal.close();
  $('#sSave').onclick = async () => {
    const c = $('#sCur').value;
    const amount = toMinor($('#sAmt').value, c);
    if (!Number.isFinite(amount) || amount <= 0) return ($('#sErr').textContent = 'Enter an amount.');
    const to = from === 1 ? 2 : 1;
    try {
      await api('/transactions', { method: 'POST', body: {
        kind: 'payment', description: `${name(from)} paid ${name(to)}`, amount, currency: c, date: $('#sDate').value,
        category: 'Payment', notes: $('#sNotes').value,
        paid1: from === 1 ? amount : 0, paid2: from === 2 ? amount : 0, share1: to === 1 ? amount : 0, share2: to === 2 ? amount : 0,
      } });
      modal.close(); toast('Payment recorded'); load();
    } catch (e) { $('#sErr').textContent = e.message; }
  };
}

// ---------- detail ----------
async function openDetail(id) {
  openModal('Details', '<div class="empty">Loading…</div>');
  let t;
  try { t = await api(`/transactions/${id}`); } catch (e) { return openModal('Details', `<div class="err">${esc(e.message)}</div>`); }
  const group = t.group_id && S.groups.find((g) => g.id === t.group_id);
  const rec = t.recurring_id && S.recurring.find((r) => r.id === t.recurring_id);
  const n = net1(t);
  const kindLabel = { expense: 'Expense', income: 'Income', payment: 'Payment' }[t.kind];
  const role = t.kind === 'income' ? ['received', 'is entitled to'] : t.kind === 'payment' ? ['sent', 'received'] : ['paid', 'owes'];
  const methodName = t.split?.method ? (SPLIT_METHODS[t.split.method] || (t.split.method === 'only1' ? `All ${name(1)}` : `All ${name(2)}`)) : null;
  openModal(`${iconFor(t)} ${esc(t.description)}`, `
    <div style="margin-top:12px">
      <div class="balance-big ${t.kind === 'income' ? 'inc' : ''}">${fmt(t.amount, t.currency)}</div>
      <div class="muted small">${kindLabel} · ${fmtDate(t.date, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}${t.deleted_at ? ' · <b class="neg">deleted</b>' : ''}</div>
    </div>
    <div class="card" style="padding:8px 14px">
      ${[1, 2].map((u) => `<div class="kv"><span>${esc(name(u))} ${role[0]}</span><b>${fmt(t['paid' + u], t.currency)}</b></div>`).join('')}
      ${t.kind !== 'payment' ? [1, 2].map((u) => `<div class="kv"><span>${esc(name(u))} ${role[1]}</span><b>${fmt(t['share' + u], t.currency)}</b></div>`).join('') : ''}
      <div class="kv"><span>Result</span><b>${n === 0 ? 'No balance change' : `${esc(name(n > 0 ? 2 : 1))} owes ${esc(name(n > 0 ? 1 : 2))} ${fmt(Math.abs(n), t.currency)}`}</b></div>
      ${t.kind !== 'payment' ? `<div class="kv"><span>Category</span><span>${esc(t.category)}</span></div>` : ''}
      ${methodName ? `<div class="kv"><span>Split</span><span>${esc(methodName)}</span></div>` : ''}
      ${group ? `<div class="kv"><span>Group</span><span>${esc(group.name)}</span></div>` : ''}
      ${rec ? `<div class="kv"><span>Repeats</span><span>${FREQ_LABEL[rec.frequency]}${rec.active ? '' : ' (paused)'}</span></div>` : ''}
      <div class="kv"><span>Added by</span><span>${esc(name(t.created_by))}, ${new Date(t.created_at).toLocaleDateString()}</span></div>
    </div>
    ${t.notes ? `<h2 class="sec">Notes</h2><div style="white-space:pre-wrap">${esc(t.notes)}</div>` : ''}
    <h2 class="sec">Receipt</h2>
    <div class="receipt">${t.has_receipt
      ? `<a href="/api/transactions/${t.id}/receipt" target="_blank"><img src="/api/transactions/${t.id}/receipt?v=${encodeURIComponent(t.updated_at)}" alt="Receipt"></a>
         <div><button class="btn sm danger" id="rmReceipt" style="margin-top:6px">Remove receipt</button></div>`
      : `<input type="file" id="addReceipt" accept="image/*">`}</div>
    <h2 class="sec">Comments</h2>
    ${t.comments.map((c) => `<div class="comment"><div class="small muted">${esc(name(c.user_id))} · ${new Date(c.created_at).toLocaleString()}
      ${c.user_id === S.me ? `<a href="#" data-del-comment="${c.id}" style="float:right">delete</a>` : ''}</div>${esc(c.body)}</div>`).join('') || '<div class="muted small">No comments.</div>'}
    <form id="commentForm" class="row" style="margin-top:8px"><input type="text" id="commentBody" placeholder="Add a comment" maxlength="2000" required><button class="btn sm primary">Post</button></form>
    <h2 class="sec">History</h2>
    ${t.history.map((h) => `<div class="small muted" style="margin:3px 0">${new Date(h.created_at).toLocaleString()} — ${esc(name(h.user_id))}: ${esc(h.summary)}</div>`).join('')}`,
    t.deleted_at
      ? `<button class="btn primary" id="restoreBtn">Restore</button>`
      : `<button class="btn danger" id="delBtn">Delete</button><button class="btn primary" id="editBtn">Edit</button>`);

  const refresh = async () => { await load(); openDetail(id); };
  $('#editBtn') && ($('#editBtn').onclick = () => (t.kind === 'payment' ? editPayment(t) : openForm(t)));
  $('#delBtn') && ($('#delBtn').onclick = async () => {
    if (!confirm('Delete this? You can restore it from More → Recently deleted.')) return;
    await api(`/transactions/${id}`, { method: 'DELETE' }); modal.close(); toast('Deleted'); load();
  });
  $('#restoreBtn') && ($('#restoreBtn').onclick = async () => { await api(`/transactions/${id}/restore`, { method: 'POST' }); toast('Restored'); refresh(); });
  $('#commentForm').onsubmit = async (e) => {
    e.preventDefault();
    await api(`/transactions/${id}/comments`, { method: 'POST', body: { body: $('#commentBody').value } }); refresh();
  };
  $$('[data-del-comment]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); await api(`/comments/${a.dataset.delComment}`, { method: 'DELETE' }); refresh(); }));
  $('#addReceipt') && ($('#addReceipt').onchange = async (e) => {
    try { await uploadReceipt(id, e.target.files[0]); toast('Receipt attached'); refresh(); } catch (err) { toast(err.message); }
  });
  $('#rmReceipt') && ($('#rmReceipt').onclick = async () => { await api(`/transactions/${id}/receipt`, { method: 'DELETE' }); refresh(); });
}

function editPayment(t) {
  const from = t.paid1 ? 1 : 2;
  openModal('Edit payment', `
    <label class="f" for="eAmt">Amount (${t.currency})</label><input type="text" inputmode="decimal" id="eAmt" value="${toMajorStr(t.amount, t.currency)}">
    <label class="f" for="eDate">Date</label><input type="date" id="eDate" value="${t.date}">
    <label class="f" for="eNotes">Notes</label><input type="text" id="eNotes" value="${esc(t.notes)}">
    <p class="muted small">${esc(name(from))} → ${esc(name(from === 1 ? 2 : 1))}. To reverse the direction, delete this and record a new payment.</p>
    <div class="err" id="eErr"></div>`,
    `<button class="btn" id="eCancel">Cancel</button><button class="btn primary" id="eSave">Save</button>`);
  $('#eCancel').onclick = () => openDetail(t.id);
  $('#eSave').onclick = async () => {
    const amount = toMinor($('#eAmt').value, t.currency);
    if (!Number.isFinite(amount) || amount <= 0) return ($('#eErr').textContent = 'Enter an amount.');
    await api(`/transactions/${t.id}`, { method: 'PUT', body: {
      ...t, amount, date: $('#eDate').value, notes: $('#eNotes').value,
      paid1: from === 1 ? amount : 0, paid2: from === 2 ? amount : 0, share1: from === 2 ? amount : 0, share2: from === 1 ? amount : 0,
    } });
    toast('Saved'); await load(); openDetail(t.id);
  };
}

async function openDeleted() {
  const rows = await api('/deleted');
  openModal('Recently deleted', rows.length
    ? `<div class="list" style="margin-top:12px">${rows.map((t) => `<div class="item" style="cursor:default"><div class="ico">${iconFor(t)}</div>
        <div class="grow"><div class="ttl">${esc(t.description)}</div><div class="muted small">${fmt(t.amount, t.currency)} · ${fmtDate(t.date)}</div></div>
        <button class="btn sm" data-restore="${t.id}">Restore</button></div>`).join('')}</div>`
    : '<div class="empty">Nothing deleted.</div>');
  $$('[data-restore]').forEach((b) => (b.onclick = async () => {
    await api(`/transactions/${b.dataset.restore}/restore`, { method: 'POST' }); toast('Restored'); await load(); openDeleted();
  }));
}

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
load().catch(() => {});
// Refresh when coming back to the app, so you see your partner's changes.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S && !modal.open) load().catch(() => {}); });
