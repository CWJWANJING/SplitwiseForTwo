// SplitPair API — Cloudflare Worker + D1.
// Everything under /api/* is handled here; all other paths are static files from ./public.

const SESSION_DAYS = 90;
const KINDS = ['expense', 'income', 'payment'];
const FREQS = ['weekly', 'biweekly', 'monthly', 'yearly'];
const enc = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

const minorDigits = (cur) => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; }
  catch { return 2; }
};
const toMajor = (c, cur) => c / 10 ** minorDigits(cur);
const money = (c, cur) => `${toMajor(c, cur).toFixed(minorDigits(cur))} ${cur}`;
const nowISO = () => new Date().toISOString();
const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(new Date());

// ---------- auth ----------
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function getCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
async function currentUser(req, env) {
  const raw = getCookie(req, 'sp_session');
  if (!raw) return null;
  const [uid, exp, sig] = raw.split('.');
  if (!uid || !exp || !sig || Number(exp) < Date.now()) return null;
  const expected = await hmac(env.SESSION_SECRET, `${uid}.${exp}`);
  if (!safeEqual(sig, expected)) return null;
  return uid === '1' || uid === '2' ? Number(uid) : null;
}
async function login(req, env) {
  const { user, password } = await req.json();
  if (![1, 2].includes(user) || typeof password !== 'string') throw new HttpError(400, 'Bad request');
  const since = Date.now() - 15 * 60 * 1000;
  const fails = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE at > ?').bind(since).first('n');
  if (fails >= 10) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const expectedPw = user === 1 ? env.USER1_PASSWORD : env.USER2_PASSWORD;
  if (!expectedPw || !env.SESSION_SECRET) throw new HttpError(500, 'Server secrets are not configured');
  // Compare HMACs so the comparison is constant-time regardless of length.
  const ok = safeEqual(await hmac(env.SESSION_SECRET, password), await hmac(env.SESSION_SECRET, expectedPw));
  if (!ok) {
    await env.DB.prepare('INSERT INTO login_failures (at) VALUES (?)').bind(Date.now()).run();
    throw new HttpError(401, 'Wrong password');
  }
  await env.DB.prepare('DELETE FROM login_failures WHERE at < ?').bind(since).run();
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const value = `${user}.${exp}.${await hmac(env.SESSION_SECRET, `${user}.${exp}`)}`;
  return json({ ok: true }, 200, {
    'set-cookie': `sp_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

// ---------- validation ----------
const isInt = (n) => Number.isInteger(n) && n >= 0;
function str(v, max, field, required = false) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`);
  v = v.trim();
  if (required && !v) throw new HttpError(400, `${field} is required`);
  if (v.length > max) throw new HttpError(400, `${field} is too long`);
  return v;
}
function cleanTx(b) {
  if (!KINDS.includes(b.kind)) throw new HttpError(400, 'Invalid kind');
  const t = {
    kind: b.kind,
    description: str(b.description, 200, 'Description', true),
    amount: b.amount,
    currency: str(b.currency, 3, 'Currency', true).toUpperCase(),
    date: str(b.date, 10, 'Date', true),
    category: str(b.category, 40, 'Category') || 'General',
    group_id: b.group_id || null,
    notes: str(b.notes, 2000, 'Notes'),
    paid1: b.paid1, paid2: b.paid2, share1: b.share1, share2: b.share2,
    split: JSON.stringify(b.split || {}),
  };
  if (!Number.isInteger(t.amount) || t.amount <= 0) throw new HttpError(400, 'Amount must be positive');
  if (t.amount > 1e12) throw new HttpError(400, 'Amount too large');
  if (![t.paid1, t.paid2, t.share1, t.share2].every(isInt)) throw new HttpError(400, 'Invalid split');
  if (t.paid1 + t.paid2 !== t.amount) throw new HttpError(400, 'Paid amounts must add up to the total');
  if (t.share1 + t.share2 !== t.amount) throw new HttpError(400, 'Split amounts must add up to the total');
  if (!/^[A-Z]{3}$/.test(t.currency)) throw new HttpError(400, 'Invalid currency');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new HttpError(400, 'Invalid date');
  if (t.split.length > 2000) throw new HttpError(400, 'Split data too large');
  return t;
}

// ---------- recurring ----------
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso, n, anchorDay) {
  const [y, m] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const dim = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(anchorDay, dim)).padStart(2, '0')}`;
}
function advance(iso, freq, anchorDay) {
  if (freq === 'weekly') return addDays(iso, 7);
  if (freq === 'biweekly') return addDays(iso, 14);
  if (freq === 'monthly') return addMonths(iso, 1, anchorDay);
  return addMonths(iso, 12, anchorDay);
}
const TX_COLS = ['id', 'kind', 'description', 'amount', 'currency', 'date', 'category', 'group_id', 'notes',
  'paid1', 'paid2', 'share1', 'share2', 'split', 'recurring_id', 'created_by', 'created_at', 'updated_at'];
function insertTx(env, row) {
  return env.DB.prepare(`INSERT INTO transactions (${TX_COLS.join(',')}) VALUES (${TX_COLS.map(() => '?').join(',')})`)
    .bind(...TX_COLS.map((c) => row[c] ?? null));
}
function logActivity(env, user, action, txId, summary) {
  return env.DB.prepare('INSERT INTO activity (user_id, action, transaction_id, summary, created_at) VALUES (?,?,?,?,?)')
    .bind(user, action, txId, summary, nowISO());
}

async function runRecurring(env) {
  const today = todayIn(env.TIMEZONE);
  const { results } = await env.DB.prepare('SELECT * FROM recurring WHERE active = 1 AND next_date <= ?').bind(today).all();
  for (const r of results) {
    let next = r.next_date;
    for (let guard = 0; next <= today && guard < 120; guard++) {
      const after = advance(next, r.frequency, r.anchor_day);
      // Claim this occurrence first so two concurrent requests can't both create it.
      const claim = await env.DB.prepare('UPDATE recurring SET next_date = ? WHERE id = ? AND next_date = ? AND active = 1')
        .bind(after, r.id, next).run();
      if (claim.meta.changes !== 1) break;
      const tpl = JSON.parse(r.template);
      const id = crypto.randomUUID();
      const ts = nowISO();
      await env.DB.batch([
        insertTx(env, { ...tpl, id, date: next, recurring_id: r.id, created_by: r.created_by, created_at: ts, updated_at: ts }),
        logActivity(env, r.created_by, 'recurring', id, `Recurring: ${tpl.description}`),
      ]);
      next = after;
    }
  }
}

// ---------- handlers ----------
const describe = (t, env) => {
  const names = { 1: env.USER1_NAME || 'User 1', 2: env.USER2_NAME || 'User 2' };
  const amt = money(t.amount, t.currency);
  if (t.kind === 'payment') return `${names[t.paid1 ? 1 : 2]} paid ${names[t.paid1 ? 2 : 1]} ${amt}`;
  return `${t.kind === 'income' ? 'Income' : 'Expense'} "${t.description}" (${amt})`;
};

async function getData(env, user) {
  await runRecurring(env);
  const [tx, groups, recurring, settings] = await env.DB.batch([
    env.DB.prepare(`SELECT t.*, (SELECT COUNT(*) FROM comments c WHERE c.transaction_id = t.id) AS comment_count
                    FROM transactions t WHERE deleted_at IS NULL ORDER BY date DESC, created_at DESC`),
    env.DB.prepare('SELECT * FROM groups ORDER BY archived, name'),
    env.DB.prepare('SELECT * FROM recurring ORDER BY active DESC, next_date'),
    env.DB.prepare('SELECT * FROM settings'),
  ]);
  return {
    me: user,
    users: { 1: env.USER1_NAME || 'User 1', 2: env.USER2_NAME || 'User 2' },
    today: todayIn(env.TIMEZONE),
    transactions: tx.results.map((t) => ({ ...t, split: JSON.parse(t.split || '{}') })),
    groups: groups.results,
    recurring: recurring.results.map((r) => ({ ...r, template: JSON.parse(r.template) })),
    settings: Object.fromEntries(settings.results.map((s) => [s.key, s.value])),
  };
}

async function createTx(req, env, user) {
  const body = await req.json();
  const t = cleanTx(body);
  const ts = nowISO();
  const id = crypto.randomUUID();
  const stmts = [];
  let recurringId = null;
  if (body.repeat && body.repeat !== 'none') {
    if (!FREQS.includes(body.repeat)) throw new HttpError(400, 'Invalid repeat');
    recurringId = crypto.randomUUID();
    const anchor = Number(t.date.slice(8, 10));
    stmts.push(env.DB.prepare('INSERT INTO recurring (id, frequency, anchor_day, next_date, template, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(recurringId, body.repeat, anchor, advance(t.date, body.repeat, anchor), JSON.stringify(t), user, ts));
  }
  stmts.push(insertTx(env, { ...t, id, recurring_id: recurringId, created_by: user, created_at: ts, updated_at: ts }));
  stmts.push(logActivity(env, user, 'create', id, `Added ${describe(t, env)}`));
  await env.DB.batch(stmts);
  // A start date in the past should back-fill the missed occurrences right away.
  if (recurringId) await runRecurring(env);
  return json({ id });
}

async function updateTx(req, env, user, id) {
  const body = await req.json();
  const existing = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first();
  if (!existing) throw new HttpError(404, 'Not found');
  const t = cleanTx(body);
  const stmts = [
    env.DB.prepare(`UPDATE transactions SET kind=?, description=?, amount=?, currency=?, date=?, category=?, group_id=?, notes=?,
      paid1=?, paid2=?, share1=?, share2=?, split=?, updated_at=? WHERE id=?`)
      .bind(t.kind, t.description, t.amount, t.currency, t.date, t.category, t.group_id, t.notes,
        t.paid1, t.paid2, t.share1, t.share2, t.split, nowISO(), id),
    logActivity(env, user, 'update', id, `Edited ${describe(t, env)}`),
  ];
  // Editing a recurring item can also change its future occurrences.
  if (existing.recurring_id && body.repeat) {
    if (body.repeat === 'none') {
      stmts.push(env.DB.prepare('UPDATE recurring SET active = 0 WHERE id = ?').bind(existing.recurring_id));
    } else if (FREQS.includes(body.repeat) && body.apply_to_future) {
      stmts.push(env.DB.prepare('UPDATE recurring SET template = ?, frequency = ?, active = 1 WHERE id = ?')
        .bind(JSON.stringify(t), body.repeat, existing.recurring_id));
    }
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}

async function setDeleted(env, user, id, deleted) {
  const t = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first();
  if (!t) throw new HttpError(404, 'Not found');
  await env.DB.batch([
    env.DB.prepare('UPDATE transactions SET deleted_at = ? WHERE id = ?').bind(deleted ? nowISO() : null, id),
    logActivity(env, user, deleted ? 'delete' : 'restore', id, `${deleted ? 'Deleted' : 'Restored'} ${describe(t, env)}`),
  ]);
  return json({ ok: true });
}

async function getTxDetail(env, id) {
  const t = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first();
  if (!t) throw new HttpError(404, 'Not found');
  const [comments, history] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM comments WHERE transaction_id = ? ORDER BY created_at').bind(id),
    env.DB.prepare('SELECT * FROM activity WHERE transaction_id = ? ORDER BY id DESC').bind(id),
  ]);
  return json({ ...t, split: JSON.parse(t.split || '{}'), comments: comments.results, history: history.results });
}

async function putReceipt(req, env, user, id) {
  const { mime, data } = await req.json();
  if (!/^image\/(jpeg|png|webp)$/.test(mime) || typeof data !== 'string') throw new HttpError(400, 'Invalid image');
  if (data.length > 900_000) throw new HttpError(413, 'Image too large');
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO receipts (transaction_id, mime, data) VALUES (?,?,?)').bind(id, mime, data),
    env.DB.prepare('UPDATE transactions SET has_receipt = 1 WHERE id = ?').bind(id),
    logActivity(env, user, 'receipt', id, 'Attached a receipt'),
  ]);
  return json({ ok: true });
}
async function getReceipt(env, id) {
  const r = await env.DB.prepare('SELECT * FROM receipts WHERE transaction_id = ?').bind(id).first();
  if (!r) throw new HttpError(404, 'No receipt');
  const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { 'content-type': r.mime, 'cache-control': 'private, max-age=86400' } });
}

async function exportCsv(env) {
  const { results } = await env.DB.prepare(`SELECT t.*, g.name AS group_name FROM transactions t
    LEFT JOIN groups g ON g.id = t.group_id WHERE t.deleted_at IS NULL ORDER BY t.date`).all();
  const n1 = env.USER1_NAME || 'User 1', n2 = env.USER2_NAME || 'User 2';
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Date', 'Type', 'Description', 'Category', 'Group', 'Currency', 'Amount',
    `${n1} paid/received`, `${n2} paid/received`, `${n1} share`, `${n2} share`, 'Notes'];
  const lines = [head.map(esc).join(',')];
  for (const t of results) {
    lines.push([t.date, t.kind, t.description, t.category, t.group_name, t.currency, ...[t.amount, t.paid1, t.paid2, t.share1, t.share2].map((c) => toMajor(c, t.currency)), t.notes].map(esc).join(','));
  }
  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="splitpair-${todayIn(env.TIMEZONE)}.csv"` },
  });
}

// ---------- router ----------
async function handleApi(req, env, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const method = req.method;

  if (path === '/login' && method === 'POST') return login(req, env);
  if (path === '/logout' && method === 'POST')
    return json({ ok: true }, 200, { 'set-cookie': 'sp_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
  if (path === '/config' && method === 'GET')
    return json({ users: { 1: env.USER1_NAME || 'User 1', 2: env.USER2_NAME || 'User 2' } });

  const user = await currentUser(req, env);
  if (!user) throw new HttpError(401, 'Not logged in');
  // Cookie is SameSite=Lax; also require a custom header on writes as a CSRF guard.
  if (method !== 'GET' && req.headers.get('x-requested-with') !== 'splitpair') throw new HttpError(403, 'Forbidden');

  let m;
  if (path === '/data' && method === 'GET') return json(await getData(env, user));
  if (path === '/transactions' && method === 'POST') return createTx(req, env, user);
  if ((m = path.match(/^\/transactions\/([\w-]+)$/))) {
    if (method === 'GET') return getTxDetail(env, m[1]);
    if (method === 'PUT') return updateTx(req, env, user, m[1]);
    if (method === 'DELETE') return setDeleted(env, user, m[1], true);
  }
  if ((m = path.match(/^\/transactions\/([\w-]+)\/restore$/)) && method === 'POST') return setDeleted(env, user, m[1], false);
  if ((m = path.match(/^\/transactions\/([\w-]+)\/comments$/)) && method === 'POST') {
    const { body } = await req.json();
    const text = str(body, 2000, 'Comment', true);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO comments (id, transaction_id, user_id, body, created_at) VALUES (?,?,?,?,?)')
        .bind(crypto.randomUUID(), m[1], user, text, nowISO()),
      logActivity(env, user, 'comment', m[1], `Commented: ${text.slice(0, 80)}`),
    ]);
    return json({ ok: true });
  }
  if ((m = path.match(/^\/comments\/([\w-]+)$/)) && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?').bind(m[1], user).run();
    return json({ ok: true });
  }
  if ((m = path.match(/^\/transactions\/([\w-]+)\/receipt$/))) {
    if (method === 'GET') return getReceipt(env, m[1]);
    if (method === 'PUT') return putReceipt(req, env, user, m[1]);
    if (method === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM receipts WHERE transaction_id = ?').bind(m[1]),
        env.DB.prepare('UPDATE transactions SET has_receipt = 0 WHERE id = ?').bind(m[1]),
      ]);
      return json({ ok: true });
    }
  }
  if (path === '/deleted' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM transactions WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200').all();
    return json(results);
  }
  if (path === '/activity' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 200').all();
    return json(results);
  }
  if (path === '/groups' && method === 'POST') {
    const { name } = await req.json();
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO groups (id, name, created_at) VALUES (?,?,?)').bind(id, str(name, 60, 'Name', true), nowISO()).run();
    return json({ id });
  }
  if ((m = path.match(/^\/groups\/([\w-]+)$/)) && method === 'PUT') {
    const { name, archived } = await req.json();
    await env.DB.prepare('UPDATE groups SET name = ?, archived = ? WHERE id = ?').bind(str(name, 60, 'Name', true), archived ? 1 : 0, m[1]).run();
    return json({ ok: true });
  }
  if ((m = path.match(/^\/recurring\/([\w-]+)$/))) {
    if (method === 'PUT') {
      const { active } = await req.json();
      const r = await env.DB.prepare('SELECT * FROM recurring WHERE id = ?').bind(m[1]).first();
      if (!r) throw new HttpError(404, 'Not found');
      // When resuming, skip occurrences missed while paused.
      let next = r.next_date;
      const today = todayIn(env.TIMEZONE);
      if (active) while (next < today) next = advance(next, r.frequency, r.anchor_day);
      await env.DB.prepare('UPDATE recurring SET active = ?, next_date = ? WHERE id = ?').bind(active ? 1 : 0, next, m[1]).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('UPDATE transactions SET recurring_id = NULL WHERE recurring_id = ?').bind(m[1]),
        env.DB.prepare('DELETE FROM recurring WHERE id = ?').bind(m[1]),
      ]);
      return json({ ok: true });
    }
  }
  if (path === '/settings' && method === 'PUT') {
    const { default_currency } = await req.json();
    if (!/^[A-Z]{3}$/.test(default_currency || '')) throw new HttpError(400, 'Invalid currency');
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('default_currency', ?)").bind(default_currency).run();
    return json({ ok: true });
  }
  if (path === '/export.csv' && method === 'GET') return exportCsv(env);

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await handleApi(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof SyntaxError) return json({ error: 'Invalid JSON' }, 400);
      console.error(e);
      return json({ error: 'Server error' }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runRecurring(env));
  },
};
