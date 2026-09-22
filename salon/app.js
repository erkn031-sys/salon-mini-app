/* ==========================================================
   LUMÉA — Telegram Mini App
   Нативная интеграция: MainButton, BackButton, HapticFeedback,
   themeParams, safe area, CloudStorage, sendData.
   Вне Telegram работает как демо с эмуляцией нижней кнопки.
   ========================================================== */

const tg = window.Telegram && window.Telegram.WebApp;
const inTG = !!(tg && tg.initData !== undefined && tg.platform && tg.platform !== 'unknown');

/* ---------------- НАСТРОЙКИ САЛОНА ----------------
   Всё, что меняется под конкретный салон, собрано здесь.
   Дальше ниже — прайс (SERVICES), мастера (MASTERS), отзывы (REVIEWS). */
const SALON = {
  name: 'LUMÉA',
  tagline: 'Салон красоты · демо',
  city: 'Город',
  since: '20XX',
  address: 'Город, улица, дом',
  hours: 'Пн–Сб 10–21 · Вс 11–19',
  phone: '+7 000 000 00 00',
  email: 'mail@example.com',
  adminLink: 'https://t.me/telegram',   // ссылка на чат администратора
  openHour: 10, closeHour: 21,          // сетка слотов записи
};

/* ---------------- данные ---------------- */
const SERVICES = [
  { id: 'cut-woman', cat: 'hair',  name: 'Женская стрижка', desc: 'Диагностика формы, стрижка и укладка с термозащитой.', price: 18000, min: 90 },
  { id: 'cut-man',   cat: 'hair',  name: 'Мужская стрижка',  desc: 'Классика или фейд, оформление бороды по желанию.', price: 12000, min: 60 },
  { id: 'style',     cat: 'hair',  name: 'Вечерняя укладка', desc: 'Голливудская волна, локоны или гладкий пучок.', price: 15000, min: 75 },
  { id: 'care',      cat: 'hair',  name: 'Ритуал ухода', desc: 'Молекулярное восстановление, 4 фазы, массаж головы.', price: 26000, min: 90 },
  { id: 'balayage',  cat: 'color', name: 'Балаяж / AirTouch', desc: 'Сложное окрашивание с мягкими переходами и тонированием.', price: 72000, min: 240 },
  { id: 'root',      cat: 'color', name: 'Окрашивание корней', desc: 'Тон в тон, безаммиачный состав, уход после процедуры.', price: 24000, min: 120 },
  { id: 'gloss',     cat: 'color', name: 'Глянцевое тонирование', desc: 'Зеркальный блеск и выравнивание оттенка на 4–6 недель.', price: 19000, min: 75 },
  { id: 'mani',      cat: 'nails', name: 'Комбинированный маникюр', desc: 'Аппарат и ножницы, питание кутикулы, гель-лак.', price: 16000, min: 105 },
  { id: 'pedi',      cat: 'nails', name: 'Педикюр SPA', desc: 'Ванна с солями, пилинг, полировка и покрытие.', price: 20000, min: 105 },
  { id: 'design',    cat: 'nails', name: 'Дизайн ногтей', desc: 'Френч, градиент, инкрустация — по 5 ногтям.', price: 6000, min: 30 },
  { id: 'brows',     cat: 'face',  name: 'Архитектура бровей', desc: 'Коррекция, окрашивание краской или хной, ламинирование.', price: 11000, min: 60 },
  { id: 'lashes',    cat: 'face',  name: 'Ламинирование ресниц', desc: 'Изгиб, питание кератином и лёгкое тонирование.', price: 14000, min: 75 },
  { id: 'makeup',    cat: 'face',  name: 'Макияж вечерний', desc: 'Люминайзинг-база, стойкие пигменты, схема на вечер.', price: 22000, min: 90 },
  { id: 'facial',    cat: 'face',  name: 'Уход за лицом «Сияние»', desc: 'Чистка, энзимный пилинг, альгинатная маска.', price: 28000, min: 90 },
];
const MASTERS = [
  { id: 'm1', name: 'Мастер 1', role: 'Стилист-парикмахер', bio: 'Здесь будет описание мастера: опыт, техники, обучение.', photo: 'img/master1.jpg', skills: ['hair', 'color'] },
  { id: 'm2', name: 'Мастер 2', role: 'Колорист', bio: 'Здесь будет описание мастера: направления работы и специализация.', photo: 'img/master2.jpg', skills: ['color', 'hair', 'nails'] },
  { id: 'm3', name: 'Мастер 3', role: 'Визажист, бровист', bio: 'Здесь будет описание мастера: услуги и подход к работе.', photo: 'img/master3.jpg', skills: ['face', 'nails'] },
];
const REVIEWS = [
  { text: 'Здесь будет отзыв гостя — две-три строки живого текста о визите.', name: 'Гость 1', meta: 'Услуга · месяц' },
  { text: 'Место для отзыва: что понравилось в сервисе и результате.', name: 'Гость 2', meta: 'Услуга · месяц' },
  { text: 'Отзыв подставляется из вашей базы или админ-панели салона.', name: 'Гость 3', meta: 'Услуга · месяц' },
  { text: 'Короткая цитата гостя — до 120 символов, чтобы карточка держала форму.', name: 'Гость 4', meta: 'Услуга · месяц' },
];
const CAT = { hair: 'волосы', color: 'окрашивание', nails: 'ногти', face: 'лицо и брови' };

const state = { view: 'home', step: 1, picked: new Set(), master: null, date: null, slot: null, filter: 'all', visits: [] };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = n => n.toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₸';
const dur = m => (m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}` : `${m} мин`);
const CHECK = `<svg viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------------- подстановка настроек в разметку ---------------- */
function applyConfig() {
  const set = (sel, val) => { const el = document.querySelector(sel); if (el) el.textContent = val; };
  set('.wordmark', SALON.name);
  set('#hello', SALON.tagline);
  set('#eyebrow', `${SALON.city} · с ${SALON.since}`);
  set('#infoAddress', SALON.address);
  set('#infoHours', SALON.hours);
  set('#infoPhone', SALON.phone);
  set('#infoEmail', SALON.email);
  document.title = `${SALON.name} — запись онлайн`;
}
applyConfig();

/* ---------------- Telegram: тема, хаптика, кнопки ---------------- */
/* высота эмулированной кнопки: в Telegram место занимает нативная MainButton */
document.documentElement.style.setProperty('--mainbtn-h', inTG ? '0px' : '78px');

function applyScheme() {
  const scheme = inTG ? (tg.colorScheme || 'dark') : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.scheme = scheme;
  if (!inTG) return;
  const bg = scheme === 'light' ? '#2B2420' : '#0C0B0A';
  const bar = scheme === 'light' ? '#352D27' : '#151211';
  try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); } catch (e) {}
  try { tg.setBottomBarColor(bar); } catch (e) {}
}
const haptic = {
  tap:  () => { try { inTG && tg.HapticFeedback.impactOccurred('light'); } catch (e) {} },
  pick: () => { try { inTG && tg.HapticFeedback.selectionChanged(); } catch (e) {} },
  ok:   () => { try { inTG && tg.HapticFeedback.notificationOccurred('success'); } catch (e) {} },
  err:  () => { try { inTG && tg.HapticFeedback.notificationOccurred('error'); } catch (e) {} },
};

const fakeMain = $('#mainbtn'), fakeMainBtn = $('#mainbtnBtn'), fakeMainText = $('#mainbtnText');
let mainAction = null;
function setMain({ text, visible = true, active = true, action = null }) {
  mainAction = action;
  if (inTG) {
    const mb = tg.MainButton;
    if (!visible) { mb.hide(); return; }
    mb.setParams({ text, is_active: active, is_visible: true });
    active ? mb.enable() : mb.disable();
    return;
  }
  fakeMain.hidden = !visible;
  fakeMainText.textContent = text || '';
  fakeMainBtn.disabled = !active;
}
function fireMain() { if (mainAction) mainAction(); }
if (inTG) tg.MainButton.onClick(fireMain);
fakeMainBtn.addEventListener('click', fireMain);

function setBack(on) {
  if (!inTG) { $('#fakeBack').hidden = !(on && state.view === 'book'); return; }
  on ? tg.BackButton.show() : tg.BackButton.hide();
}

/* ---------------- навигация ---------------- */
function go(view, { silent } = {}) {
  state.view = view;
  $$('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === view));
  $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.go === view));
  window.scrollTo({ top: 0, behavior: silent ? 'auto' : 'smooth' });
  if (view === 'visits') renderVisits();
  syncChrome();
  if (!silent) haptic.tap();
}
function back() {
  if (state.view === 'book' && state.step > 1) { state.step--; renderStep(); return; }
  if (state.view !== 'home') { go('home'); return; }
  if (inTG) tg.close();
}
if (inTG) tg.BackButton.onClick(back);
$('#btnBack').addEventListener('click', back);
$$('[data-go]').forEach(el => el.addEventListener('click', () => go(el.dataset.go)));

/* нижняя кнопка и BackButton зависят от экрана и шага */
function syncChrome() {
  setBack(state.view !== 'home' || state.step > 1);
  const { items, sum } = totals();
  if (state.view === 'book') {
    const ok = stepValid();
    const labels = {
      1: items.length ? `Далее · ${money(sum)}` : 'Выберите услуги',
      2: 'Далее — выбрать время',
      3: 'Далее — контакты',
      4: `Подтвердить · ${money(sum)}`,
    };
    setMain({ text: labels[state.step], active: ok, action: nextStep });
  } else if (state.view === 'services') {
    setMain({ text: items.length ? `В запись · ${money(sum)}` : 'Отметьте услуги', active: items.length > 0, action: () => { go('book'); state.step = 1; renderStep(); } });
  } else if (state.view === 'team') {
    setMain({ text: 'Записаться', action: () => go('book') });
  } else if (state.view === 'visits') {
    setMain({ text: 'Новая запись', action: () => go('book') });
  } else {
    setMain({ text: items.length ? `Продолжить запись · ${money(sum)}` : 'Записаться онлайн', action: () => go('book') });
  }
  $('#tabDot').hidden = items.length === 0;
}

/* ---------------- услуги ---------------- */
function rowService(s, on) {
  return `<button class="row${on ? ' is-on' : ''}" type="button" data-toggle="${s.id}">
    <span class="row__mark">${CHECK}</span>
    <span class="row__body"><span class="row__title">${s.name}</span><span class="row__sub">${dur(s.min)} · ${CAT[s.cat]}</span></span>
    <span class="row__price">${money(s.price)}</span>
  </button>`;
}
function renderServices() {
  const list = SERVICES.filter(s => state.filter === 'all' || s.cat === state.filter);
  $('#serviceList').innerHTML = list.map(s => rowService(s, state.picked.has(s.id))).join('');
  $('#pickServices').innerHTML = SERVICES.map(s => rowService(s, state.picked.has(s.id))).join('');
}
$('#filters').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $$('#filters .chip').forEach(x => x.classList.toggle('is-active', x === c));
  state.filter = c.dataset.filter; haptic.pick(); renderServices();
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-toggle]'); if (!b) return;
  const id = b.dataset.toggle;
  state.picked.has(id) ? state.picked.delete(id) : state.picked.add(id);
  if (state.master && state.master !== 'any' && !fits(state.master)) { state.master = null; state.slot = null; }
  haptic.pick();
  renderServices(); renderMasters(); renderCart(); syncChrome();
});

/* ---------------- мастера ---------------- */
$('#teamList').innerHTML = MASTERS.map(m => `
  <article class="member">
    <img src="${m.photo}" alt="${m.name}, ${m.role}" loading="lazy" />
    <div class="member__txt">
      <h3 class="member__name">${m.name}</h3>
      <p class="member__role">${m.role}</p>
      <p class="member__bio">${m.bio}</p>
      <div class="member__tags">${m.skills.map(s => `<span class="tag">${CAT[s]}</span>`).join('')}</div>
    </div>
  </article>`).join('');

const fits = id => {
  const m = MASTERS.find(x => x.id === id);
  return [...state.picked].every(i => m.skills.includes(SERVICES.find(s => s.id === i).cat));
};
function renderMasters() {
  const rows = MASTERS.map(m => {
    const ok = state.picked.size === 0 || fits(m.id);
    return `<button class="row${state.master === m.id ? ' is-on' : ''}" type="button" data-master="${m.id}" ${ok ? '' : 'disabled'}>
      <img class="row__ava" src="${m.photo}" alt="" />
      <span class="row__body"><span class="row__title">${m.name}</span><span class="row__sub">${ok ? m.role : 'не выполняет выбранные услуги'}</span></span>
      <span class="row__mark">${CHECK}</span>
    </button>`;
  }).join('');
  $('#pickMasters').innerHTML = rows + `
    <button class="row${state.master === 'any' ? ' is-on' : ''}" type="button" data-master="any">
      <span class="row__ava row__ava--fallback">L</span>
      <span class="row__body"><span class="row__title">Доверяю координатору</span><span class="row__sub">Подберём свободного мастера</span></span>
      <span class="row__mark">${CHECK}</span>
    </button>`;
}
$('#pickMasters').addEventListener('click', e => {
  const b = e.target.closest('[data-master]'); if (!b || b.disabled) return;
  state.master = b.dataset.master; state.slot = null;
  haptic.pick(); renderMasters(); renderSlots(); renderCart(); syncChrome();
});

/* ---------------- дата и время ---------------- */
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; });
const dkey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 9973; return h; };
const TIMES = (() => { const t = [], last = SALON.closeHour - 1; for (let h = SALON.openHour; h <= last; h++) { t.push(`${h}:00`); if (h < last) t.push(`${h}:30`); } return t; })();
const busy = (dateKey, master, i) => (hash(dateKey + (master || 'any')) + i * 7) % 10 < 4;

$('#dates').innerHTML = days.map((d, i) => `
  <button class="date" type="button" data-date="${dkey(d)}">
    <span class="date__dow">${i === 0 ? 'сег' : DOW[d.getDay()]}</span>
    <span class="date__num">${d.getDate()}</span>
    <span class="date__mon">${MON[d.getMonth()]}</span>
  </button>`).join('');
$('#dates').addEventListener('click', e => {
  const b = e.target.closest('[data-date]'); if (!b) return;
  state.date = b.dataset.date; state.slot = null;
  $$('#dates .date').forEach(x => x.classList.toggle('is-on', x === b));
  haptic.pick(); renderSlots(); renderCart(); syncChrome();
});
function renderSlots() {
  if (!state.date) { $('#slots').innerHTML = `<p class="sub" style="grid-column:1/-1;margin:0">Сначала выберите день.</p>`; return; }
  $('#slots').innerHTML = TIMES.map((t, i) =>
    `<button class="slot${state.slot === t ? ' is-on' : ''}" type="button" data-slot="${t}" ${busy(state.date, state.master, i) ? 'disabled' : ''}>${t}</button>`).join('');
}
$('#slots').addEventListener('click', e => {
  const b = e.target.closest('[data-slot]'); if (!b || b.disabled) return;
  state.slot = b.dataset.slot;
  $$('#slots .slot').forEach(x => x.classList.toggle('is-on', x === b));
  haptic.pick(); renderCart(); syncChrome();
});

/* быстрые окна на главной */
function renderToday() {
  const k = dkey(days[0]);
  const free = TIMES.filter((t, i) => !busy(k, null, i)).slice(0, 6);
  $('#todaySlots').innerHTML = free.map(t => `<button class="chip chip--slot" type="button" data-quick="${t}">${t}</button>`).join('');
}
$('#todaySlots').addEventListener('click', e => {
  const b = e.target.closest('[data-quick]'); if (!b) return;
  state.date = dkey(days[0]); state.slot = b.dataset.quick;
  $$('#dates .date').forEach(x => x.classList.toggle('is-on', x.dataset.date === state.date));
  renderSlots(); renderCart();
  go('book'); state.step = state.picked.size ? 2 : 1; renderStep();
});

/* ---------------- смета ---------------- */
function totals() {
  const items = [...state.picked].map(id => SERVICES.find(s => s.id === id));
  return { items, sum: items.reduce((a, s) => a + s.price, 0), min: items.reduce((a, s) => a + s.min, 0) };
}
const masterName = () => state.master ? (state.master === 'any' ? 'Подберёт координатор' : MASTERS.find(m => m.id === state.master).name) : null;
function whenLabel() {
  if (!state.date) return null;
  const d = new Date(state.date + 'T00:00:00');
  return `${d.getDate()} ${MONF[d.getMonth()]}, ${DOW[d.getDay()]}${state.slot ? ' · ' + state.slot : ''}`;
}
let shown = 0;
function renderCart() {
  const { items, sum, min } = totals();
  $('#cartEmpty').hidden = items.length > 0;
  $('#cartList').innerHTML = items.map(s => `<li><span>${s.name}</span><strong>${money(s.price)}</strong></li>`).join('');
  const meta = [];
  if (min) meta.push(`<div>Длительность: <b>${dur(min)}</b></div>`);
  if (masterName()) meta.push(`<div>Мастер: <b>${masterName()}</b></div>`);
  if (whenLabel()) meta.push(`<div>Визит: <b>${whenLabel()}</b></div>`);
  $('#cartMeta').innerHTML = meta.join('');
  const el = $('#cartTotal'), from = shown, t0 = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - t0) / 420), e = 1 - Math.pow(1 - p, 3);
    el.textContent = money(Math.round(from + (sum - from) * e));
    p < 1 ? requestAnimationFrame(tick) : (shown = sum);
  };
  requestAnimationFrame(tick);
}

/* ---------------- шаги ---------------- */
function stepValid() {
  if (state.view !== 'book') return true;
  if (state.step === 1) return state.picked.size > 0;
  if (state.step === 2) return !!state.master;
  if (state.step === 3) return !!(state.date && state.slot);
  return true;
}
function renderStep() {
  $$('.step').forEach(s => { s.hidden = Number(s.dataset.step) !== state.step; });
  $$('#steps li').forEach((li, i) => {
    li.classList.toggle('is-now', i + 1 === state.step);
    li.classList.toggle('is-done', i + 1 < state.step);
  });
  syncChrome();
}
function nextStep() {
  if (state.step < 4) {
    if (!stepValid()) { haptic.err(); return; }
    state.step++; haptic.tap(); renderStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (!validate()) { haptic.err(); return; }
  submit();
}

/* ---------------- форма ---------------- */
function showErr(id, on) {
  const p = $(`.err[data-for="${id}"]`); if (p) p.hidden = !on;
  const f = $(`#${id}`).closest('.field'); if (f) f.classList.toggle('bad', on);
}
function validate() {
  const name = $('#fName').value.trim();
  const digits = $('#fPhone').value.replace(/\D/g, '');
  const okN = name.length >= 2, okP = digits.length === 11 && digits.startsWith('7');
  showErr('fName', !okN); showErr('fPhone', !okP);
  if (!okN) $('#fName').focus(); else if (!okP) $('#fPhone').focus();
  return okN && okP;
}
$('#fPhone').addEventListener('input', e => {
  let d = e.target.value.replace(/\D/g, '');
  if (d.startsWith('8')) d = '7' + d.slice(1);
  if (!d.startsWith('7')) d = '7' + d;
  d = d.slice(0, 11);
  let v = '+7';
  if (d.length > 1) v += ' (' + d.slice(1, 4);
  if (d.length >= 4) v += ') ' + d.slice(4, 7);
  if (d.length >= 7) v += ' ' + d.slice(7, 9);
  if (d.length >= 9) v += ' ' + d.slice(9, 11);
  e.target.value = v;
});
['fName', 'fPhone'].forEach(id => $(`#${id}`).addEventListener('input', () => showErr(id, false)));

/* ---------------- отправка ---------------- */
function submit() {
  const { items, sum, min } = totals();
  const visit = {
    id: Date.now(), when: whenLabel(), date: state.date, slot: state.slot,
    master: masterName(), services: items.map(s => s.name), sum, min,
    name: $('#fName').value.trim(), phone: $('#fPhone').value, note: $('#fNote').value.trim(),
  };
  state.visits.unshift(visit);
  saveVisits();

  // отправляем заявку боту (доступно при запуске из keyboard-кнопки)
  if (inTG) {
    try { tg.MainButton.showProgress(true); } catch (e) {}
    try {
      tg.sendData(JSON.stringify({ type: 'booking', ...visit }));
    } catch (e) { /* запуск не из keyboard-кнопки — остаёмся в приложении */ }
    try { tg.MainButton.hideProgress(); } catch (e) {}
  }

  haptic.ok();
  $('#sheetLede').textContent = `${visit.name}, мы придержали для вас время. Напоминание придёт в этот чат за два часа до визита.`;
  $('#sheetList').innerHTML = [
    ['Визит', visit.when], ['Мастер', visit.master],
    ['Услуги', visit.services.join(', ')], ['Длительность', dur(min)], ['Сумма', money(sum)],
  ].map(([k, v]) => `<li><span>${k}</span><strong>${v}</strong></li>`).join('');
  $('#sheet').hidden = false;
  sparkle();
  setMain({ visible: false });
}
function sparkle() {
  const box = $('.sparkle'); box.innerHTML = '';
  for (let i = 0; i < 20; i++) {
    const s = document.createElement('i');
    const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 130;
    s.style.setProperty('--dx', `${Math.cos(a) * r}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * r}px`);
    s.style.animationDelay = `${Math.random() * 240}ms`;
    box.appendChild(s);
  }
}
$('#sheet').addEventListener('click', e => {
  if (!e.target.closest('[data-close]')) return;
  $('#sheet').hidden = true;
  state.picked.clear(); state.master = null; state.date = null; state.slot = null; state.step = 1;
  $('#form').reset();
  $$('#dates .date').forEach(x => x.classList.remove('is-on'));
  renderServices(); renderMasters(); renderSlots(); renderCart(); renderStep();
  go('visits');
});

/* ---------------- CloudStorage ---------------- */
function saveVisits() {
  if (inTG && tg.CloudStorage) {
    try { tg.CloudStorage.setItem('visits', JSON.stringify(state.visits.slice(0, 10)), () => {}); } catch (e) {}
  }
}
function loadVisits(done) {
  if (inTG && tg.CloudStorage) {
    try {
      tg.CloudStorage.getItem('visits', (err, val) => {
        if (!err && val) { try { state.visits = JSON.parse(val) || []; } catch (e) {} }
        done();
      });
      return;
    } catch (e) {}
  }
  done();
}
function renderVisits() {
  const wrap = $('#visitsWrap');
  if (!state.visits.length) {
    wrap.innerHTML = `<div class="empty">
      <svg viewBox="0 0 48 48" fill="none"><path d="M24 8c3.6 6.2 8.2 10.8 15.5 14.2C32.2 25.6 27.6 30.2 24 36.4 20.4 30.2 15.8 25.6 8.5 22.2 15.8 18.8 20.4 14.2 24 8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      <p>Здесь появятся ваши визиты. Первый шаг — выбрать услугу.</p>
    </div>`;
    return;
  }
  wrap.innerHTML = state.visits.map(v => `
    <article class="visit" data-id="${v.id}">
      <p class="visit__when">${v.when}</p>
      <p class="visit__who">${v.master}</p>
      <p class="visit__srv">${v.services.join(' · ')}</p>
      <p class="visit__sum">${dur(v.min)} · ${money(v.sum)}</p>
      <div class="visit__acts">
        <button class="btn btn--ghost btn--sm" type="button" data-repeat="${v.id}">Повторить</button>
        <button class="btn btn--quiet btn--sm" type="button" data-cancel="${v.id}">Отменить</button>
      </div>
    </article>`).join('');
}

/* повтор и отмена визита */
$('#visitsWrap').addEventListener('click', e => {
  const rep = e.target.closest('[data-repeat]');
  const can = e.target.closest('[data-cancel]');
  if (rep) {
    const v = state.visits.find(x => String(x.id) === rep.dataset.repeat);
    if (!v) return;
    state.picked = new Set(v.services.map(n => (SERVICES.find(s => s.name === n) || {}).id).filter(Boolean));
    state.master = (MASTERS.find(m => m.name === v.master) || {}).id || null;
    state.date = null; state.slot = null; state.step = 3;
    haptic.tap();
    renderServices(); renderMasters(); renderSlots(); renderCart(); renderStep();
    go('book');
    return;
  }
  if (can) {
    const id = can.dataset.cancel;
    const drop = () => {
      state.visits = state.visits.filter(x => String(x.id) !== id);
      saveVisits(); renderVisits(); haptic.tap();
    };
    if (inTG && tg.showConfirm) { try { return tg.showConfirm('Отменить эту запись?', ok => ok && drop()); } catch (e) {} }
    drop();
  }
});

/* ---------------- отзывы ---------------- */
$('#reviewRail').innerHTML = REVIEWS.map(r => `
  <blockquote class="quote"><p>«${r.text}»</p><footer><b>${r.name}</b>${r.meta}</footer></blockquote>`).join('');

/* ---------------- связь с администратором ---------------- */
$('#writeAdmin').addEventListener('click', () => {
  haptic.tap();
  const link = SALON.adminLink;
  if (inTG) { try { tg.openTelegramLink(link); return; } catch (e) {} }
  window.open(link, '_blank', 'noopener');
});

/* ---------------- запуск ---------------- */
function init() {
  applyScheme();
  if (inTG) {
    tg.ready();
    tg.expand();
    try { tg.disableVerticalSwipes(); } catch (e) {}
    try { tg.enableClosingConfirmation(); } catch (e) {}
    tg.onEvent('themeChanged', applyScheme);
    tg.onEvent('safeAreaChanged', () => {});
    const u = tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (u && u.first_name) $('#hello').textContent = `${u.first_name}, добрый день`;
  } else {
    $('#notice').hidden = false;
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyScheme);
  }
  renderServices(); renderMasters(); renderSlots(); renderToday(); renderCart(); renderStep();
  loadVisits(() => { renderVisits(); });
  go('home', { silent: true });
}
init();
