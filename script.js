// ============ DATA ============
const STORAGE_KEY = 'budgit:v1';
const CAT_COLORS = {'Entertainment':'#ef4444','Music':'#8b5cf6','Software':'#3b82f6','Cloud':'#06b6d4','Fitness':'#10b981','Education':'#f59e0b','News':'#f97316','Other':'#64748b'};
const CATEGORIES = ['Entertainment','Music','Software','Cloud','Fitness','Education','News','Other'];
const INTERVALS = ['Weekly','Monthly','Quarterly','Yearly'];
const INTERVAL_MULT = {'Weekly':52/12,'Monthly':1,'Quarterly':1/3,'Yearly':1/12};

let state = loadState();
let currentTab = 'home';
let wizardStep = 0;
let wizardData = {};
let decideStep = 0;
let decideData = {};
let selectedMonth = new Date().getMonth();
let selectedMonthYear = new Date().getFullYear();

function defaultState() {
  return {
    settings: { currency: 'USD', symbol: '$', budget: null, budgetIncludesSubs: false, dark: false },
    subs: [], assessments: [], savingsGoals: [], savingsEntries: []
  };
}

function loadState() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      if (!parsed.assessments) parsed.assessments = [];
      if (!parsed.savingsGoals) parsed.savingsGoals = [];
      if (!parsed.savingsEntries) parsed.savingsEntries = [];
      return parsed;
    }
  } catch(e) {}
  return defaultState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('Budgit could not save data in this browser:', e);
    showToast('Browser storage is blocked. Your changes may not be saved.');
    return false;
  }
}

// ============ UTILS ============
function fmt(n, sym) {
  sym = sym || state.settings.symbol;
  return sym + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const FX_CACHE = {};
const CURRENCY_SYMBOLS = { USD:'$', ZAR:'R', EUR:'€', GBP:'£' };
async function getFxRate(from, to) {
  if (from === to) return 1;
  const key = from + '_' + to;
  if (FX_CACHE[key] && Date.now() - FX_CACHE[key].at < 6 * 60 * 60 * 1000) return FX_CACHE[key].rate;
  try {
    const response = await fetch('https://api.frankfurter.app/latest?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
    if (!response.ok) throw new Error('FX unavailable');
    const data = await response.json();
    const rate = data.rates && data.rates[to];
    if (!Number.isFinite(rate)) throw new Error('FX rate missing');
    FX_CACHE[key] = { rate, at: Date.now() };
    return rate;
  } catch (e) {
    // Reverse lookup is supported for pairs not quoted directly by the service.
    try {
      const response = await fetch('https://api.frankfurter.app/latest?from=' + encodeURIComponent(to) + '&to=' + encodeURIComponent(from));
      const data = await response.json(), reverse = data.rates && data.rates[from];
      if (Number.isFinite(reverse) && reverse !== 0) { const rate = 1 / reverse; FX_CACHE[key] = { rate, at: Date.now() }; FX_CACHE[to + '_' + from] = { rate: reverse, at: Date.now() }; return rate; }
    } catch (_) {}
    return null;
  }
}
function fmtSubscriptionPrice(sub) {
  const from = sub.currency || state.settings.currency;
  if (from === state.settings.currency) return fmt(Number(sub.price || 0));
  const rate = FX_CACHE[from + '_' + state.settings.currency]?.rate;
  return Number.isFinite(rate) ? fmt(Number(sub.price || 0) * rate) : fmt(Number(sub.price || 0), symFor(from)) + ' ' + from;
}
function monthlyCost(sub) {
  if (sub.status !== 'active') return 0;
  const rate = sub.currency === state.settings.currency ? 1 : FX_CACHE[sub.currency + '_' + state.settings.currency]?.rate;
  if (!Number.isFinite(rate)) return 0;
  return sub.price * (INTERVAL_MULT[sub.interval] || 1) * rate;
}
async function refreshExchangeRates() {
  const target = state.settings.currency;
  const sources = [...new Set(state.subs.map(s => s.currency).filter(c => c && c !== target))];
  await Promise.all(sources.map(c => getFxRate(c, target)));
  render();
}

function nextRenewal(sub) {
  return addIntervals(parseISO(sub.renewalDate), sub.interval, renewalIndex(sub));
}

function daysUntil(date) {
  const now = new Date();
  now.setHours(0,0,0,0);
  const d = toDate(date);
  d.setHours(0,0,0,0);
  return Math.round((d - now) / 86400000);
}

function fmtDate(date) {
  const d = toDate(date);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

function fmtDateFull(date) {
  const d = toDate(date);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function uid() { return 'id_' + Math.random().toString(36).substr(2, 9); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

function getCurrentDateStr() {
  const now = new Date();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ============ ICONS ============
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  chart: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  up: '<path d="M7 17 17 7M7 7h10v10"/>',
  down: '<path d="M7 7l10 10M17 7v10H7"/>'
};
function icon(name, size) {
  size = size || 18;
  return '<svg class="ic" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function symFor(cur) { return ({USD:'$', ZAR:'R', EUR:'€', GBP:'£'})[cur] || '$'; }

// ============ CALENDAR-SAFE DATE MATH ============
// Dates are stored as YYYY-MM-DD and always handled in local time.
function parseISO(s) {
  const p = String(s).slice(0, 10).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
function toISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function toDate(v) { return typeof v === 'string' ? parseISO(v) : new Date(v); }
const MONTHS_PER = { Monthly: 1, Quarterly: 3, Yearly: 12 };
// k-th renewal counted from the anchor date. Month-based intervals keep the original
// day of month and clamp to short months (31 Jan -> 28 Feb -> 31 Mar).
function addIntervals(anchor, interval, k) {
  if (interval === 'Weekly') return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * k);
  const t = new Date(anchor.getFullYear(), anchor.getMonth() + MONTHS_PER[interval] * k, 1);
  const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(anchor.getDate(), dim));
}
function renewalIndex(sub) {
  const a = parseISO(sub.renewalDate), n = new Date();
  n.setHours(0, 0, 0, 0);
  let k = 0;
  while (addIntervals(a, sub.interval, k) < n && k < 5000) k++;
  return k;
}
function renewalsIn(sub, year, month) {
  const a = parseISO(sub.renewalDate), end = new Date(year, month + 1, 1), start = new Date(year, month, 1);
  let n = 0;
  for (let k = 0; k < 5000; k++) {
    const d = addIntervals(a, sub.interval, k);
    if (d >= end) break;
    if (d >= start) n++;
  }
  return n;
}

// ============ CALENDAR PICKER ============
const CAL = {};
const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function calendar(id, value, cb, opts) {
  const v = value ? parseISO(value) : new Date();
  opts = opts || {};
  CAL[id] = { y: v.getFullYear(), m: v.getMonth(), value: value || '', cb: cb, min: opts.min || '', max: opts.max || '' };
  return '<div class="cal" id="cal-' + id + '">' + calInner(id) + '</div>';
}
function calInner(id) {
  const c = CAL[id], first = new Date(c.y, c.m, 1), dim = new Date(c.y, c.m + 1, 0).getDate();
  const today = toISO(new Date());
  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += '<div></div>';
  for (let d = 1; d <= dim; d++) {
    const iso = c.y + '-' + String(c.m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const off = (c.min && iso < c.min) || (c.max && iso > c.max);
    cells += '<button type="button" class="cal-day' + (iso === c.value ? ' sel' : '') + (iso === today ? ' today' : '') + '"' + (off ? ' disabled' : '') + ' onclick="calPick(\'' + id + '\',\'' + iso + '\')">' + d + '</button>';
  }
  return '<div class="cal-head">' +
    '<button type="button" class="cal-nav" onclick="calNav(\'' + id + '\',-1)">' + icon('left', 18) + '</button>' +
    '<div class="cal-title">' + CAL_MONTHS[c.m] + ' ' + c.y + '</div>' +
    '<button type="button" class="cal-nav" onclick="calNav(\'' + id + '\',1)">' + icon('right', 18) + '</button></div>' +
    '<div class="cal-week">' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(w => '<div>' + w + '</div>').join('') + '</div>' +
    '<div class="cal-grid">' + cells + '</div>' +
    '<button type="button" class="cal-today" onclick="calPick(\'' + id + '\',\'' + today + '\');">Jump to today</button>';
}
function calNav(id, delta) {
  const c = CAL[id], d = new Date(c.y, c.m + delta, 1);
  c.y = d.getFullYear(); c.m = d.getMonth();
  document.getElementById('cal-' + id).innerHTML = calInner(id);
}
function calPick(id, iso) {
  const c = CAL[id], d = parseISO(iso);
  c.value = iso; c.y = d.getFullYear(); c.m = d.getMonth();
  document.getElementById('cal-' + id).innerHTML = calInner(id);
  window[c.cb](iso);
}

// ============ SUBSCRIPTION FILES (IndexedDB, stays on this device) ============
function fileDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('budgit-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function fileTx(mode, fn) {
  const db = await fileDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', mode), req = fn(tx.objectStore('files'));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
const filePut = (id, blob) => fileTx('readwrite', s => s.put(blob, id));
const fileGet = id => fileTx('readonly', s => s.get(id));
const fileDel = id => fileTx('readwrite', s => s.delete(id));
const fileClear = () => fileTx('readwrite', s => s.clear());
function fmtSize(b) { return b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }

async function addSubFiles(id, input) {
  const sub = state.subs.find(s => s.id === id);
  if (!sub) return;
  sub.files = sub.files || [];
  for (const f of Array.from(input.files)) {
    if (f.size > 10 * 1024 * 1024) { showToast(f.name + ' is over 10 MB'); continue; }
    const fid = uid();
    try {
      await filePut(fid, f);
      sub.files.push({ id: fid, name: f.name, type: f.type || '', size: f.size, added: toISO(new Date()) });
    } catch (e) { showToast('Could not store ' + f.name); }
  }
  input.value = '';
  saveState();
  openDetail(id);
}
async function openSubFile(subId, fid) {
  const w = window.open('', '_blank');
  let blob = null;
  try { blob = await fileGet(fid); } catch (e) {}
  if (!blob) { if (w) w.close(); showToast('File not found'); return; }
  const url = URL.createObjectURL(blob);
  if (w) { w.location = url; }
  else {
    const a = document.createElement('a');
    a.href = url; a.download = ((state.subs.find(s => s.id === subId) || {}).files || []).filter(f => f.id === fid).map(f => f.name)[0] || 'file';
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function removeSubFile(subId, fid) {
  if (!confirm('Remove this file from the subscription?')) return;
  const sub = state.subs.find(s => s.id === subId);
  if (!sub) return;
  sub.files = (sub.files || []).filter(f => f.id !== fid);
  try { await fileDel(fid); } catch (e) {}
  saveState();
  openDetail(subId);
}

// ============ NAVIGATION ============
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (navItem) navItem.classList.add('active');
  document.getElementById('fab').style.display = (tab === 'home' || tab === 'subs') ? 'flex' : 'none';
  render();
  // A reminder is app-wide, not tied to the Savings tab.
  checkSavingsReminders();
}

// ============ RENDER ============
function render() {
  renderHome();
  renderSubs();
  renderDecide();
  renderInsights();
  renderSettings();
  renderSavings();
}

function renderHome() {
  // Set date
  document.getElementById('current-date').textContent = getCurrentDateStr();
  document.getElementById('greeting-text').textContent = getGreeting();
  updatePeriodLabel();

  const search = (document.getElementById('home-search')?.value || '').toLowerCase();
  const activeSubs = state.subs.filter(s => s.status === 'active');
  const filteredSubs = search ? activeSubs.filter(s => s.name.toLowerCase().includes(search)) : activeSubs;
  const monthlyTotal = filteredSubs.reduce((sum, s) => sum + monthlyCost(s), 0);
  
  document.getElementById('overview-amount').innerHTML = fmt(monthlyTotal).replace(/(\d+)(\.\d+)/, '$1<span class="cents">$2</span>');
  document.getElementById('overview-sub').textContent = 'per month in recurring subscriptions';
  document.getElementById('stat-active').textContent = activeSubs.length;
  
  // Upcoming bills in 30 days
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  let billsIn30 = 0;
  activeSubs.forEach(s => {
    const nr = nextRenewal(s);
    if (nr <= in30) billsIn30++;
  });
  document.getElementById('stat-bills').textContent = billsIn30;

  // Payments scroll
  const upcoming = activeSubs.map(s => ({ sub: s, date: nextRenewal(s) }))
    .sort((a, b) => a.date - b.date)
    .slice(0, 8);
  
  const ps = document.getElementById('payments-scroll');
  if (upcoming.length === 0) {
    document.getElementById('upcoming-section').style.display = 'block';
    ps.innerHTML = `<div class="empty-text">No upcoming payments yet. Add a subscription to see renewals here.</div>`;
  } else {
    document.getElementById('upcoming-section').style.display = 'block';
    ps.innerHTML = upcoming.map(({ sub, date }) => {
      const days = daysUntil(date);
      const dueSoon = days <= 7;
      const logoColor = CAT_COLORS[sub.category] || '#64748b';
      return `
        <div class="payment-card ${dueSoon ? 'due-soon' : ''}" onclick="openDetail('${sub.id}')">
          ${dueSoon ? '<div class="due-tag">DUE SOON</div>' : ''}
          ${logoMarkup(sub, 'payment-icon')}
          <div class="payment-name">${sub.name}</div>
          <div class="payment-price">${fmtSubscriptionPrice(sub)}</div>
          <div class="payment-date">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            ${fmtDate(date)} · ${days}d
          </div>
        </div>
      `;
    }).join('');
  }

  // Subscriptions list
  const tl = document.getElementById('tx-list');
  if (filteredSubs.length === 0) {
    document.getElementById('tx-section').style.display = 'block';
    tl.innerHTML = `<div class="empty-text">No transactions yet. Add a subscription to see its upcoming billing activity here.</div>`;
  } else {
    document.getElementById('tx-section').style.display = 'block';
    tl.innerHTML = filteredSubs.slice().sort((a, b) => nextRenewal(a) - nextRenewal(b)).slice(0, 4).map(s => {
      const logoColor = CAT_COLORS[s.category] || '#64748b';
      const nr = nextRenewal(s);
      return `
        <div class="tx-item" onclick="openDetail('${s.id}')">
          ${logoMarkup(s, 'tx-icon')}
          <div class="tx-info">
            <div class="tx-name">${s.name}</div>
            <div class="tx-meta">${fmtSubscriptionPrice(s)} / ${s.interval.toLowerCase()} · Renews ${fmtDate(nr)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Month chips
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const mc = document.getElementById('month-chips');
  mc.innerHTML = months.map((m, i) => {
    const count = activeSubs.reduce((n, s) => n + renewalsIn(s, currentYear, i), 0);
    const isActive = i === selectedMonth;
    return `
      <div class="month-chip ${isActive ? 'active' : ''}" onclick="selectMonthChip(${i})">
        ${count > 0 && !isActive ? `<div class="m-badge">${count}</div>` : ''}
        <div class="m-name">${m}</div>
        ${count > 0 ? `<div class="m-count">${count}</div>` : ''}
      </div>
    `;
  }).join('');

  // Pending decisions
  const pending = state.assessments.filter(a => a.status === 'waiting');
  const ps2 = document.getElementById('pending-section');
  const pl = document.getElementById('pending-list');
  if (pending.length > 0) {
    ps2.style.display = 'block';
    pl.innerHTML = pending.map(a => {
      const hoursLeft = Math.max(0, Math.round((a.due - Date.now()) / 3600000));
      return `
        <div class="assessment-item" onclick="openAssessment('${a.id}')">
          <div class="assessment-top">
            <div class="assessment-name">${a.product}</div>
            <div class="assessment-status waiting">${hoursLeft}h left</div>
          </div>
          <div class="assessment-price">${fmt(a.price)}</div>
          <div class="assessment-rec">${a.recTitle}</div>
        </div>
      `;
    }).join('');
  } else {
    ps2.style.display = 'none';
  }
}

function renderSubs() {
  const search = (document.getElementById('sub-search')?.value || '').toLowerCase();
  let subs = state.subs.filter(s => s.name.toLowerCase().includes(search));
  
  const sl = document.getElementById('sub-list');
  if (subs.length === 0) {
    sl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${icon('clipboard', 36)}</div>
        <div class="empty-title">No subscriptions yet</div>
        <div class="empty-text">Add your first subscription to start tracking your recurring costs.</div>
        <button class="btn btn-primary" onclick="openAddSub()" style="max-width:200px;margin:0 auto">Add subscription</button>
      </div>
    `;
    return;
  }
  
  sl.innerHTML = subs.map(s => {
    const logoColor = CAT_COLORS[s.category] || '#64748b';
    const hasIncrease = s.priceHistory && s.priceHistory.some(h => h.reason === 'provider');
    const nr = nextRenewal(s);
    const days = daysUntil(nr);
    return `
      <div class="sub-item" onclick="openDetail('${s.id}')">
        ${logoMarkup(s)}
        <div class="sub-info">
          <div class="sub-name">${s.name} ${hasIncrease ? '<span class="tag increase">Price increased</span>' : ''} ${s.status !== 'active' ? `<span class="tag ${s.status}">${s.status}</span>` : ''}</div>
          <div class="sub-meta">${s.category} · Renews ${fmtDate(nr)}${days <= 7 && s.status === 'active' ? ' · <span style="color:var(--warning);font-weight:600">Soon</span>' : ''}</div>
        </div>
        <div class="sub-price">
          <div class="sub-price-val">${fmtSubscriptionPrice(s)}</div>
          <div class="sub-price-int">per ${s.interval.toLowerCase().replace('ly','')}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderDecide() {
  const al = document.getElementById('assessment-list');
  if (state.assessments.length === 0) {
    al.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${icon('help', 36)}</div>
        <div class="empty-title">No assessments yet</div>
        <div class="empty-text">Start your first purchase assessment to make more thoughtful buying decisions.</div>
      </div>
    `;
    return;
  }
  al.innerHTML = state.assessments.slice().reverse().map(a => {
    const statusClass = a.status === 'waiting' ? 'waiting' : 'done';
    const statusText = a.status === 'waiting' ? 'Waiting' : a.outcome === 'purchased' ? 'Purchased' : a.outcome === 'skipped' ? 'Skipped' : a.outcome === 'saving' ? 'Saving' : 'Done';
    return `
      <div class="assessment-item" onclick="openAssessment('${a.id}')">
        <div class="assessment-top">
          <div class="assessment-name">${a.product}</div>
          <div class="assessment-status ${statusClass}">${statusText}</div>
        </div>
        <div class="assessment-price">${fmt(a.price)}</div>
        <div class="assessment-rec">${a.recTitle}</div>
      </div>
    `;
  }).join('');
}

function evaluateSubscription(id) {
  const sub = state.subs.find(s => s.id === id);
  if (!sub) return;
  const monthly = monthlyCost(sub), yearly = monthly * 12;
  const history = sub.priceHistory || [];
  const increases = history.filter(h => h.reason === 'provider' && Number(h.newPrice) > Number(h.oldPrice));
  const modal = document.getElementById('modal-content');
  modal.innerHTML = `<div class="modal-handle"></div><div class="wizard-question">Evaluate ${esc(sub.name)}</div><p class="modal-copy">Answer honestly. This is a decision aid, not a financial instruction.</p><div class="form-group"><label class="form-label">How often do you use it?</label><select id="eval-usage" class="form-input"><option value="often">Daily or several times a week</option><option value="sometimes">A few times a month</option><option value="rarely">Rarely or never</option></select></div><div class="form-group"><label class="form-label">How important is it?</label><select id="eval-importance" class="form-input"><option value="essential">Essential</option><option value="useful">Useful</option><option value="optional">Optional luxury</option></select></div><div class="form-group"><label class="form-label">Could a cheaper alternative work?</label><select id="eval-alternative" class="form-input"><option value="no">Not really</option><option value="maybe">Possibly</option><option value="yes">Yes</option></select></div><div class="detail-card"><strong>Cost summary</strong><p>${fmt(monthly)} per month · ${fmt(yearly)} per year</p><p>${increases.length ? 'Recorded provider price increases: '+increases.length : 'No provider price increases recorded.'}</p></div><div class="wizard-nav"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="showSubscriptionEvaluation('${sub.id}')">Get evaluation</button></div>`;
  document.getElementById('modal-overlay').classList.add('show');
}
function showSubscriptionEvaluation(id) {
  const sub = state.subs.find(s => s.id === id); if (!sub) return;
  const usage = document.getElementById('eval-usage').value, importance = document.getElementById('eval-importance').value, alternative = document.getElementById('eval-alternative').value;
  let score = (usage === 'often' ? 2 : usage === 'sometimes' ? 1 : 0) + (importance === 'essential' ? 2 : importance === 'useful' ? 1 : 0) - (alternative === 'yes' ? 2 : alternative === 'maybe' ? 1 : 0);
  const verdict = score >= 3 ? 'Worth keeping' : score >= 1 ? 'Review at renewal' : 'Consider cancelling or downgrading';
  const reason = score >= 3 ? 'You use it regularly or consider it important, with limited alternatives.' : score >= 1 ? 'Its value may justify the cost, but compare usage and alternatives before the next renewal.' : 'Low usage, low importance, or a viable cheaper alternative makes this a strong candidate to cut.';
  document.getElementById('modal-content').innerHTML = `<div class="modal-handle"></div><div class="wizard-question">${verdict}</div><p class="modal-copy">${reason}</p><div class="detail-card"><strong>${esc(sub.name)}</strong><p>${fmt(monthlyCost(sub))} monthly · ${fmt(monthlyCost(sub)*12)} yearly</p><p>Potential annual saving if cancelled: ${fmt(monthlyCost(sub)*12)} (before any fees or remaining commitments).</p></div><div class="wizard-nav"><button class="btn btn-secondary" onclick="closeModal()">Close</button><button class="btn btn-primary" onclick="openDetail('${sub.id}')">Back to subscription</button></div>`;
}

function renderInsights() {
  const activeSubs = state.subs.filter(s => s.status === 'active');
  const monthlyTotal = activeSubs.reduce((sum, s) => sum + monthlyCost(s), 0);
  
  const catTotals = {};
  activeSubs.forEach(s => {
    const mc = monthlyCost(s);
    catTotals[s.category] = (catTotals[s.category] || 0) + mc;
  });
  
  const donut = document.getElementById('donut-chart');
  const legend = document.getElementById('category-legend');
  document.getElementById('donut-total').textContent = fmt(monthlyTotal);
  
  const cats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
  let cumulative = 0;
  const gradientParts = [];
  cats.forEach(([cat, val]) => {
    const pct = (val / monthlyTotal) * 100;
    const color = CAT_COLORS[cat] || '#64748b';
    gradientParts.push(`${color} ${cumulative}% ${cumulative + pct}%`);
    cumulative += pct;
  });
  if (gradientParts.length === 0) gradientParts.push('var(--border) 0% 100%');
  donut.style.background = `conic-gradient(${gradientParts.join(', ')})`;
  
  legend.innerHTML = cats.slice(0, 5).map(([cat, val]) => {
    const pct = monthlyTotal > 0 ? ((val / monthlyTotal) * 100).toFixed(0) : 0;
    return `
      <div class="legend-item">
        <div class="legend-dot" style="background:${CAT_COLORS[cat] || '#64748b'}"></div>
        <div class="legend-name">${cat}</div>
        <div class="legend-val">${pct}%</div>
      </div>
    `;
  }).join('');

  // Subscription evaluator
  const evaluator = document.getElementById('subscription-evaluator');
  if (evaluator) evaluator.innerHTML = activeSubs.length ? activeSubs.map(s => `<div class="eval-row"><div><strong>${esc(s.name)}</strong><div class="muted-note">${fmtSubscriptionPrice(s)} · ${esc(s.interval.toLowerCase())}</div></div><button class="btn btn-secondary" onclick="evaluateSubscription('${s.id}')">Evaluate</button></div>`).join('') : '<div class="muted-note">Add an active subscription to evaluate whether it is worth keeping.</div>';
  // Price increases
  const pi = document.getElementById('price-increases');
  const increases = [];
  state.subs.forEach(s => {
    if (s.priceHistory) {
      s.priceHistory.forEach(h => {
        if (h.reason === 'provider' && h.oldPrice > 0 && h.newPrice > h.oldPrice) {
          increases.push({ sub: s, ...h });
        }
      });
    }
  });
  if (increases.length === 0) {
    pi.innerHTML = '<div style="font-size:13px;color:var(--text2)">No recorded price increases yet.</div>';
  } else {
    const totalExtra = increases.reduce((sum, i) => sum + (i.newPrice - i.oldPrice) * (INTERVAL_MULT[i.sub.interval] || 1), 0);
    pi.innerHTML = `
      <div style="margin-bottom:12px">
        <div style="font-size:24px;font-weight:800;color:var(--danger)">${fmt(totalExtra)}</div>
        <div style="font-size:12px;color:var(--text2)">Extra per month from price increases (projected)</div>
      </div>
      ${increases.map(i => {
        const diff = i.newPrice - i.oldPrice;
        const pct = ((diff / i.oldPrice) * 100).toFixed(1);
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--border)">
            <div>
              <div style="font-size:13px;font-weight:600">${i.sub.name}</div>
              <div style="font-size:11px;color:var(--text2)">${fmtDate(i.date)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:13px;font-weight:700;color:var(--danger)">+${fmt(diff)}</div>
              <div style="font-size:11px;color:var(--text2)">+${pct}%</div>
            </div>
          </div>
        `;
      }).join('')}
    `;
  }

  // Savings
  const sl = document.getElementById('savings-list');
  const top3 = [...activeSubs].sort((a, b) => monthlyCost(b) - monthlyCost(a)).slice(0, 3);
  if (top3.length === 0) {
    sl.innerHTML = '<div style="font-size:13px;color:var(--text2)">Add subscriptions to see potential savings.</div>';
  } else {
    sl.innerHTML = top3.map(s => {
      const yearly = monthlyCost(s) * 12;
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:13px;font-weight:600">${s.name}</div>
          <div style="text-align:right">
            <div style="font-size:13px;font-weight:700;color:var(--accent)">${fmt(yearly)}/yr</div>
            <div style="font-size:11px;color:var(--text2)">Hypothetical if cancelled</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Decision stats
  const ds = document.getElementById('decision-stats');
  const total = state.assessments.length;
  const purchased = state.assessments.filter(a => a.outcome === 'purchased').length;
  const skipped = state.assessments.filter(a => a.outcome === 'skipped').length;
  const avoided = state.assessments.filter(a => a.outcome === 'skipped').reduce((sum, a) => sum + a.price, 0);
  ds.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="background:var(--bg);padding:12px;border-radius:12px">
        <div style="font-size:22px;font-weight:800">${total}</div>
        <div style="font-size:11px;color:var(--text2)">Assessments</div>
      </div>
      <div style="background:var(--bg);padding:12px;border-radius:12px">
        <div style="font-size:22px;font-weight:800;color:var(--accent)">${purchased}</div>
        <div style="font-size:11px;color:var(--text2)">Purchased</div>
      </div>
      <div style="background:var(--bg);padding:12px;border-radius:12px">
        <div style="font-size:22px;font-weight:800;color:var(--warning)">${skipped}</div>
        <div style="font-size:11px;color:var(--text2)">Decided against</div>
      </div>
      <div style="background:var(--bg);padding:12px;border-radius:12px">
        <div style="font-size:22px;font-weight:800;color:var(--success)">${fmt(avoided)}</div>
        <div style="font-size:11px;color:var(--text2)">Potential avoided (est.)</div>
      </div>
    </div>
  `;
}

function openCurrencyModal() {
  const options = [['ZAR','South African rand (R)'],['USD','US dollar ($)'],['EUR','Euro (€)'],['GBP','British pound (£)']];
  document.getElementById('modal-content').innerHTML = `<div class="modal-handle"></div><div class="modal-title">Default currency</div><p class="modal-copy">All subscription totals and insights use this currency. Existing subscriptions stay in their original currency and are converted using current exchange rates.</p><div class="option-list">${options.map(([code,label])=>`<div class="option-item ${state.settings.currency===code?'selected':''}" onclick="setDefaultCurrency('${code}')">${label}<span class="check">${state.settings.currency===code?icon('check',14):''}</span></div>`).join('')}</div><div class="wizard-nav"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>`;
  document.getElementById('modal-overlay').classList.add('show');
}
function setDefaultCurrency(code) {
  state.settings.currency = code; state.settings.symbol = CURRENCY_SYMBOLS[code] || '$';
  saveState(); closeModal(); render(); refreshExchangeRates();
  showToast('Default currency updated');
}
function renderSettings() {
  document.getElementById('settings-currency').textContent = state.settings.currency + ' (' + state.settings.symbol + ')';
  document.getElementById('settings-budget').textContent = state.settings.budget ? fmt(state.settings.budget) + '/month' : 'Not set';
  document.getElementById('dark-toggle').classList.toggle('on', state.settings.dark);
}

// ============ DETAIL PAGE ============
function openDetail(id) {
  const sub = state.subs.find(s => s.id === id);
  if (!sub) return;
  const sym = symFor(sub.currency);
  const logoColor = CAT_COLORS[sub.category] || '#64748b';
  const anchor = parseISO(sub.renewalDate), idx = renewalIndex(sub);
  const nr = addIntervals(anchor, sub.interval, idx);
  const days = daysUntil(nr);
  const mc = monthlyCost(sub), yearly = mc * 12;
  const orig = sub.originalPrice != null ? sub.originalPrice : sub.price;
  const change = sub.price - orig;
  const changes = (sub.priceHistory || []).filter(h => h.reason !== 'initial' && h.reason !== 'correction' && h.oldPrice > 0);
  const last = changes[changes.length - 1];
  const REASONS = { provider: 'Provider increase', plan: 'Plan change', reduction: 'Provider reduction', promo: 'Promotion', other: 'Other' };
  const per = { Weekly: 'week', Monthly: 'month', Quarterly: 'quarter', Yearly: 'year' }[sub.interval];
  const statusLabel = sub.status.charAt(0).toUpperCase() + sub.status.slice(1);

  const header = document.getElementById('detail-header');
  header.innerHTML = `
    <div class="detail-header-top">
      <button class="detail-back" onclick="closeDetail()">${icon('left', 20)}</button>
      <div style="display:flex;gap:8px">
        <button class="detail-back" onclick="editSub('${sub.id}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    </div>
    ${logoMarkup(sub, 'detail-logo')}
    <div class="detail-status">${statusLabel}</div>
    <div class="detail-name">${esc(sub.name)}</div>
    <div class="detail-category">${esc(sub.category)} · Subscription since ${sub.since ? fmtDateFull(sub.since) : 'unknown'}</div>
    <div class="detail-price-row">
      <div class="detail-price">${fmt(sub.price, sym)}</div>
      <div class="detail-period">per ${per}</div>
    </div>
    <div class="detail-chips">
      <div class="detail-chip">${sub.interval}</div>
      <div class="detail-chip">${esc(sub.category)}</div>
      ${sub.since ? `<div class="detail-chip">Since ${fmtDate(sub.since)}</div>` : ''}
    </div>
  `;

  const dates = [-3, -2, -1, 0, 1, 2].map(o => addIntervals(anchor, sub.interval, idx + o));
  const whenText = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days + ' days from now';
  const reminderText = sub.reminder === 0 ? 'On renewal day' : sub.reminder > 0 ? sub.reminder + ' days before' : 'Off';

  const alertBlock = last ? (() => {
    const up = last.newPrice > last.oldPrice;
    const pct = Math.abs((last.newPrice - last.oldPrice) / last.oldPrice * 100).toFixed(1);
    return `
      <div class="price-alert ${up ? 'up' : 'down'}">
        <div class="pa-icon">${icon(up ? 'up' : 'down', 18)}</div>
        <div>
          <div class="pa-title">Price ${up ? 'increased' : 'decreased'} by ${pct}%</div>
          <div class="pa-sub">From ${fmt(last.oldPrice, sym)} to ${fmt(last.newPrice, sym)} · ${fmtDate(last.date)} · ${REASONS[last.reason] || 'Other'}</div>
        </div>
      </div>
      ${changes.length > 1 ? `<div class="pa-more">${changes.length} price changes recorded in total</div>` : ''}`;
  })() : `<div class="muted-note">No price changes recorded. Budgit only knows about changes you record.</div>`;

  const files = sub.files || [];
  const body = document.getElementById('detail-body');
  body.innerHTML = `
    <div class="detail-card"><div class="detail-card-title">Subscription evaluation</div><p class="modal-copy">Review how often you use this service and whether its cost is justified.</p><button class="btn btn-primary" onclick="evaluateSubscription('${sub.id}')">Evaluate subscription</button></div>
    <div class="detail-card">
      <div class="detail-card-title">Next Payment</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-size:20px;font-weight:800">${fmtDateFull(nr)}</div>
          <div style="font-size:12px;color:var(--text2)">${whenText} · Projected</div>
        </div>
        <div style="font-size:22px;font-weight:800;color:var(--accent)">${fmt(sub.price, sym)}</div>
      </div>
      <div class="timeline">
        ${dates.map((d, i) => `<div class="timeline-dot ${daysUntil(d) < 0 ? 'filled' : ''} ${i === 3 ? 'current' : ''}"></div>`).join('')}
      </div>
      <div class="timeline-labels">
        ${dates.map(d => `<div>${fmtDate(d)}</div>`).join('')}
      </div>
    </div>

    <div class="detail-card">
      <div class="detail-card-title">Price History</div>
      <div class="chart-container">${renderPriceChart(sub)}</div>
    </div>

    <div class="detail-card">
      <div class="detail-card-title">Price Alerts</div>
      ${alertBlock}
      <div class="pa-actions">
        <button class="btn btn-secondary" onclick="openPriceChange('${sub.id}','up')">${icon('up', 16)} Price increased</button>
        <button class="btn btn-secondary" onclick="openPriceChange('${sub.id}','down')">${icon('down', 16)} Price decreased</button>
      </div>
    </div>

    <div class="detail-card">
      <div class="detail-card-title">Files</div>
      ${files.length ? files.map(f => `
        <div class="file-row">
          <div class="file-ic" onclick="openSubFile('${sub.id}','${f.id}')">${icon(/^image\//.test(f.type) ? 'image' : 'file', 20)}</div>
          <div class="file-info" onclick="openSubFile('${sub.id}','${f.id}')">
            <div class="file-name">${esc(f.name)}</div>
            <div class="file-meta">${fmtSize(f.size)} · Added ${fmtDate(f.added)}</div>
          </div>
          <button class="file-del" onclick="removeSubFile('${sub.id}','${f.id}')" aria-label="Remove file">${icon('trash', 18)}</button>
        </div>`).join('') : `<div class="muted-note">Attach receipts, invoices, contracts or screenshots.</div>`}
      <label class="btn btn-secondary file-add">${icon('paperclip', 16)} Add file
        <input type="file" multiple style="display:none" onchange="addSubFiles('${sub.id}', this)">
      </label>
      <div class="muted-note" style="margin-top:8px">Stored on this device only. Up to 10 MB per file.</div>
    </div>

    <div class="detail-card">
      <div class="detail-card-title">Cost Breakdown</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px">Per Month</div>
          <div style="font-size:20px;font-weight:800;margin-top:4px">${fmt(mc, sym)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px">Per Year</div>
          <div style="font-size:20px;font-weight:800;margin-top:4px">${fmt(yearly, sym)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px">Change Since Start</div>
          <div style="font-size:20px;font-weight:800;margin-top:4px;color:${change > 0 ? 'var(--danger)' : change < 0 ? 'var(--success)' : 'var(--text)'}">${change > 0 ? '+' : change < 0 ? '-' : ''}${fmt(Math.abs(change), sym)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px">Reminder</div>
          <div style="font-size:14px;font-weight:700;margin-top:4px">${reminderText}</div>
        </div>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-secondary" style="flex:1" onclick="changeStatus('${sub.id}','${sub.status === 'paused' ? 'active' : 'paused'}')">${sub.status === 'paused' ? 'Resume' : 'Pause'}</button>
      <button class="btn btn-secondary" style="flex:1;color:var(--danger);border-color:var(--danger)" onclick="changeStatus('${sub.id}','cancelled')">Cancel</button>
      <button class="btn btn-secondary" style="flex:1;color:var(--danger);border-color:var(--danger)" onclick="deleteSub('${sub.id}')">Delete</button>
    </div>
    <div style="font-size:11px;color:var(--text3);text-align:center;margin-top:12px;padding:0 20px">
      Budgit can't cancel with the provider. Cancel there first, then mark it cancelled here.
    </div>
  `;

  document.getElementById('detail-page').classList.add('show');
}

// Step chart: a price holds until the next recorded change, then the line steps.
function renderPriceChart(sub) {
  const sym = symFor(sub.currency);
  const hist = (sub.priceHistory || []).filter(e => e.reason !== 'correction');
  const initial = hist.find(e => e.reason === 'initial');
  const pts = [{
    price: initial ? initial.newPrice : (sub.originalPrice != null ? sub.originalPrice : sub.price),
    date: sub.since || (initial && initial.date) || toISO(new Date()),
    kind: 'start'
  }];
  hist.filter(e => e.reason !== 'initial').forEach(e => pts.push({ price: e.newPrice, date: e.date, kind: e.newPrice > e.oldPrice ? 'up' : 'down' }));

  const W = 320, H = 190, L = 46, R = 22, T = 28, B = 36, n = pts.length;
  const prices = pts.map(p => p.price);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (lo === hi) { const pad = lo > 0 ? lo * 0.25 : 1; lo = Math.max(0, lo - pad); hi = hi + pad; }
  else { const m = (hi - lo) * 0.3; lo = Math.max(0, lo - m); hi = hi + m; }
  const X = i => L + i * ((W - L - R) / n);
  const Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const money = v => sym + (Math.abs(v % 1) < 0.005 ? v.toFixed(0) : v.toFixed(2));

  let d = 'M' + X(0) + ',' + Y(pts[0].price);
  for (let i = 1; i < n; i++) d += ' L' + X(i) + ',' + Y(pts[i - 1].price) + ' L' + X(i) + ',' + Y(pts[i].price);
  d += ' L' + X(n) + ',' + Y(pts[n - 1].price);
  const area = d + ' L' + X(n) + ',' + (H - B) + ' L' + X(0) + ',' + (H - B) + ' Z';
  const col = k => k === 'up' ? '#ef4444' : k === 'down' ? '#10b981' : '#5fa30f';
  const grid = [0, 0.5, 1].map(t => {
    const v = lo + (hi - lo) * t, y = Y(v);
    return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--border)" stroke-dasharray="3 4"/><text x="${L - 8}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--text3)">${money(v)}</text>`;
  }).join('');
  const step = n > 4 ? 2 : 1;
  const labels = pts.map((p, i) => (i % step === 0 || i === n - 1) ? `<text x="${X(i)}" y="${H - 14}" text-anchor="middle" font-size="9" fill="var(--text3)">${fmtDate(p.date)}</text>` : '').join('')
    + `<text x="${X(n)}" y="${H - 14}" text-anchor="middle" font-size="9" fill="var(--text3)">Today</text>`;
  const dots = pts.map((p, i) => {
    // Move the value below its marker only when it would sit on a neighbouring step segment.
    const overlapsStep = (i > 0 && Math.abs(pts[i - 1].price - p.price) < 0.0001) ||
      (i < pts.length - 1 && Math.abs(pts[i + 1].price - p.price) < 0.0001);
    const labelY = Y(p.price) + (overlapsStep ? 18 : -11);
    return `<circle cx="${X(i)}" cy="${Y(p.price)}" r="5" fill="var(--card)" stroke="${col(p.kind)}" stroke-width="2.5"/>`
      + `<text x="${X(i)}" y="${labelY}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text)" paint-order="stroke" stroke="var(--card)" stroke-width="3" stroke-linejoin="round">${money(p.price)}</text>`;
  }).join('');
  const note = n === 1 ? `<div class="chart-note">No price changes since ${fmtDate(pts[0].date)}</div>` : '';

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="pg-${sub.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5fa30f" stop-opacity="0.22"/><stop offset="100%" stop-color="#5fa30f" stop-opacity="0"/></linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#pg-${sub.id})"/>
      <path d="${d}" fill="none" stroke="#5fa30f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"${n === 1 ? ' stroke-dasharray="6 5"' : ''}/>
      ${dots}${labels}
    </svg>${note}`;
}

function closeDetail() {
  document.getElementById('detail-page').classList.remove('show');
}

function changeStatus(id, status) {
  const sub = state.subs.find(s => s.id === id);
  if (sub) {
    sub.status = status;
    saveState();
    render();
    openDetail(id);
    showToast('Status updated to ' + status);
  }
}

function deleteSub(id) {
  if (confirm('Delete this subscription? This cannot be undone.')) {
    const gone = state.subs.find(s => s.id === id);
    (gone && gone.files || []).forEach(f => fileDel(f.id).catch(() => {}));
    state.subs = state.subs.filter(s => s.id !== id);
    saveState();
    closeDetail();
    render();
    showToast('Subscription deleted');
  }
}

function editSub(id) {
  const sub = state.subs.find(s => s.id === id);
  if (!sub) return;
  wizardData = { ...sub, editing: true };
  wizardStep = 0;
  openWizard();
}

// ============ WIZARD ============
function openAddSub() {
  const today = new Date();
  const nextMonthIndex = today.getMonth() + 1;
  const lastDayOfNextMonth = new Date(today.getFullYear(), nextMonthIndex + 1, 0).getDate();
  const nextMonth = new Date(today.getFullYear(), nextMonthIndex, Math.min(today.getDate(), lastDayOfNextMonth));
  wizardData = { 
    name: '', 
    price: 10, 
    currency: state.settings.currency, 
    interval: 'Monthly', 
    renewalDate: toISO(nextMonth), 
    category: 'Entertainment', 
    reminder: 3, 
    note: '' 
  };
  wizardStep = 0;
  openWizard();
}

function openWizard() {
  const modal = document.getElementById('modal-content');
  modal.innerHTML = renderWizardStep();
  document.getElementById('modal-overlay').classList.add('show');
}

function renderWizardStep() {
  const steps = [
    renderWizardName(),
    renderWizardPrice(),
    renderWizardInterval(),
    renderWizardDate(),
    renderWizardCategory(),
    renderWizardReminder(),
    renderWizardReview()
  ];
  return `
    <div class="modal-handle"></div>
    <div class="wizard-progress"><div class="wizard-progress-bar" style="width:${((wizardStep + 1) / 7) * 100}%"></div></div>
    ${steps[wizardStep]}
  `;
}

function chooseSubLogo(key) {
  wizardData.logoKey = key;
  wizardData.logoData = '';
  openWizard();
}
function setWizardLogo(input) {
  const file = input.files && input.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Choose an image under 5 MB'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas'), max = 256;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      wizardData.logoData = canvas.toDataURL('image/jpeg', 0.82);
      wizardData.logoKey = 'custom';
      openWizard();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
function logoMarkup(sub, className='sub-logo') {
  if (sub.logoData) return `<div class="${className} has-image"><img src="${sub.logoData}" alt=""></div>`;
  const brands = {spotify:{text:'●',bg:'#1DB954',fg:'#fff'},netflix:{text:'N',bg:'#E50914',fg:'#fff'},youtube:{text:'▶',bg:'#fff',fg:'#FF0000'},mcdonalds:{text:'M',bg:'#FFC72C',fg:'#DA291C'},apple:{text:'●',bg:'#202020',fg:'#fff'},disney:{text:'D+',bg:'#101A4B',fg:'#fff'},prime:{text:'prime',bg:'#00A8E0',fg:'#fff'}};
  const b = brands[sub.logoKey];
  if (b) return `<div class="${className}" style="background:${b.bg};color:${b.fg}">${b.text}</div>`;
  return `<div class="${className}" style="background:${CAT_COLORS[sub.category] || '#64748b'}">${esc((sub.name||'?').charAt(0).toUpperCase())}</div>`;
}

function renderWizardName() {
  return `
    <div class="wizard-step active">
      <div class="wizard-question">What's the subscription name?</div>
      <div class="form-group">
        <input class="form-input" type="text" id="w-name" placeholder="e.g. Netflix, Spotify..." value="${esc(wizardData.name || '')}" oninput="wizardData.name=this.value">
      </div>
      <div class="form-group">
        <label class="form-label">Subscription image (optional)</label>
        <div class="logo-picker">
          ${[['letter','Aa'],['spotify','●'],['netflix','N'],['youtube','▶'],['mcdonalds','M'],['apple','●'],['disney','D+'],['prime','prime']].map(([key,label]) => `<button type="button" class="logo-choice logo-${key} ${wizardData.logoKey===key?'selected':''}" onclick="chooseSubLogo('${key}')"><span class="brand-mark">${label}</span><small>${({letter:'Initials',spotify:'Spotify',netflix:'Netflix',youtube:'YouTube',mcdonalds:"McDonald's",apple:'Apple',disney:'Disney+',prime:'Prime Video'})[key]}</small></button>`).join('')}
        </div>
        <label class="upload-logo">Upload your own image<input type="file" accept="image/*" hidden onchange="setWizardLogo(this)"></label>
        <div class="selected-logo-preview">Preview ${logoMarkup({name:wizardData.name || 'Subscription',category:wizardData.category || 'Other',logoKey:wizardData.logoKey,logoData:wizardData.logoData})}</div>
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="wizardNext()">Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderWizardPrice() {
  return `
    <div class="wizard-step active">
      <div class="wizard-question">How much does it cost?</div>
      <div class="price-picker">
        <button class="price-btn" onclick="adjustPrice(-1)">−</button>
        <div class="price-display">${state.settings.symbol}${wizardData.price}</div>
        <button class="price-btn" onclick="adjustPrice(1)">+</button>
      </div>
      <div style="text-align:center;font-size:12px;color:var(--text3);margin-bottom:16px">0 is fine for free trials</div>
      <div class="currency-hint">Using your default currency: <strong>${state.settings.currency} (${state.settings.symbol})</strong>. Change it in Settings at any time.</div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="wizardBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="wizardNext()">Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderWizardInterval() {
  return `
    <div class="wizard-step active">
      <div class="wizard-question">What's the billing interval?</div>
      <div class="option-list">
        ${INTERVALS.map(i => `
          <div class="option-item ${wizardData.interval === i ? 'selected' : ''}" onclick="wizardData.interval='${i}';openWizard()">
            ${i}
            <div class="check">${wizardData.interval === i ? icon('check', 14) : ''}</div>
          </div>
        `).join('')}
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="wizardBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="wizardNext()">Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function setRenewal(iso) {
  wizardData.renewalDate = iso;
  const l = document.getElementById('w-date-label');
  if (l) l.textContent = fmtDateFull(iso);
}

function renderWizardDate() {
  if (!wizardData.renewalDate) wizardData.renewalDate = toISO(new Date());
  return `
    <div class="wizard-step active">
      <div class="wizard-question">When does it renew?</div>
      <div class="cal-selected" id="w-date-label">${fmtDateFull(wizardData.renewalDate)}</div>
      ${calendar('renew', wizardData.renewalDate, 'setRenewal')}
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="wizardBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="wizardNext()">Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderWizardCategory() {
  return `
    <div class="wizard-step active">
      <div class="wizard-question">What type of subscription?</div>
      <div class="option-list">
        ${CATEGORIES.map(c => `
          <div class="option-item ${wizardData.category === c ? 'selected' : ''}" onclick="wizardData.category='${c}';openWizard()">
            ${c}
            <div class="check">${wizardData.category === c ? icon('check', 14) : ''}</div>
          </div>
        `).join('')}
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="wizardBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="wizardNext()">Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderWizardReminder() {
  const reminders = [
    { val: 0, label: 'On renewal day' },
    { val: 1, label: '1 day before' },
    { val: 3, label: '3 days before' },
    { val: 7, label: '7 days before' },
    { val: -1, label: 'No reminder' }
  ];
  return `
    <div class="wizard-step active">
      <div class="wizard-question">Remind me before renewal</div>
      <div class="option-list">
        ${reminders.map(r => `
          <div class="option-item ${wizardData.reminder === r.val ? 'selected' : ''}" onclick="wizardData.reminder=${r.val};openWizard()">
            ${r.label}
            <div class="check">${wizardData.reminder === r.val ? icon('check', 14) : ''}</div>
          </div>
        `).join('')}
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="wizardBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="wizardNext()">Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderWizardReview() {
  const nr = wizardData.renewalDate ? fmtDateFull(wizardData.renewalDate) : 'Not set';
  return `
    <div class="wizard-step active">
      <div class="wizard-question">Review your subscription</div>
      <div style="background:var(--bg);border-radius:16px;padding:16px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:12px;color:var(--text2)">Name</div>
          <div style="font-size:14px;font-weight:600">${wizardData.name}</div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:12px;color:var(--text2)">Price</div>
          <div style="font-size:14px;font-weight:600">${fmt(wizardData.price, wizardData.currency === 'USD' ? '$' : wizardData.currency === 'ZAR' ? 'R' : wizardData.currency === 'EUR' ? '€' : '£')}</div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:12px;color:var(--text2)">Interval</div>
          <div style="font-size:14px;font-weight:600">${wizardData.interval}</div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:12px;color:var(--text2)">Renewal</div>
          <div style="font-size:14px;font-weight:600">${nr}</div>
        </div>
        <div style="display:flex;justify-content:space-between">
          <div style="font-size:12px;color:var(--text2)">Category</div>
          <div style="font-size:14px;font-weight:600">${wizardData.category}</div>
        </div>
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="wizardBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="saveSub()">Save Subscription</button>
      </div>
    </div>
  `;
}

function adjustPrice(delta) {
  wizardData.price = Math.max(0, wizardData.price + delta);
  openWizard();
}

function wizardNext() {
  // Read visible fields before validating; this is reliable in downloaded HTML files too.
  const nameInput = document.getElementById('w-name');
  const dateInput = document.getElementById('w-date');
  if (wizardStep === 3 && !wizardData.renewalDate) {
    showToast('Please choose a renewal date');
    return;
  }
  if (wizardStep === 0) {
    wizardData.name = (nameInput ? nameInput.value : wizardData.name || '').trim();
    if (!wizardData.name) {
      showToast('Please enter a subscription name');
      if (nameInput) nameInput.focus();
      return;
    }
  }
  if (wizardStep < 6) {
    wizardStep++;
    if (wizardStep === 1 && wizardData.editing) wizardStep = 2;
    openWizard();
  }
}

function wizardBack() {
  if (wizardStep > 0) {
    wizardStep--;
    if (wizardStep === 1 && wizardData.editing) wizardStep = 0;
    openWizard();
  }
}

function saveSub() {
  if (wizardData.editing) {
    const sub = state.subs.find(s => s.id === wizardData.id);
    if (sub) {
      if (sub.price !== wizardData.price && sub.price > 0) {
        showPriceChangeModal(sub);
        return;
      }
      Object.assign(sub, {
        name: wizardData.name,
        price: wizardData.price,
        currency: wizardData.currency,
        interval: wizardData.interval,
        renewalDate: wizardData.renewalDate,
        category: wizardData.category,
        reminder: wizardData.reminder,
        logoKey: wizardData.logoKey || 'letter',
        logoData: wizardData.logoData || ''
      });
    }
  } else {
    const newSub = {
      id: uid(),
      name: wizardData.name,
      price: wizardData.price,
      originalPrice: wizardData.price,
      currency: wizardData.currency,
      interval: wizardData.interval,
      renewalDate: wizardData.renewalDate,
      category: wizardData.category,
      status: 'active',
      reminder: wizardData.reminder,
      logoKey: wizardData.logoKey || 'letter',
      logoData: wizardData.logoData || '',
      note: '',
      since: toISO(new Date()),
      priceHistory: [{ date: toISO(new Date()), oldPrice: 0, newPrice: wizardData.price, reason: 'initial' }]
    };
    state.subs.push(newSub);
  }
  saveState();
  closeModal();
  render();
  if (wizardData.editing) openDetail(wizardData.id);
  showToast(wizardData.editing ? 'Subscription updated' : 'Subscription added');
}

function showPriceChangeModal(sub) {
  const diff = wizardData.price - sub.price;
  const pct = sub.price > 0 ? ((diff / sub.price) * 100).toFixed(1) : 0;
  const yearlyExtra = diff * 12 * (INTERVAL_MULT[sub.interval] || 1);
  
  const modal = document.getElementById('modal-content');
  modal.innerHTML = `
    <div class="modal-handle"></div>
    <div class="wizard-question">What changed?</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:16px">A change to the subscription price was detected.</div>
    <div style="background:var(--bg);border-radius:16px;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:12px;color:var(--text2)">Previous price</div>
        <div style="font-size:16px;font-weight:700">${fmt(sub.price)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:12px;color:var(--text2)">New price</div>
        <div style="font-size:16px;font-weight:700;color:var(--accent)">${fmt(wizardData.price)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:12px;color:var(--text2)">Difference</div>
        <div style="font-size:16px;font-weight:700;color:${diff > 0 ? 'var(--danger)' : 'var(--success)'}">${diff > 0 ? '+' : ''}${fmt(diff)}</div>
      </div>
      ${sub.price > 0 ? `
      <div style="display:flex;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:12px;color:var(--text2)">Percentage</div>
        <div style="font-size:16px;font-weight:700">${pct}%</div>
      </div>
      ` : ''}
      ${yearlyExtra !== 0 ? `
      <div style="display:flex;justify-content:space-between">
        <div style="font-size:12px;color:var(--text2)">Extra per year</div>
        <div style="font-size:16px;font-weight:700;color:var(--danger)">${fmt(yearlyExtra)}</div>
      </div>
      ` : ''}
    </div>
    <div class="option-list" style="margin-bottom:16px">
      <div class="option-item" onclick="recordPriceChange('provider')">
        The provider increased the price
        <div class="check"></div>
      </div>
      <div class="option-item" onclick="recordPriceChange('plan')">
        I changed my plan
        <div class="check"></div>
      </div>
      <div class="option-item" onclick="recordPriceChange('correction')">
        I'm correcting a mistake
        <div class="check"></div>
      </div>
      <div class="option-item" onclick="recordPriceChange('other')">
        Something else
        <div class="check"></div>
      </div>
    </div>
    <button class="btn btn-secondary" onclick="openWizard()" style="width:100%">Cancel</button>
  `;
}

function recordPriceChange(reason) {
  const sub = state.subs.find(s => s.id === wizardData.id);
  if (sub) {
    if (reason !== 'correction') {
      if (!sub.priceHistory) sub.priceHistory = [];
      sub.priceHistory.push({
        date: toISO(new Date()),
        oldPrice: sub.price,
        newPrice: wizardData.price,
        reason: reason
      });
    } else if (!sub.priceHistory || sub.priceHistory.length <= 1) {
      sub.originalPrice = wizardData.price;
    }
    sub.price = wizardData.price;
    sub.name = wizardData.name;
    sub.currency = wizardData.currency;
    sub.interval = wizardData.interval;
    sub.renewalDate = wizardData.renewalDate;
    sub.category = wizardData.category;
    sub.reminder = wizardData.reminder;
  }
  saveState();
  closeModal();
  render();
  showToast('Subscription updated');
}

// ============ PRICE CHANGE (from the Price Alerts card) ============
let pcData = {};
function pcReasons(dir) {
  return dir === 'up'
    ? [['provider', 'The provider increased the price'], ['plan', 'I upgraded my plan'], ['other', 'Something else']]
    : [['reduction', 'The provider lowered the price'], ['promo', 'A promotion or discount'], ['plan', 'I downgraded my plan'], ['other', 'Something else']];
}
function openPriceChange(id, dir) {
  const sub = state.subs.find(s => s.id === id);
  if (!sub) return;
  pcData = { id: id, dir: dir, newPrice: sub.price, reason: '' };
  renderPriceChange();
  document.getElementById('modal-overlay').classList.add('show');
}
function renderPriceChange() {
  const sub = state.subs.find(s => s.id === pcData.id), up = pcData.dir === 'up', sym = symFor(sub.currency);
  document.getElementById('modal-content').innerHTML = `
    <div class="modal-handle"></div>
    <div class="wizard-question">${up ? 'Price increased' : 'Price decreased'}</div>
    <div class="muted-note" style="margin-bottom:14px">${esc(sub.name)} currently costs ${fmt(sub.price, sym)}. What is the new price?</div>
    <div class="form-group">
      <label class="form-label">New price (${sub.currency})</label>
      <input class="form-input" type="number" inputmode="decimal" step="0.01" min="0" id="pc-price" value="${pcData.newPrice}" oninput="pcPrice(this.value)">
    </div>
    <div class="pc-summary" id="pc-summary"></div>
    <div class="form-label" style="margin:14px 0 8px">Reason</div>
    <div class="option-list">
      ${pcReasons(pcData.dir).map(r => `<div class="option-item ${pcData.reason === r[0] ? 'selected' : ''}" onclick="pcReason('${r[0]}')">${r[1]}<div class="check">${pcData.reason === r[0] ? icon('check', 14) : ''}</div></div>`).join('')}
    </div>
    <div class="wizard-nav" style="margin-top:16px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="savePriceChange()">Save change</button>
    </div>
  `;
  pcPrice(pcData.newPrice);
}
function pcReason(v) { pcData.reason = v; renderPriceChange(); }
function pcPrice(v) {
  pcData.newPrice = v;
  const sub = state.subs.find(s => s.id === pcData.id), el = document.getElementById('pc-summary');
  if (!sub || !el) return;
  const sym = symFor(sub.currency), p = parseFloat(v), up = pcData.dir === 'up';
  if (isNaN(p) || p < 0) { el.innerHTML = '<span style="color:var(--danger)">Enter a valid price.</span>'; return; }
  if (up && p <= sub.price) { el.innerHTML = '<span style="color:var(--danger)">For an increase, enter a price above ' + fmt(sub.price, sym) + '.</span>'; return; }
  if (!up && p >= sub.price) { el.innerHTML = '<span style="color:var(--danger)">For a decrease, enter a price below ' + fmt(sub.price, sym) + '.</span>'; return; }
  const diff = p - sub.price, pct = (diff / sub.price * 100).toFixed(1), yearly = diff * 12 * (INTERVAL_MULT[sub.interval] || 1);
  const c = diff > 0 ? 'var(--danger)' : 'var(--success)', sign = diff > 0 ? '+' : '-';
  el.innerHTML = `<div class="pc-row"><span>Difference</span><b style="color:${c}">${sign}${fmt(Math.abs(diff), sym)}${sub.price > 0 ? ' (' + sign + Math.abs(pct) + '%)' : ''}</b></div>
    <div class="pc-row"><span>Per year, if it stays</span><b style="color:${c}">${sign}${fmt(Math.abs(yearly), sym)}</b></div>`;
}
function savePriceChange() {
  const sub = state.subs.find(s => s.id === pcData.id);
  if (!sub) return;
  const p = parseFloat(pcData.newPrice), up = pcData.dir === 'up';
  if (isNaN(p) || p < 0 || (up && p <= sub.price) || (!up && p >= sub.price)) { showToast('Check the new price'); return; }
  if (!pcData.reason) { showToast('Choose a reason'); return; }
  sub.priceHistory = sub.priceHistory || [];
  sub.priceHistory.push({ date: toISO(new Date()), oldPrice: sub.price, newPrice: p, reason: pcData.reason });
  sub.price = p;
  saveState();
  closeModal();
  render();
  openDetail(sub.id);
  showToast(up ? 'Price increase recorded' : 'Price decrease recorded');
}

// ============ DECIDE WIZARD ============
function openDecideWizard() {
  decideData = { product: '', price: 0, currency: state.settings.currency, dealStatus: 'no', needWant: '', importance: 5, duration: '', reason: '', saved: false, credit: false, notes: '' };
  decideStep = 0;
  openDecideModal();
}

function openDecideModal() {
  const modal = document.getElementById('modal-content');
  modal.innerHTML = renderDecideStep();
  document.getElementById('modal-overlay').classList.add('show');
}

function renderDecideStep() {
  const steps = [
    renderDecideProduct(),
    renderDecideDeal(),
    renderDecideNeedWant(),
    renderDecideImportance(),
    renderDecideDuration(),
    renderDecideReason(),
    renderDecideBudget(),
    renderDecideResult()
  ];
  return `
    <div class="modal-handle"></div>
    <div class="wizard-progress"><div class="wizard-progress-bar" style="width:${((decideStep + 1) / 8) * 100}%"></div></div>
    ${steps[decideStep]}
  `;
}

function renderDecideProduct() {
  return `
    <div class="wizard-step active">
      <div class="wizard-question">What are you thinking of buying?</div>
      <div class="form-group">
        <label class="form-label">Product name</label>
        <input class="form-input" type="text" id="d-product" placeholder="e.g. Wireless headphones" value="${decideData.product}" oninput="decideData.product=this.value">
      </div>
      <div class="form-group">
        <label class="form-label">Price</label>
        <input class="form-input" type="number" id="d-price" placeholder="0.00" value="${decideData.price || ''}" oninput="decideData.price=parseFloat(this.value)||0">
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="decideNext()">Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderDecideDeal() {
  const deals = [
    { val: 'no', label: 'No, it is the normal price' },
    { val: 'discount', label: 'Yes, it is discounted' },
    { val: 'bundle', label: 'Yes, it is a bundle' },
    { val: 'both', label: 'Both discounted and bundled' },
    { val: 'unsure', label: "I'm not sure" }
  ];
  return `
    <div class="wizard-step active">
      <div class="wizard-question">Is it on special or part of a bundle?</div>
      <div class="option-list">
        ${deals.map(d => `
          <div class="option-item ${decideData.dealStatus === d.val ? 'selected' : ''}" onclick="decideData.dealStatus='${d.val}';openDecideModal()">
            ${d.label}
            <div class="check">${decideData.dealStatus === d.val ? icon('check', 14) : ''}</div>
          </div>
        `).join('')}
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="decideBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="decideNext()">Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderDecideNeedWant() {
  const opts = [
    { val: 'need', label: 'Essential need', sub: 'Daily life, work, health' },
    { val: 'useful', label: 'Useful purchase', sub: 'Makes life easier' },
    { val: 'want', label: 'Personal want', sub: "I'd enjoy it" },
    { val: 'impulse', label: 'Mostly impulse', sub: 'Want it right now' }
  ];
  return `
    <div class="wizard-step active">
      <div class="wizard-question">Is this a need or a want?</div>
      <div class="option-list">
        ${opts.map(o => `
          <div class="option-item ${decideData.needWant === o.val ? 'selected' : ''}" onclick="decideData.needWant='${o.val}';openDecideModal()" style="flex-direction:column;align-items:flex-start;gap:4px;position:relative">
            <div style="font-weight:700">${o.label}</div>
            <div style="font-size:11px;color:var(--text2);font-weight:400">${o.sub}</div>
            <div class="check" style="position:absolute;right:16px;top:50%;transform:translateY(-50%)">${decideData.needWant === o.val ? icon('check', 14) : ''}</div>
          </div>
        `).join('')}
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="decideBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="decideNext()" ${!decideData.needWant ? 'disabled style="opacity:0.5"' : ''}>Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderDecideImportance() {
  return `
    <div class="wizard-step active">
      <div class="wizard-question">How badly do you want or need it?</div>
      <div class="slider-wrap">
        <div class="slider-track">
          <div class="slider-fill" style="width:${decideData.importance * 10}%"></div>
          <div class="slider-thumb" style="left:${decideData.importance * 10}%"></div>
        </div>
        <div class="slider-labels">
          <span>Not important</span>
          <span>10 - Essential</span>
        </div>
        <input type="range" class="slider-input" min="1" max="10" value="${decideData.importance}" oninput="decideData.importance=parseInt(this.value);const fill=this.parentElement.querySelector('.slider-fill');const thumb=this.parentElement.querySelector('.slider-thumb');const value=this.parentElement.querySelector('.slider-value');if(fill)fill.style.width=(decideData.importance*10)+'%';if(thumb)thumb.style.left=(decideData.importance*10)+'%';if(value)value.textContent=decideData.importance+' / 10'">
        <div class="slider-value">${decideData.importance} / 10</div>
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="decideBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="decideNext()">Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderDecideDuration() {
  const durations = [
    { val: 'hours', label: 'Less than a day' },
    { val: 'days', label: 'A few days' },
    { val: 'weeks', label: 'One or two weeks' },
    { val: 'months', label: 'A month or longer' }
  ];
  return `
    <div class="wizard-step active">
      <div class="wizard-question">How long have you wanted it?</div>
      <div class="option-list">
        ${durations.map(d => `
          <div class="option-item ${decideData.duration === d.val ? 'selected' : ''}" onclick="decideData.duration='${d.val}';openDecideModal()">
            ${d.label}
            <div class="check">${decideData.duration === d.val ? icon('check', 14) : ''}</div>
          </div>
        `).join('')}
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="decideBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="decideNext()" ${!decideData.duration ? 'disabled style="opacity:0.5"' : ''}>Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderDecideReason() {
  const reasons = [
    { val: 'need', label: 'I genuinely need it' },
    { val: 'replace', label: 'Replaces something broken' },
    { val: 'work', label: 'Helps with work/school' },
    { val: 'hobby', label: 'Hobby or entertainment' },
    { val: 'discount', label: 'Discounted, dont want to miss' },
    { val: 'social', label: 'Friends/social media influenced' },
    { val: 'mood', label: 'Bored or improving mood' },
    { val: 'longtime', label: 'Wanted it for a long time' }
  ];
  return `
    <div class="wizard-step active">
      <div class="wizard-question">Why do you want it?</div>
      <div class="option-list">
        ${reasons.map(r => `
          <div class="option-item ${decideData.reason === r.val ? 'selected' : ''}" onclick="decideData.reason='${r.val}';openDecideModal()">
            ${r.label}
            <div class="check">${decideData.reason === r.val ? icon('check', 14) : ''}</div>
          </div>
        `).join('')}
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="decideBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="decideNext()" ${!decideData.reason ? 'disabled style="opacity:0.5"' : ''}>Continue ${icon('arrowRight', 16)}</button>
      </div>
    </div>
  `;
}

function renderDecideBudget() {
  const monthlySubs = state.subs.filter(s => s.status === 'active').reduce((sum, s) => sum + monthlyCost(s), 0);
  return `
    <div class="wizard-step active">
      <div class="wizard-question">Can you afford it?</div>
      <div class="form-group">
        <label class="form-label">Money available (optional)</label>
        <input class="form-input" type="number" id="d-budget" placeholder="e.g. 500" value="${decideData.budget || ''}" oninput="decideData.budget=parseFloat(this.value)||null">
      </div>
      <div style="background:var(--bg);border-radius:12px;padding:12px;margin-bottom:16px;font-size:12px;color:var(--text2)">
        Your recorded monthly subscriptions: <strong>${fmt(monthlySubs)}</strong>
      </div>
      <div class="option-list" style="margin-bottom:16px">
        <div class="option-item ${decideData.saved ? 'selected' : ''}" onclick="toggleDecideSaved()">
          I've already saved for this
          <div class="check">${decideData.saved ? icon('check', 14) : ''}</div>
        </div>
        <div class="option-item ${decideData.credit ? 'selected' : ''}" onclick="decideData.credit=!decideData.credit;openDecideModal()">
          I would need to borrow or use credit
          <div class="check">${decideData.credit ? icon('check', 14) : ''}</div>
        </div>
      </div>
      <div class="wizard-nav">
        <button class="btn btn-secondary" onclick="decideBack()">${icon('arrowLeft', 16)} Back</button>
        <button class="btn btn-primary" onclick="generateRecommendation()">Get Recommendation</button>
      </div>
    </div>
  `;
}

function renderDecideResult() {
  const rec = decideData.recommendation;
  if (!rec) return '<div>Generating...</div>';
  
  const waitHours = rec.suggested_wait_hours || 24;
  const waitLabel = waitHours < 24 ? waitHours + ' hours' : waitHours >= 168 ? (waitHours/168).toFixed(0) + ' weeks' : (waitHours/24).toFixed(0) + ' days';
  
  return `
    <div class="wizard-step active">
      <div class="rec-card">
        <div class="rec-category">${rec.recommendation_category.replace(/_/g, ' ')}</div>
        <div class="rec-title">${rec.recommendation_title}</div>
        <ul class="rec-reasons">
          ${rec.reasoning.map(r => `<li>${r}</li>`).join('')}
        </ul>
      </div>
      
      <div class="detail-card">
        <div class="detail-card-title">Financial Impact</div>
        <div style="font-size:24px;font-weight:800;margin-bottom:8px">${fmt(decideData.price)}</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px">One-time purchase cost</div>
        ${rec.financial_impact.budget_status ? `
          <div style="font-size:13px;padding:10px;background:var(--bg);border-radius:10px">
            ${rec.financial_impact.budget_status === 'over' ? icon('alert', 14) + ' This exceeds your stated budget' : rec.financial_impact.budget_status === 'under' ? icon('check', 14) + ' Within your stated budget' : 'Budget status unknown'}
          </div>
        ` : ''}
        ${rec.relevant_unknowns.length > 0 ? `
          <div style="margin-top:12px;font-size:12px;color:var(--text2)">
            <strong>Unknowns:</strong> ${rec.relevant_unknowns.join(', ')}
          </div>
        ` : ''}
      </div>
      
      ${waitHours > 0 ? `
      <div style="background:var(--accent-light);border-radius:12px;padding:14px;margin-bottom:16px;text-align:center">
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px">Suggested waiting period</div>
        <div style="font-size:24px;font-weight:800;color:var(--accent)">${waitLabel}</div>
      </div>
      ` : ''}
      
      <div class="wizard-nav" style="flex-direction:column">
        ${rec.recommendation_category === 'SAVE_FOR_IT' ? `<button class="btn btn-primary" onclick="saveForPurchase()">Save for it</button>` : ''}
        ${waitHours > 0 ? `<button class="btn ${rec.recommendation_category === 'SAVE_FOR_IT' ? 'btn-secondary' : 'btn-primary'}" onclick="startWaiting(${waitHours})">Start ${waitLabel} timer</button>` : ''}
        <button class="btn btn-secondary" onclick="markPurchased()">I'll buy it now</button>
        <button class="btn btn-ghost" onclick="markSkipped()">Skip this purchase</button>
      </div>
    </div>
  `;
}

function toggleDecideSaved(){decideData.saved=!decideData.saved;if(decideData.saved){const name=(decideData.product||'Purchase').trim();if(!state.savingsGoals.some(g=>g.sourceProduct===name)){state.savingsGoals.push({id:uid(),name,amount:Number(decideData.price)||0,mode:'goal',deadline:'',interval:'Weekly',reminderTime:'20:00',created:toISO(new Date()),lastPromptKey:'',sourceProduct:name});saveState();showToast('Added to Savings as a goal');}}else{showToast('Removed from this decision');}openDecideModal()}

function decideNext() {
  // Read the visible fields before validating, avoiding stale input state in HTML viewers.
  if (decideStep === 0) {
    const productInput = document.getElementById('d-product');
    const priceInput = document.getElementById('d-price');
    decideData.product = (productInput ? productInput.value : decideData.product || '').trim();
    decideData.price = parseFloat(priceInput ? priceInput.value : decideData.price) || 0;
    if (!decideData.product) {
      showToast('Please enter the product name');
      if (productInput) productInput.focus();
      return;
    }
    if (decideData.price <= 0) {
      showToast('Please enter a price greater than zero');
      if (priceInput) priceInput.focus();
      return;
    }
  }
  if (decideStep < 7) {
    decideStep++;
    openDecideModal();
  }
}

function decideBack() {
  if (decideStep > 0) {
    decideStep--;
    openDecideModal();
  }
}

function generateRecommendation() {
  const budgetInput = document.getElementById('d-budget');
  if (budgetInput) decideData.budget = parseFloat(budgetInput.value) || null;
  let impulseSignals = 0;
  if (decideData.needWant === 'want' || decideData.needWant === 'impulse') impulseSignals++;
  if (decideData.duration === 'hours') impulseSignals++;
  if (decideData.reason === 'discount' || decideData.reason === 'social' || decideData.reason === 'mood') impulseSignals++;
  if (decideData.importance <= 4) impulseSignals++;
  
  let category, title, confidence, reasoning = [], waitHours = 0;
  
  if (decideData.needWant === 'need' && decideData.importance >= 7) {
    category = 'BUY_NOW_IF_NECESSARY';
    title = 'Buy now if necessary';
    confidence = 'high';
    reasoning = ['This appears to be a genuine need', 'High importance rating supports acting promptly'];
    if (decideData.budget && decideData.price > decideData.budget) {
      reasoning.push('Price exceeds your stated budget');
    }
  } else if (decideData.budget && decideData.price > decideData.budget && !decideData.saved) {
    category = 'SAVE_FOR_IT';
    title = 'Save for this purchase';
    confidence = 'high';
    reasoning = [`Price (${fmt(decideData.price)}) exceeds your budget (${fmt(decideData.budget)})`, 'Consider saving before buying', 'This prevents financial strain'];
  } else if (impulseSignals >= 4) {
    category = 'PROBABLY_SKIP';
    title = 'Probably skip this one';
    confidence = 'medium';
    reasoning = ['Multiple impulse signals detected', 'Desire appears recent or socially influenced', 'Consider whether you will still want it in a month'];
  } else if (impulseSignals >= 2 || decideData.duration === 'hours') {
    category = 'WAIT_AND_REASSESS';
    title = 'Wait before deciding';
    confidence = 'medium';
    reasoning = ['A waiting period can help distinguish lasting preference from temporary excitement', 'Reassess after the timer expires'];
    if (decideData.price < 1000) waitHours = 24;
    else if (decideData.price < 3000) waitHours = 72;
    else if (decideData.price < 10000) waitHours = 168;
    else waitHours = 336;
  } else if (!decideData.budget && !decideData.saved) {
    category = 'INSUFFICIENT_INFORMATION';
    title = 'Not enough information';
    confidence = 'low';
    reasoning = ['Affordability is uncertain without budget information', 'Consider entering the money available to spend'];
  } else {
    category = 'BUY_IF_AFFORDABLE';
    title = 'Buy if affordable';
    confidence = 'medium';
    reasoning = ['Purchase appears reasonable based on your answers', 'Confirm it fits your available spending money'];
  }
  
  if (decideData.dealStatus === 'discount' || decideData.dealStatus === 'both') {
    reasoning.push('Remember: a discount is not savings unless you were already going to buy it');
  }
  if (decideData.credit) {
    reasoning.push('Using credit adds repayment obligations and potential interest costs');
  }
  
  const unknowns = [];
  if (!decideData.budget) unknowns.push('Available spending budget');
  if (decideData.dealStatus === 'unsure') unknowns.push('Whether the price is genuine');
  
  decideData.recommendation = {
    recommendation_category: category,
    recommendation_title: title,
    confidence_level: confidence,
    reasoning: reasoning,
    financial_impact: {
      purchase_amount: decideData.price,
      currency_code: decideData.currency,
      budget_difference: decideData.budget ? decideData.budget - decideData.price : null,
      budget_status: decideData.budget ? (decideData.price > decideData.budget ? 'over' : 'under') : 'unknown'
    },
    relevant_unknowns: unknowns,
    suggested_wait_hours: waitHours,
    suggested_next_step: waitHours > 0 ? `Reassess after ${waitHours} hours` : 'Make your decision'
  };
  
  decideStep = 7;
  openDecideModal();
}

function startWaiting(hours) {
  const assessment = {
    id: uid(),
    product: decideData.product,
    price: decideData.price,
    currency: decideData.currency,
    status: 'waiting',
    recommendation: decideData.recommendation.recommendation_category,
    recTitle: decideData.recommendation.recommendation_title,
    created: Date.now(),
    due: Date.now() + hours * 3600000,
    answers: { ...decideData }
  };
  state.assessments.push(assessment);
  const addedGoal = assessment.recommendation === 'SAVE_FOR_IT' ? ensureSavingsGoalForAssessment(assessment) : null;
  saveState();
  closeModal();
  render();
  switchTab('home');
  showToast('Timer started · Reassess in ' + (hours >= 24 ? (hours/24) + ' days' : hours + ' hours') + (addedGoal ? ' · Added to Savings' : ''));
}

function markPurchased() {
  const assessment = {
    id: uid(),
    product: decideData.product,
    price: decideData.price,
    currency: decideData.currency,
    status: 'done',
    outcome: 'purchased',
    recommendation: decideData.recommendation?.recommendation_category || 'BUY_IF_AFFORDABLE',
    recTitle: decideData.recommendation?.recommendation_title || 'Purchased',
    created: Date.now(),
    answers: { ...decideData }
  };
  state.assessments.push(assessment);
  saveState();
  closeModal();
  render();
  showToast('Purchase recorded');
}

function markSkipped() {
  const assessment = {
    id: uid(),
    product: decideData.product,
    price: decideData.price,
    currency: decideData.currency,
    status: 'done',
    outcome: 'skipped',
    recommendation: decideData.recommendation?.recommendation_category || 'PROBABLY_SKIP',
    recTitle: decideData.recommendation?.recommendation_title || 'Skipped',
    created: Date.now(),
    answers: { ...decideData }
  };
  state.assessments.push(assessment);
  saveState();
  closeModal();
  render();
  showToast('Purchase skipped');
}

function openAssessment(id) {
  const a = state.assessments.find(x => x.id === id);
  if (!a) return;
  if (a.status === 'waiting') {
    const modal = document.getElementById('modal-content');
    const hoursLeft = Math.max(0, Math.round((a.due - Date.now()) / 3600000));
    modal.innerHTML = `
      <div class="modal-handle"></div>
      <div class="wizard-question">Reassess: ${a.product}</div>
      <div style="background:var(--accent-light);border-radius:12px;padding:14px;margin-bottom:16px;text-align:center">
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px">Time remaining</div>
        <div style="font-size:24px;font-weight:800;color:var(--accent)">${hoursLeft}h</div>
      </div>
      <div style="font-size:24px;font-weight:800;margin-bottom:16px">${fmt(a.price)}</div>
      <div class="option-list" style="margin-bottom:16px">
        <div class="option-item" onclick="completeAssessment('${a.id}','purchased')">
          Buy it now
          <div class="check"></div>
        </div>
        <div class="option-item" onclick="extendAssessment('${a.id}',24)">
          Wait 24 more hours
          <div class="check"></div>
        </div>
        <div class="option-item" onclick="extendAssessment('${a.id}',168)">
          Wait 7 more days
          <div class="check"></div>
        </div>
        <div class="option-item" onclick="completeAssessment('${a.id}','skipped')">
          Skip this purchase
          <div class="check"></div>
        </div>
        <div class="option-item" onclick="completeAssessment('${a.id}','saving')">
          Save for it
          <div class="check"></div>
        </div>
      </div>
      <button class="btn btn-secondary" onclick="closeModal()" style="width:100%">Close</button>
    `;
    document.getElementById('modal-overlay').classList.add('show');
  } else {
    const modal = document.getElementById('modal-content');
    modal.innerHTML = `
      <div class="modal-handle"></div>
      <div class="wizard-question">${a.product}</div>
      <div style="font-size:24px;font-weight:800;margin-bottom:16px">${fmt(a.price)}</div>
      <div class="rec-card">
        <div class="rec-category">${a.recommendation?.replace(/_/g, ' ') || 'COMPLETED'}</div>
        <div class="rec-title">${a.recTitle}</div>
      </div>
      <div style="background:var(--bg);border-radius:12px;padding:14px;margin-bottom:16px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px">Outcome</div>
        <div style="font-size:16px;font-weight:700">${a.outcome === 'purchased' ? 'Purchased' : a.outcome === 'skipped' ? 'Decided against' : a.outcome === 'saving' ? 'Saving for it' : 'Completed'}</div>
      </div>
      <button class="btn btn-secondary" onclick="closeModal()" style="width:100%">Close</button>
    `;
    document.getElementById('modal-overlay').classList.add('show');
  }
}

function completeAssessment(id, outcome) {
  const a = state.assessments.find(x => x.id === id);
  if (a) {
    a.status = 'done';
    a.outcome = outcome;
    if (outcome === 'saving') ensureSavingsGoalForAssessment(a);
    saveState();
    closeModal();
    render();
    showToast(outcome === 'saving' ? 'Added to Savings as a goal' : 'Assessment updated: ' + outcome);
  }
}

function extendAssessment(id, hours) {
  const a = state.assessments.find(x => x.id === id);
  if (a) {
    a.due = Date.now() + hours * 3600000;
    saveState();
    closeModal();
    render();
    showToast('Timer extended');
  }
}

// ============ MODAL ============
function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modal-overlay').classList.remove('show');
}

// ============ LIST POPUP ============
function showActiveSubs() {
  const activeSubs = state.subs.filter(s => s.status === 'active');
  const content = document.getElementById('list-popup-content');
  
  if (activeSubs.length === 0) {
    content.innerHTML = `
      <div class="list-popup-title">
        Active Subscriptions
        <button class="detail-back" onclick="closeListPopup()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="empty-state" style="padding:30px 0">
        <div class="empty-icon">${icon('clipboard', 36)}</div>
        <div class="empty-title">No active subscriptions</div>
        <div class="empty-text">Add your first subscription to start tracking.</div>
      </div>
    `;
  } else {
    content.innerHTML = `
      <div class="list-popup-title">
        Active Subscriptions (${activeSubs.length})
        <button class="detail-back" onclick="closeListPopup()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      ${activeSubs.map(s => {
        const logoColor = CAT_COLORS[s.category] || '#64748b';
        const nr = nextRenewal(s);
        return `
          <div class="list-popup-item" onclick="closeListPopup();openDetail('${s.id}')">
            <div class="lp-icon" style="background:${logoColor}">${s.name.charAt(0).toUpperCase()}</div>
            <div class="lp-info">
              <div class="lp-name">${s.name}</div>
              <div class="lp-meta">${s.category} · Renews ${fmtDate(nr)}</div>
            </div>
            <div class="lp-price">${fmt(s.price)}</div>
          </div>
        `;
      }).join('')}
    `;
  }
  document.getElementById('list-popup').classList.add('show');
}

function showUpcomingBills() {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const upcoming = state.subs.filter(s => s.status === 'active')
    .map(s => ({ sub: s, date: nextRenewal(s) }))
    .filter(({ date }) => date <= in30)
    .sort((a, b) => a.date - b.date);
  
  const content = document.getElementById('list-popup-content');
  
  if (upcoming.length === 0) {
    content.innerHTML = `
      <div class="list-popup-title">
        Upcoming Bills
        <button class="detail-back" onclick="closeListPopup()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="empty-state" style="padding:30px 0">
        <div class="empty-icon">${icon('calendar', 36)}</div>
        <div class="empty-title">No upcoming bills</div>
        <div class="empty-text">No subscriptions renewing in the next 30 days.</div>
      </div>
    `;
  } else {
    content.innerHTML = `
      <div class="list-popup-title">
        Upcoming Bills (${upcoming.length})
        <button class="detail-back" onclick="closeListPopup()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      ${upcoming.map(({ sub, date }) => {
        const logoColor = CAT_COLORS[sub.category] || '#64748b';
        const days = daysUntil(date);
        return `
          <div class="list-popup-item" onclick="closeListPopup();openDetail('${sub.id}')">
            <div class="lp-icon" style="background:${logoColor}">${sub.name.charAt(0).toUpperCase()}</div>
            <div class="lp-info">
              <div class="lp-name">${sub.name}</div>
              <div class="lp-meta">${fmtDate(date)} · ${days} days ${days <= 7 ? '· <span style="color:var(--warning);font-weight:600">Soon</span>' : ''}</div>
            </div>
            <div class="lp-price">${fmt(sub.price)}</div>
          </div>
        `;
      }).join('')}
    `;
  }
  document.getElementById('list-popup').classList.add('show');
}

function closeListPopup(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('list-popup').classList.remove('show');
}

// ============ MONTH PICKER ============
function openMonthPicker() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();
  const activeSubs = state.subs.filter(s => s.status === 'active');
  
  const content = document.getElementById('list-popup-content');
  content.innerHTML = `
    <div class="list-popup-title">
      Select Month
      <button class="detail-back" onclick="closeListPopup()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:16px">View spending overview for a specific month</div>
    <div class="month-grid">
      ${months.map((m, i) => {
        const count = activeSubs.reduce((n, s) => n + renewalsIn(s, now.getFullYear(), i), 0);
        const total = activeSubs.reduce((t, s) => t + renewalsIn(s, now.getFullYear(), i) * s.price, 0);
        const isSelected = i === selectedMonth;
        return `
          <div class="month-grid-item ${isSelected ? 'selected' : ''}" onclick="selectMonthFromPicker(${i})">
            <div class="mg-name">${m}</div>
            <div class="mg-total">${count} subs · ${fmt(total)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  document.getElementById('list-popup').classList.add('show');
}

function updatePeriodLabel() {
  const label = document.getElementById('period-label');
  if (!label) return;
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  label.textContent = selectedMonth === now.getMonth() && selectedMonthYear === now.getFullYear()
    ? 'This Month'
    : months[selectedMonth] + (selectedMonthYear !== now.getFullYear() ? ' ' + selectedMonthYear : '');
}

function selectMonthFromPicker(month) {
  selectedMonth = month;
  selectedMonthYear = new Date().getFullYear();
  closeListPopup();
  renderHome();
}

function selectMonthChip(month) {
  selectedMonth = month;
  selectedMonthYear = new Date().getFullYear();
  renderHome();
}

// ============ SAVINGS TRACKER ============
function savingsIntervalDates(interval, from = new Date()) {
  const d = new Date(from); d.setHours(0,0,0,0);
  if (interval === 'Daily') d.setDate(d.getDate()+1);
  else if (interval === 'Weekly') d.setDate(d.getDate()+7);
  else d.setMonth(d.getMonth()+1);
  return d;
}
function savingsGoalTotal(goal) {
  return (state.savingsEntries || []).filter(e => e.goalId === goal.id && e.type === 'saved').reduce((n,e)=>n+Number(e.amount||0),0)
    - (state.savingsEntries || []).filter(e => e.goalId === goal.id && e.type === 'spent').reduce((n,e)=>n+Number(e.amount||0),0);
}
function savingsDueKey(goal) {
  const now = new Date();
  if ((goal.interval || 'Weekly') === 'Daily') return toISO(now);
  if ((goal.interval || 'Weekly') === 'Weekly') { const d=new Date(now); d.setDate(d.getDate()-((d.getDay()+6)%7)); return toISO(d); }
  return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
}
function renderSavings() {
  const list=document.getElementById('savings-goals'); if(!list) return;
  const goals=state.savingsGoals||[], entries=state.savingsEntries||[];
  list.innerHTML=goals.length ? goals.map(g=>{
    const saved=savingsGoalTotal(g), target=Number(g.amount||0), pct=target>0?Math.max(0,Math.min(100,saved/target*100)):0;
    let guidance='';
    if(g.mode==='habit') guidance=`Target ${fmt(target)} ${String(g.interval||'Weekly').toLowerCase()}`;
    else if(g.deadline){const days=Math.max(1,Math.ceil((parseISO(g.deadline)-new Date())/86400000)); guidance=`Save about ${fmt(Math.max(0,target-saved)/days)} per day · ${fmt(Math.max(0,target-saved)/days*7)} per week · ${fmt(Math.max(0,target-saved)/days*30.4375)} per month`}
    else guidance='Set a deadline to calculate your daily, weekly and monthly target.';
    return `<article class="savings-goal-card"><div class="savings-goal-top"><div class="goal-symbol">${g.mode==='habit'?'↻':'◎'}</div><div class="savings-goal-title"><strong>${esc(g.name)}</strong><span>${g.mode==='habit'?'Saving habit':'Target goal'}${g.sourceProduct?' · From Decide':''}${g.deadline?' · Due '+esc(g.deadline):''}</span></div><button class="text-icon-btn" onclick="openSavingsEntryModal('saved','${g.id}')" aria-label="Record savings">＋</button></div><div class="goal-amount-row"><strong>${fmt(saved)}</strong><span>of ${fmt(target)}</span></div><div class="goal-progress"><span style="width:${pct}%"></span></div><div class="goal-guidance">${guidance}</div><div class="goal-card-actions"><button class="btn btn-secondary" onclick="openSavingsEntryModal('saved','${g.id}')">Add saved</button><button class="btn btn-secondary" onclick="openSavingsEntryModal('spent','${g.id}')">Record spent</button><button class="text-icon-btn danger-text" onclick="deleteSavingsGoal('${g.id}')">${icon('trash',15)}</button></div></article>`;
  }).join('') : '<div class="savings-empty"><div class="savings-empty-icon">◎</div><strong>No savings goals yet</strong><p>Create a goal for something you want, or set a regular amount to save.</p></div>';
  const activity=document.getElementById('savings-activity');
  activity.innerHTML=entries.length ? entries.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8).map(e=>{const g=goals.find(x=>x.id===e.goalId);return `<div class="savings-activity-row"><div class="activity-dot ${e.type}">${e.type==='saved'?'↓':'↑'}</div><div class="activity-copy"><strong>${esc(g?g.name:'General savings')}</strong><span>${esc(e.date)} · ${e.type==='saved'?'Saved':'Spent'}</span></div><strong class="${e.type==='saved'?'saved-text':'spent-text'}">${e.type==='saved'?'+':'−'}${fmt(Number(e.amount))}</strong></div>`}).join(''):'<div class="muted-note">Your saved and spent entries will appear here.</div>';
  const due=document.getElementById('savings-due'); if(due) due.innerHTML=''; // check-ins now appear as a global popup (see checkSavingsReminders)
}
let savingsWizard = { step: 0, name: '', mode: 'goal', amount: '', deadline: '', interval: 'Weekly', reminderTime: '20:00' };
function openSavingsGoalModal(){
 savingsWizard={step:0,name:'',mode:'goal',amount:'',deadline:'',interval:'Weekly',reminderTime:'20:00'};
 renderSavingsGoalStep();
}
function renderSavingsGoalStep(){
 const w=savingsWizard, modal=document.getElementById('modal-content');
 const head=`<div class="modal-handle"></div><div class="wizard-progress"><div class="wizard-progress-bar" style="width:${(w.step+1)*25}%"></div></div>`;
 let body='';
 if(w.step===0) body=`<div class="wizard-question">What are you saving for?</div><p class="modal-copy">Give this plan a name and choose the kind of savings goal.</p><div class="form-group"><label class="form-label">Goal name</label><input class="form-input" id="sg-name" placeholder="e.g. New laptop, emergency fund" value="${esc(w.name)}"></div><div class="form-group"><label class="form-label">Plan type</label><div class="option-list"><div class="option-item ${w.mode==='goal'?'selected':''}" onclick="savingsWizard.mode='goal';renderSavingsGoalStep()">Save towards a target <span class="check">${w.mode==='goal'?icon('check',14):''}</span></div><div class="option-item ${w.mode==='habit'?'selected':''}" onclick="savingsWizard.mode='habit';renderSavingsGoalStep()">Save a set amount regularly <span class="check">${w.mode==='habit'?icon('check',14):''}</span></div></div></div>`;
 if(w.step===1) body=`<div class="wizard-question">${w.mode==='goal'?'What is your target amount?':'How much do you want to save each interval?'}</div><p class="modal-copy">Enter the amount in your default currency (${esc(state.settings.currency)}).</p><div class="form-group"><label class="form-label">Amount (${esc(state.settings.currency)})</label><input class="form-input" type="number" min="0.01" step="0.01" id="sg-amount" placeholder="e.g. 500" value="${esc(String(w.amount||''))}"></div>`;
 if(w.step===2) body=`<div class="wizard-question">When do you want to reach it?</div><p class="modal-copy">Choose a target date and Budgit will calculate a daily, weekly and monthly savings pace. You can skip this for now.</p><div class="cal-selected" id="sg-date-label">${w.deadline?esc(fmtDateFull(w.deadline)):'No date chosen'}</div>${calendar('sg-deadline',w.deadline,'setSavingsDeadline',{min:toISO(new Date())})}<button type="button" class="cal-clear" onclick="clearSavingsDeadline()">Skip · no target date</button>`;
 if(w.step===3){body=`<div class="wizard-question">When should Budgit check in?</div><p class="modal-copy">A popup will appear over whatever you are doing at the selected interval and time, while Budgit is open.</p><div class="form-group"><label class="form-label">Check-in interval</label><div class="option-list">${['Daily','Weekly','Monthly'].map(i=>`<div class="option-item ${w.interval===i?'selected':''}" onclick="savingsWizard.interval='${i}';renderSavingsGoalStep()">${i}<span class="check">${w.interval===i?icon('check',14):''}</span></div>`).join('')}</div></div><div class="form-group"><label class="form-label">Check-in time</label>${clockPickerHTML(w.reminderTime)}</div>`;}
 modal.innerHTML=head+body+`<div class="wizard-nav">${w.step>0?'<button class="btn btn-secondary" onclick="savingsGoalBack()">Back</button>':'<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>'}<button class="btn btn-primary" onclick="savingsGoalNext()">${w.step===3?'Create plan':'Continue'}</button></div>`;
 document.getElementById('modal-overlay').classList.add('show');
 if(w.step===3) clockDraw();
}
function collectSavingsWizardStep(){const w=savingsWizard;if(w.step===0){w.name=document.getElementById('sg-name')?.value.trim()||'';w.mode=w.mode||'goal'}if(w.step===1)w.amount=document.getElementById('sg-amount')?.value||'';}
function savingsGoalBack(){collectSavingsWizardStep();savingsWizard.step=Math.max(0,savingsWizard.step-1);renderSavingsGoalStep()}
function savingsGoalNext(){collectSavingsWizardStep();const w=savingsWizard;if(w.step===0&&!w.name){showToast('Give your savings plan a name');return}if(w.step===1&&(!Number.isFinite(Number(w.amount))||Number(w.amount)<=0)){showToast('Enter an amount greater than zero');return}if(w.step===2&&w.deadline&&w.deadline<toISO(new Date())){showToast('Choose a future target date');return}if(w.step<3){w.step++;renderSavingsGoalStep();return}const ng={id:uid(),name:w.name,amount:Number(w.amount),mode:w.mode,deadline:w.mode==='goal'?w.deadline:'',interval:w.interval,reminderTime:w.reminderTime,created:toISO(new Date()),lastPromptKey:''};if(new Date().toTimeString().slice(0,5)>=ng.reminderTime)ng.lastPromptKey=savingsDueKey(ng);state.savingsGoals.push(ng);saveState();closeModal();renderSavings();showToast('Savings plan created')}
function saveSavingsGoal(){savingsGoalNext()}
function openSavingsEntryModal(type='saved',goalId='') {const goals=state.savingsGoals||[];savingsEntryDate=toISO(new Date());document.getElementById('modal-content').innerHTML=`<div class="modal-handle"></div><div class="wizard-question">Record ${type==='saved'?'money saved':'money spent'}</div><div class="form-group"><label class="form-label">Savings plan</label><select class="form-input" id="se-goal"><option value="">General savings (no goal)</option>${goals.map(g=>`<option value="${g.id}" ${g.id===goalId?'selected':''}>${esc(g.name)}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Entry type</label><select class="form-input" id="se-type"><option value="saved" ${type==='saved'?'selected':''}>Money saved</option><option value="spent" ${type==='spent'?'selected':''}>Money spent from savings</option></select></div><div class="form-group"><label class="form-label">Amount (${esc(state.settings.currency)})</label><input class="form-input" type="number" min="0.01" step="0.01" id="se-amount" placeholder="0.00"></div><div class="form-group"><label class="form-label">Date</label><button type="button" class="date-field" onclick="toggleEntryCalendar()"><span id="se-date-label">Today</span>${icon('calendar',18)}</button><div class="se-cal-wrap" id="se-cal-wrap" hidden>${calendar('se-date',savingsEntryDate,'setSavingsEntryDate',{max:toISO(new Date())})}</div></div><div class="wizard-nav"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveSavingsEntry()">Save entry</button></div>`;document.getElementById('modal-overlay').classList.add('show')}
function saveSavingsEntry(){const amount=Number(document.getElementById('se-amount').value),goalId=document.getElementById('se-goal').value,type=document.getElementById('se-type').value,date=savingsEntryDate;if(!Number.isFinite(amount)||amount<=0||!date){showToast('Enter a valid amount and date');return}state.savingsEntries.push({id:uid(),goalId,type,amount,date});saveState();closeModal();renderSavings();showToast(type==='saved'?'Savings recorded':'Spending recorded')}
function checkSavingsHabit(id){openSavingsCheckin(id)}

function deleteSavingsGoal(id){if(!confirm('Delete this savings goal? Its activity history will remain as general activity.'))return;state.savingsGoals=state.savingsGoals.filter(g=>g.id!==id);state.savingsEntries.forEach(e=>{if(e.goalId===id)e.goalId=''});saveState();renderSavings()}


// ============ DECIDE -> SAVINGS LINK ============
// Creates (or finds) the savings goal that belongs to a "Save for it" assessment.
function ensureSavingsGoalForAssessment(a) {
  if (!a || !a.product) return null;
  state.savingsGoals = state.savingsGoals || [];
  let g = state.savingsGoals.find(x => x.assessmentId === a.id) ||
          state.savingsGoals.find(x => !x.assessmentId && x.sourceProduct === a.product);
  if (!g) {
    g = { id: uid(), name: a.product, amount: Number(a.price) || 0, mode: 'goal', deadline: '', interval: 'Weekly', reminderTime: '20:00', created: toISO(new Date()), lastPromptKey: '', sourceProduct: a.product, assessmentId: a.id };
    if (new Date().toTimeString().slice(0, 5) >= g.reminderTime) g.lastPromptKey = savingsDueKey(g);
    state.savingsGoals.push(g);
  } else if (!g.assessmentId) g.assessmentId = a.id;
  a.goalCreated = true; // so deleting the goal later does not make it reappear
  return g;
}
// Catches assessments saved before this link existed (e.g. a demo product already marked "Saving").
function syncAssessmentGoals() {
  // Reconcile Decide assessments against Savings on every app startup. Older builds
  // could mark goalCreated=true even when the linked goal was never persisted.
  let changed = false;
  (state.assessments || []).forEach(a => {
    const shouldLink = a.outcome === 'saving' ||
      (a.status === 'waiting' && a.recommendation === 'SAVE_FOR_IT');
    if (!shouldLink || !a.product) return;
    const linked = (state.savingsGoals || []).some(g =>
      g.assessmentId === a.id ||
      (!g.assessmentId && String(g.sourceProduct || '').trim().toLowerCase() === String(a.product).trim().toLowerCase())
    );
    if (!linked || !a.goalCreated) {
      ensureSavingsGoalForAssessment(a);
      changed = true;
    }
  });
  if (changed) saveState();
}
function saveForPurchase() {
  const assessment = {
    id: uid(), product: decideData.product, price: decideData.price, currency: decideData.currency,
    status: 'done', outcome: 'saving',
    recommendation: decideData.recommendation?.recommendation_category || 'SAVE_FOR_IT',
    recTitle: decideData.recommendation?.recommendation_title || 'Save for this purchase',
    created: Date.now(), answers: { ...decideData }
  };
  state.assessments.push(assessment);
  ensureSavingsGoalForAssessment(assessment);
  saveState();
  closeModal();
  render();
  showToast('Added to Savings as a goal');
}

// ============ SAVINGS: IN-APP DATE PICKERS ============
let savingsEntryDate = '';
function setSavingsDeadline(iso) {
  savingsWizard.deadline = iso;
  const l = document.getElementById('sg-date-label'); if (l) l.textContent = fmtDateFull(iso);
}
function clearSavingsDeadline() { savingsWizard.deadline = ''; renderSavingsGoalStep(); }
function setSavingsEntryDate(iso) {
  savingsEntryDate = iso;
  const l = document.getElementById('se-date-label'); if (l) l.textContent = iso === toISO(new Date()) ? 'Today · ' + fmtDateFull(iso) : fmtDateFull(iso);
  const w = document.getElementById('se-cal-wrap'); if (w) w.hidden = true;
}
function toggleEntryCalendar() {
  const w = document.getElementById('se-cal-wrap'); if (!w) return;
  w.hidden = !w.hidden;
  const l = document.getElementById('se-date-label');
  if (l && l.textContent === 'Today') l.textContent = 'Today · ' + fmtDateFull(savingsEntryDate);
}

// ============ IN-APP CLOCK PICKER (no browser time input) ============
const CLK = { h: 8, m: 0, pm: true, mode: 'hour', dragging: false };
function clockPickerHTML(time) {
  const [hh, mm] = (time || '20:00').split(':').map(Number);
  CLK.pm = hh >= 12; CLK.h = hh % 12 || 12; CLK.m = mm || 0; CLK.mode = 'hour'; CLK.dragging = false;
  return `<div class="clock-picker" id="clock-picker">
    <div class="clock-readout">
      <button type="button" class="clock-seg" id="clk-h" onclick="clockSetMode('hour')"></button>
      <span class="clock-colon">:</span>
      <button type="button" class="clock-seg" id="clk-m" onclick="clockSetMode('minute')"></button>
      <div class="clock-ampm"><button type="button" id="clk-am" onclick="clockSetPeriod(false)">AM</button><button type="button" id="clk-pm" onclick="clockSetPeriod(true)">PM</button></div>
    </div>
    <div class="clock-dial" id="clock-dial" onpointerdown="clockPointer(event)" onpointermove="clockPointer(event)" onpointerup="clockPointerUp(event)" onpointercancel="clockPointerUp(event)">
      <svg viewBox="0 0 240 240" id="clock-svg" role="img" aria-label="Clock face"></svg>
    </div>
    <div class="clock-hint" id="clock-hint"></div>
  </div>`;
}
function clockSetMode(mode) { CLK.mode = mode; clockDraw(); }
function clockSetPeriod(pm) { CLK.pm = pm; clockDraw(); }
function clockDraw() {
  const hEl = document.getElementById('clk-h'); if (!hEl) return;
  const p2 = n => String(n).padStart(2, '0'), hour = CLK.mode === 'hour';
  hEl.textContent = p2(CLK.h); document.getElementById('clk-m').textContent = p2(CLK.m);
  hEl.classList.toggle('active', hour); document.getElementById('clk-m').classList.toggle('active', !hour);
  document.getElementById('clk-am').classList.toggle('active', !CLK.pm); document.getElementById('clk-pm').classList.toggle('active', CLK.pm);
  document.getElementById('clock-hint').textContent = hour ? 'Tap or drag to choose the hour' : 'Tap or drag to choose the minute';
  const R = 92, pos = (a, r) => [120 + r * Math.sin(a * Math.PI / 180), 120 - r * Math.cos(a * Math.PI / 180)];
  const ang = hour ? (CLK.h % 12) * 30 : CLK.m * 6, [sx, sy] = pos(ang, R);
  let svg = '<circle class="clock-face" cx="120" cy="120" r="116"/>';
  svg += `<line class="clock-hand" x1="120" y1="120" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}"/><circle class="clock-center" cx="120" cy="120" r="4"/><circle class="clock-sel" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="19"/>`;
  const off5 = !hour && CLK.m % 5 !== 0;
  for (let i = 0; i < 12; i++) {
    const v = hour ? (i === 0 ? 12 : i) : i * 5, a = hour ? (v % 12) * 30 : v * 6;
    const diff = Math.abs(((a - ang + 540) % 360) - 180);
    if (off5 && diff < 20) continue; // hidden under the selection bubble
    const [x, y] = pos(a, R), on = hour ? v === CLK.h : v === CLK.m;
    svg += `<text class="clock-num${on ? ' on' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${hour ? v : p2(v)}</text>`;
  }
  if (off5) svg += `<text class="clock-num on" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${p2(CLK.m)}</text>`;
  document.getElementById('clock-svg').innerHTML = svg;
  savingsWizard.reminderTime = p2((CLK.h % 12) + (CLK.pm ? 12 : 0)) + ':' + p2(CLK.m);
}
function clockPointer(e) {
  if (e.type === 'pointerdown') { CLK.dragging = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} }
  if (!CLK.dragging) return;
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  let a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
  if (a < 0) a += 360;
  if (CLK.mode === 'hour') CLK.h = Math.round(a / 30) % 12 || 12; else CLK.m = Math.round(a / 6) % 60;
  clockDraw();
}
function clockPointerUp() {
  if (!CLK.dragging) return;
  CLK.dragging = false;
  if (CLK.mode === 'hour') { CLK.mode = 'minute'; clockDraw(); } // hour chosen -> go straight to minutes
}

// ============ GLOBAL SAVINGS CHECK-IN POPUP ============
// Roughly how much should be saved per interval for this plan (0 = no fixed pace).
function savingsPaceAmount(g) {
  if (g.mode === 'habit') return Number(g.amount) || 0;
  if (g.deadline) {
    const remaining = Math.max(0, Number(g.amount) - savingsGoalTotal(g));
    const days = Math.max(1, Math.ceil((parseISO(g.deadline) - new Date()) / 86400000));
    const perInterval = { Daily: 1, Weekly: 7, Monthly: 30.4375 }[g.interval || 'Weekly'] || 7;
    return Math.round(Math.min(remaining, remaining / days * perInterval) * 100) / 100;
  }
  return 0;
}
function pendingSavingsCheckins() {
  const now = new Date(), nowTime = now.toTimeString().slice(0, 5), ts = now.getTime();
  return (state.savingsGoals || []).filter(g =>
    g.lastPromptKey !== savingsDueKey(g) && nowTime >= (g.reminderTime || '20:00') &&
    !(g.snoozeUntil && ts < g.snoozeUntil) &&
    (g.mode === 'habit' || savingsGoalTotal(g) < Number(g.amount || 0)));
}
function checkSavingsReminders() {
  const ov = document.getElementById('checkin-overlay');
  if (!ov || ov.classList.contains('show')) return;
  const due = pendingSavingsCheckins()[0];
  if (due) openSavingsCheckin(due.id);
}
function openSavingsCheckin(id) {
  const g = (state.savingsGoals || []).find(x => x.id === id); if (!g) return;
  const pace = savingsPaceAmount(g), every = String(g.interval || 'Weekly');
  const when = every === 'Daily' ? 'today' : every === 'Weekly' ? 'this week' : 'this month';
  const q = pace > 0 ? `Did you save ${fmt(pace)} ${when} for <b>${esc(g.name)}</b>?` : `Did you put anything aside ${when} for <b>${esc(g.name)}</b>?`;
  document.getElementById('checkin-card').innerHTML = `
    <div class="checkin-badge">Savings check-in</div>
    <div class="goal-symbol checkin-symbol">${g.mode === 'habit' ? '↻' : '◎'}</div>
    <div class="wizard-question">Time to check in</div>
    <p class="modal-copy">${q}</p>
    <div class="form-group" style="text-align:left"><label class="form-label">How much did you save? (${esc(state.settings.currency)})</label>
      <input class="form-input" id="checkin-amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${pace > 0 ? pace : ''}"></div>
    <div class="checkin-actions">
      <button class="btn btn-secondary" onclick="finishSavingsCheckin('${g.id}',false)">Not this time</button>
      <button class="btn btn-primary" onclick="finishSavingsCheckin('${g.id}',true)">Record savings</button>
    </div>
    <button class="checkin-later" onclick="snoozeSavingsCheckin('${g.id}')">Remind me in 10 minutes</button>`;
  document.getElementById('checkin-overlay').classList.add('show');
}
function closeSavingsCheckin() { document.getElementById('checkin-overlay').classList.remove('show'); }
function finishSavingsCheckin(id, saved) {
  const g = (state.savingsGoals || []).find(x => x.id === id);
  if (!g) { closeSavingsCheckin(); return; }
  const amount = Number(document.getElementById('checkin-amount')?.value || 0);
  if (saved && (!Number.isFinite(amount) || amount <= 0)) { showToast('Enter the amount you saved'); return; }
  if (saved) state.savingsEntries.push({ id: uid(), goalId: id, type: 'saved', amount, date: toISO(new Date()) });
  g.lastPromptKey = savingsDueKey(g); delete g.snoozeUntil;
  saveState(); closeSavingsCheckin(); renderSavings();
  showToast(saved ? 'Savings recorded' : 'Check-in completed');
  setTimeout(checkSavingsReminders, 450); // another plan may be due too
}
function snoozeSavingsCheckin(id) {
  const g = (state.savingsGoals || []).find(x => x.id === id);
  if (g) { g.snoozeUntil = Date.now() + 10 * 60000; saveState(); }
  closeSavingsCheckin(); showToast('Okay, I will remind you in 10 minutes');
}

// ============ SETTINGS ============
function toggleDark() {
  state.settings.dark = !state.settings.dark;
  document.documentElement.setAttribute('data-theme', state.settings.dark ? 'dark' : '');
  saveState();
  render();
}

function openBudgetModal() {
  const modal = document.getElementById('modal-content');
  modal.innerHTML = `
    <div class="modal-handle"></div>
    <div class="wizard-question">Monthly Budget</div>
    <div class="form-group">
      <label class="form-label">Amount (optional)</label>
      <input class="form-input" type="number" id="budget-input" placeholder="e.g. 1500" value="${state.settings.budget || ''}">
    </div>
    <div class="option-item ${state.settings.budgetIncludesSubs ? 'selected' : ''}" onclick="this.classList.toggle('selected');state.settings.budgetIncludesSubs=this.classList.contains('selected')" style="margin-bottom:16px">
      My budget already includes subscriptions
      <div class="check">${state.settings.budgetIncludesSubs ? icon('check', 14) : ''}</div>
    </div>
    <div class="wizard-nav">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveBudget()">Save</button>
    </div>
  `;
  document.getElementById('modal-overlay').classList.add('show');
}

function saveBudget() {
  const val = parseFloat(document.getElementById('budget-input').value);
  state.settings.budget = val > 0 ? val : null;
  saveState();
  closeModal();
  render();
  showToast('Budget updated');
}

function eraseData() {
  if (confirm('Erase all data? This cannot be undone.')) {
    localStorage.removeItem(STORAGE_KEY);
    fileClear().catch(() => {});
    state = defaultState();
    render();
    showToast('All data erased');
  }
}

function openOnboarding() {
  const modal = document.getElementById('modal-content');
  modal.innerHTML = `
    <div class="modal-handle"></div>
    <div style="text-align:center;padding:20px 0">
      <div class="empty-icon">${icon('wallet', 36)}</div>
      <div class="wizard-question">Welcome to Budgit</div>
      <div style="font-size:14px;color:var(--text2);line-height:1.6;margin-bottom:24px">
        Spend with intention. Know what you're paying for. Think before you buy. Make your money count.
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="background:var(--accent-light);border-radius:12px;padding:14px;text-align:left">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;display:flex;align-items:center;gap:8px">${icon('clipboard', 16)} Track your subscriptions</div>
          <div style="font-size:12px;color:var(--text2)">Know what is due and when</div>
        </div>
        <div style="background:var(--accent-light);border-radius:12px;padding:14px;text-align:left">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;display:flex;align-items:center;gap:8px">${icon('help', 16)} Think before you spend</div>
          <div style="font-size:12px;color:var(--text2)">Make more deliberate purchase decisions</div>
        </div>
        <div style="background:var(--accent-light);border-radius:12px;padding:14px;text-align:left">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;display:flex;align-items:center;gap:8px">${icon('chart', 16)} Understand your spending</div>
          <div style="font-size:12px;color:var(--text2)">See patterns and opportunities to save</div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="closeModal()" style="margin-top:24px">Get Started</button>
    </div>
  `;
  document.getElementById('modal-overlay').classList.add('show');
}

// ============ INIT ============
function init() {
  if (state.settings.dark) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  syncAssessmentGoals();
  render();
}

init();
// In-app reminder checks run while Budgit is open; browsers do not run this timer after the tab is closed.
setInterval(checkSavingsReminders, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSavingsReminders(); });
window.addEventListener('focus', checkSavingsReminders);
setTimeout(checkSavingsReminders, 1200);

// Load exchange rates for mixed-currency subscriptions without blocking the interface.
window.addEventListener('load', () => refreshExchangeRates());
