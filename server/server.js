const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': process.env.FRONT_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'content-type,x-init-data',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: require('ws') },
});
const SALON_ID = process.env.SALON_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const TZ = '+05:00', OPEN = 10, CLOSE = 21, STEP = 30;
const ACTIVE = ['pending', 'confirmed'];
const CRON_SECRET = process.env.CRON_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
const APP_URL = process.env.FRONT_ORIGIN;
const HOOK_SECRET = BOT_TOKEN ? crypto.createHash('sha256').update('hook:' + BOT_TOKEN).digest('hex').slice(0, 48) : '';

/* ---------------- Telegram Bot API ---------------- */
async function tg(method, body) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) console.warn('tg', method, j.description);
    return j.ok ? j.result : null;
  } catch (e) { console.warn('tg', method, e.message); return null; }
}
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmtWhen = iso => new Date(iso).toLocaleString('ru-RU', {
  timeZone: 'Asia/Almaty', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});
const fmtMoney = n => Number(n || 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₸';
const STATUS = { pending: 'ожидает подтверждения', confirmed: 'подтверждена', cancelled: 'отменена', done: 'завершена' };

async function salon() {
  const { data } = await db.from('salons').select('id,name,owner_tg_id').eq('id', SALON_ID).maybeSingle();
  return data || {};
}
/* полная карточка записи: клиент, мастер, услуги */
async function bookingCard(id) {
  const { data: b } = await db.from('bookings')
    .select('id,start_at,end_at,status,service_ids,total_price,phone,note,master_id,client_id,admin_msg_id')
    .eq('id', id).eq('salon_id', SALON_ID).maybeSingle();
  if (!b) return null;
  const [{ data: cl }, { data: ms }, { data: sv }] = await Promise.all([
    db.from('clients').select('tg_id,first_name').eq('id', b.client_id).maybeSingle(),
    db.from('masters').select('name,tg_id').eq('id', b.master_id).maybeSingle(),
    db.from('services').select('id,name').in('id', b.service_ids || []),
  ]);
  b.client = cl || {}; b.master = ms || {};
  b.services = (b.service_ids || []).map(i => (sv || []).find(x => x.id === i)?.name).filter(Boolean);
  return b;
}
function adminText(b, title = 'Новая запись') {
  return [
    `<b>${title}</b>`,
    `${esc(fmtWhen(b.start_at))} · ${(new Date(b.end_at) - new Date(b.start_at)) / 60000} мин`,
    `Мастер: ${esc(b.master.name)}`,
    `Услуги: ${esc(b.services.join(', '))}`,
    `Сумма: ${fmtMoney(b.total_price)}`,
    `Клиент: ${esc(b.client.first_name)}, <code>${esc(b.phone)}</code>`,
    b.note ? `Комментарий: ${esc(b.note)}` : null,
    `Статус: <b>${STATUS[b.status] || b.status}</b>`,
  ].filter(Boolean).join('\n');
}
const adminKb = b => (ACTIVE.includes(b.status) ? { inline_keyboard: [[
  ...(b.status === 'pending' ? [{ text: 'Подтвердить', callback_data: `a:ok:${b.id}` }] : []),
  { text: 'Отменить', callback_data: `a:no:${b.id}` },
]] } : { inline_keyboard: [] });

/* разослать администратору и мастеру */
async function notifyStaff(b, title) {
  const s = await salon();
  const text = adminText(b, title);
  const ids = [...new Set([s.owner_tg_id, b.master.tg_id].filter(Boolean).map(String))];
  for (const chat_id of ids) {
    const m = await tg('sendMessage', { chat_id, text, parse_mode: 'HTML', reply_markup: adminKb(b) });
    if (m && String(chat_id) === String(s.owner_tg_id) && title === 'Новая запись')
      await db.from('bookings').update({ admin_msg_id: m.message_id }).eq('id', b.id);
  }
}
/* обновить исходное сообщение администратору (статус и кнопки) */
async function refreshAdminMsg(b) {
  const s = await salon();
  if (!s.owner_tg_id || !b.admin_msg_id) return;
  await tg('editMessageText', { chat_id: s.owner_tg_id, message_id: b.admin_msg_id,
    text: adminText(b), parse_mode: 'HTML', reply_markup: adminKb(b) });
}
const clientKb = b => ({ inline_keyboard: [[
  ...(b.status === 'pending' ? [{ text: 'Приду', callback_data: `c:ok:${b.id}` }] : []),
  { text: 'Отменить запись', callback_data: `c:no:${b.id}` },
]] });
function clientText(b, head) {
  return [`<b>${head}</b>`, esc(fmtWhen(b.start_at)), `Мастер: ${esc(b.master.name)}`,
    `Услуги: ${esc(b.services.join(', '))}`, `Сумма: ${fmtMoney(b.total_price)}`].join('\n');
}
async function notifyClient(b, head, withKb = false) {
  if (!b.client.tg_id) return;
  await tg('sendMessage', { chat_id: b.client.tg_id, text: clientText(b, head), parse_mode: 'HTML',
    ...(withKb ? { reply_markup: clientKb(b) } : {}) });
}
async function setStatus(id, status) {
  const { data } = await db.from('bookings').update({ status })
    .eq('id', id).eq('salon_id', SALON_ID).in('status', ACTIVE).select('id');
  return !!(data && data.length);
}

function auth(req, res, next) {
  const initData = req.get('x-init-data');
  if (!initData) return res.status(401).json({ error: 'no auth' });
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  p.delete('hash');
  const str = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
  if (calc !== hash) return res.status(401).json({ error: 'bad auth' });
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400)
    return res.status(401).json({ error: 'expired' });
  req.tgUser = JSON.parse(p.get('user'));
  next();
}

let cache = { t: 0 };
async function catalog() {
  if (Date.now() - cache.t < 30000) return cache;
  const [s, m] = await Promise.all([
    db.from('services').select('*').eq('salon_id', SALON_ID).eq('active', true).order('sort'),
    db.from('masters').select('*').eq('salon_id', SALON_ID).eq('active', true).order('sort'),
  ]);
  cache = { t: Date.now(), services: s.data || [], masters: m.data || [] };
  return cache;
}

function resolve(cat, slugs, masterSlug) {
  const svcs = slugs.map(s => cat.services.find(x => x.slug === s));
  if (svcs.some(x => !x)) return null;
  const cats = svcs.map(x => x.cat);
  let ms = cat.masters.filter(m => cats.every(c => (m.skills || []).includes(c)));
  if (masterSlug !== 'any') ms = ms.filter(m => m.slug === masterSlug);
  return {
    svcs, ms,
    min: svcs.length ? svcs.reduce((a, s) => a + s.duration_min, 0) : 60,
    sum: svcs.reduce((a, s) => a + s.price, 0),
  };
}

const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

app.get('/api/health', (_, res) => res.send('ok'));

app.get('/api/catalog', async (_, res) => {
  const c = await catalog();
  res.json({
    services: c.services.map(s => ({ id: s.slug, cat: s.cat, name: s.name, desc: s.description, price: s.price, min: s.duration_min })),
    masters: c.masters.map(m => ({ id: m.slug, name: m.name, role: m.role, bio: m.bio, photo: m.photo_url, skills: m.skills || [] })),
  });
});

app.get('/api/slots', async (req, res) => {
  const { date, master = 'any' } = req.query;
  const slugs = String(req.query.services || '').split(',').filter(Boolean);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'bad date' });

  const r = resolve(await catalog(), slugs, master);
  if (!r || !r.ms.length) return res.json([]);

  const dayStart = new Date(`${date}T00:00:00${TZ}`);
  const dayEnd = new Date(dayStart.getTime() + 864e5);
  const { data: busy } = await db.from('bookings')
    .select('master_id,start_at,end_at')
    .in('master_id', r.ms.map(m => m.id))
    .in('status', ACTIVE)
    .lt('start_at', dayEnd.toISOString())
    .gt('end_at', dayStart.toISOString());

  const out = [], now = Date.now();
  for (let m = OPEN * 60; m + r.min <= CLOSE * 60; m += STEP) {
    const s = new Date(dayStart.getTime() + m * 60000);
    const e = new Date(s.getTime() + r.min * 60000);
    if (s.getTime() < now) continue;
    const free = r.ms.some(ms => !(busy || []).some(b =>
      b.master_id === ms.id && new Date(b.start_at) < e && new Date(b.end_at) > s));
    if (free) out.push({ time: hhmm(m), start_at: s.toISOString() });
  }
  res.json(out);
});

app.post('/api/bookings', auth, async (req, res) => {
  const { services = [], master = 'any', start_at, name, phone, note } = req.body || {};
  const start = new Date(start_at);
  if (isNaN(start) || start.getTime() < Date.now() || !services.length)
    return res.status(400).json({ error: 'bad params' });

  const r = resolve(await catalog(), services, master);
  if (!r || !r.ms.length) return res.status(400).json({ error: 'bad params' });

  const local = new Date(start.getTime() + 5 * 3600e3);
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (mins < OPEN * 60 || mins + r.min > CLOSE * 60 || mins % STEP)
    return res.status(400).json({ error: 'bad time' });

  const nm = String(name || '').trim().slice(0, 60);
  const ph = String(phone || '').replace(/[^\d+]/g, '').slice(0, 16);
  if (nm.length < 2 || ph.length < 11) return res.status(400).json({ error: 'bad contact' });

  const { data: client, error: ce } = await db.from('clients')
    .upsert({ salon_id: SALON_ID, tg_id: req.tgUser.id, first_name: nm, phone: ph },
            { onConflict: 'salon_id,tg_id' })
    .select().single();
  if (ce) { console.error(ce); return res.status(500).json({ error: 'fail' }); }

  const end = new Date(start.getTime() + r.min * 60000);
  for (const m of r.ms) {
    const { data, error } = await db.from('bookings').insert({
      salon_id: SALON_ID, master_id: m.id, client_id: client.id,
      service_id: r.svcs[0].id, service_ids: r.svcs.map(s => s.id),
      total_price: r.sum, phone: ph, note: String(note || '').slice(0, 300),
      start_at: start.toISOString(), end_at: end.toISOString(),
    }).select().single();
    if (!error) {
      res.json({ id: data.id, master: m.name, start_at: data.start_at, min: r.min, sum: r.sum });
      bookingCard(data.id).then(b => b && Promise.all([
        notifyStaff(b, 'Новая запись'),
        notifyClient(b, 'Вы записаны', true),
      ])).catch(e => console.warn('notify', e));
      return;
    }
    if (error.code !== '23P01') { console.error(error); return res.status(500).json({ error: 'fail' }); }
  }
  res.status(409).json({ error: 'slot_taken' });
});

async function clientOf(req) {
  const { data } = await db.from('clients').select('id')
    .eq('salon_id', SALON_ID).eq('tg_id', req.tgUser.id).maybeSingle();
  return data;
}

app.get('/api/my-bookings', auth, async (req, res) => {
  const client = await clientOf(req);
  if (!client) return res.json([]);
  const { data } = await db.from('bookings')
    .select('id,start_at,end_at,status,service_ids,total_price,master_id')
    .eq('client_id', client.id).in('status', ACTIVE)
    .order('start_at', { ascending: false }).limit(20);
  const c = await catalog();
  res.json((data || []).map(b => ({
    id: b.id, start_at: b.start_at, status: b.status, sum: b.total_price,
    min: (new Date(b.end_at) - new Date(b.start_at)) / 60000,
    master: (c.masters.find(m => m.id === b.master_id) || {}).name,
    services: (b.service_ids || []).map(id => (c.services.find(s => s.id === id) || {}).name).filter(Boolean),
  })));
});

app.post('/api/bookings/:id/cancel', auth, async (req, res) => {
  const client = await clientOf(req);
  if (!client) return res.status(404).json({ error: 'not_found' });
  const { data, error } = await db.from('bookings').update({ status: 'cancelled' })
    .eq('id', req.params.id).eq('client_id', client.id).in('status', ACTIVE).select();
  if (error || !data || !data.length) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
  bookingCard(req.params.id).then(b => b && Promise.all([
    notifyStaff(b, 'Клиент отменил запись'), refreshAdminMsg(b),
  ])).catch(e => console.warn('notify', e));
});

/* ---------------- webhook бота: кнопки и команды ---------------- */
app.post('/api/tg', async (req, res) => {
  if (!HOOK_SECRET || req.get('x-telegram-bot-api-secret-token') !== HOOK_SECRET) return res.sendStatus(401);
  res.sendStatus(200);
  try { await onUpdate(req.body || {}); } catch (e) { console.error('update', e); }
});

async function onUpdate(u) {
  const s = await salon();
  if (u.message && u.message.text) {
    const chat = u.message.chat.id, text = u.message.text.trim();
    const isAdmin = String(chat) === String(s.owner_tg_id);
    if (/^\/today|^\/tomorrow/.test(text) && isAdmin) return sendDay(chat, text.startsWith('/tomorrow') ? 1 : 0);
    if (/^\/id/.test(text)) return tg('sendMessage', { chat_id: chat, text: `Ваш Telegram ID: <code>${chat}</code>`, parse_mode: 'HTML' });
    return tg('sendMessage', { chat_id: chat,
      text: `Добро пожаловать в ${esc(s.name || 'салон')}. Запишитесь онлайн — выберите услугу, мастера и удобное время.` +
        (isAdmin ? '\n\nДля администратора: /today — записи на сегодня, /tomorrow — на завтра.' : ''),
      reply_markup: APP_URL ? { inline_keyboard: [[{ text: 'Записаться', web_app: { url: APP_URL } }]] } : undefined });
  }
  const q = u.callback_query;
  if (!q || !q.data) return;
  const [who, act, id] = q.data.split(':');
  const b = await bookingCard(id);
  const answer = text => tg('answerCallbackQuery', { callback_query_id: q.id, text });
  if (!b) return answer('Запись не найдена');
  const from = String(q.from.id);

  if (who === 'a') {
    const allowed = from === String(s.owner_tg_id) || from === String(b.master.tg_id || '');
    if (!allowed) return answer('Нет доступа');
    if (!ACTIVE.includes(b.status)) return answer('Запись уже ' + (STATUS[b.status] || b.status));
    const status = act === 'ok' ? 'confirmed' : 'cancelled';
    if (!(await setStatus(id, status))) return answer('Не удалось обновить');
    b.status = status;
    await tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id,
      text: adminText(b), parse_mode: 'HTML', reply_markup: adminKb(b) });
    await notifyClient(b, status === 'confirmed' ? 'Запись подтверждена' : 'Запись отменена салоном', status === 'confirmed');
    return answer(status === 'confirmed' ? 'Подтверждено' : 'Отменено');
  }
  if (who === 'c') {
    if (from !== String(b.client.tg_id)) return answer('Нет доступа');
    if (!ACTIVE.includes(b.status)) return answer('Запись уже ' + (STATUS[b.status] || b.status));
    if (act === 'ok') {
      if (b.status === 'pending' && await setStatus(id, 'confirmed')) b.status = 'confirmed';
      await tg('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: clientKb(b) });
      await refreshAdminMsg(b);
      await notifyStaff(b, 'Клиент подтвердил визит');
      return answer('Спасибо, ждём вас');
    }
    if (!(await setStatus(id, 'cancelled'))) return answer('Не удалось отменить');
    b.status = 'cancelled';
    await tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id,
      text: clientText(b, 'Запись отменена'), parse_mode: 'HTML' });
    await refreshAdminMsg(b);
    await notifyStaff(b, 'Клиент отменил запись');
    return answer('Запись отменена');
  }
}

async function sendDay(chat, plus) {
  const now = new Date(Date.now() + 5 * 3600e3);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + plus) - 5 * 3600e3);
  const { data } = await db.from('bookings').select('id').eq('salon_id', SALON_ID).in('status', ACTIVE)
    .gte('start_at', day.toISOString()).lt('start_at', new Date(day.getTime() + 864e5).toISOString()).order('start_at');
  const list = (await Promise.all((data || []).map(x => bookingCard(x.id)))).filter(Boolean);
  const title = plus ? 'Записи на завтра' : 'Записи на сегодня';
  if (!list.length) return tg('sendMessage', { chat_id: chat, text: `${title}: нет.` });
  const rows = list.map(b => `${new Date(b.start_at).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' })} — ` +
    `${esc(b.client.first_name)} (<code>${esc(b.phone)}</code>), ${esc(b.master.name)}: ${esc(b.services.join(', '))}` +
    (b.status === 'pending' ? ' · не подтверждена' : ''));
  return tg('sendMessage', { chat_id: chat, text: `<b>${title}</b>\n` + rows.join('\n'), parse_mode: 'HTML' });
}

/* ---------------- напоминания (вызывается pg_cron каждые 10 минут) ---------------- */
let ticking = false;
app.post('/api/cron/tick', async (req, res) => {
  if (!CRON_SECRET || req.get('x-cron-secret') !== CRON_SECRET) return res.sendStatus(401);
  if (ticking) return res.json({ busy: true });
  ticking = true;
  try { res.json(await reminders()); } catch (e) { console.error('cron', e); res.status(500).json({ error: 'fail' }); }
  finally { ticking = false; }
});

async function reminders() {
  const now = Date.now(), H = 3600e3;
  const { data } = await db.from('bookings')
    .select('id,start_at,created_at,reminded_24h_at,reminded_2h_at')
    .eq('salon_id', SALON_ID).in('status', ACTIVE)
    .gt('start_at', new Date(now).toISOString()).lte('start_at', new Date(now + 24 * H).toISOString())
    .or('reminded_24h_at.is.null,reminded_2h_at.is.null');
  let sent = 0;
  for (const r of data || []) {
    const start = new Date(r.start_at).getTime(), lead = start - new Date(r.created_at).getTime();
    let kind = null;
    if (!r.reminded_2h_at && start - now <= 2 * H) kind = lead > 3 * H ? '2h' : 'skip2';
    else if (!r.reminded_24h_at && start - now > 2 * H) kind = lead > 26 * H ? '24h' : 'skip24';
    if (!kind) continue;
    const col = kind.endsWith('2') || kind === '2h' ? 'reminded_2h_at' : 'reminded_24h_at';
    const patch = { [col]: new Date().toISOString() };
    if (col === 'reminded_2h_at' && !r.reminded_24h_at) patch.reminded_24h_at = patch[col];
    const { data: upd } = await db.from('bookings').update(patch).eq('id', r.id).is(col, null).select('id');
    if (!upd || !upd.length || kind.startsWith('skip')) continue;
    const b = await bookingCard(r.id);
    if (!b) continue;
    await notifyClient(b, kind === '24h' ? 'Напоминаем: завтра у вас визит' : 'Напоминаем: визит через 2 часа', true);
    sent++;
  }
  return { ok: true, checked: (data || []).length, sent };
}

app.listen(process.env.PORT || 3000, async () => {
  if (!BOT_TOKEN || !PUBLIC_URL) return;
  await tg('setWebhook', { url: `${PUBLIC_URL}/api/tg`, secret_token: HOOK_SECRET,
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
  await tg('setMyCommands', { commands: [{ command: 'start', description: 'Записаться' }] });
  const s = await salon();
  if (s.owner_tg_id) await tg('setMyCommands', { scope: { type: 'chat', chat_id: s.owner_tg_id }, commands: [
    { command: 'start', description: 'Записаться' },
    { command: 'today', description: 'Записи на сегодня' },
    { command: 'tomorrow', description: 'Записи на завтра' },
  ] });
  console.log('webhook set');
});
