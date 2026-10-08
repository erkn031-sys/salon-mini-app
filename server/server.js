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

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const SALON_ID = process.env.SALON_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const TZ = '+05:00', OPEN = 10, CLOSE = 21, STEP = 30;
const ACTIVE = ['pending', 'confirmed'];

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
    if (!error) return res.json({ id: data.id, master: m.name, start_at: data.start_at, min: r.min, sum: r.sum });
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
});

app.listen(process.env.PORT || 3000);
