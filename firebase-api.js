'use strict';
/* WEDA — Firebase data layer (no Node, no npm, no server).
   It answers the same "/api/..." calls the screens already make, but uses Firebase Auth + Cloud Firestore.
   Real enforcement of who-can-do-what lives in firestore.rules (see README). */
(() => {
const CFG = {
  apiKey: 'AIzaSyBXIonUY-Vm-RqkVUYzwOBtkCcKFk_CXWE',
  authDomain: 'weda-16b9e.firebaseapp.com',
  projectId: 'weda-16b9e',
  storageBucket: 'weda-16b9e.firebasestorage.app',
  messagingSenderId: '46710940238',
  appId: '1:46710940238:web:aede9471adbf9f80e6991f'
};
const CDN = 'https://www.gstatic.com/firebasejs/10.14.1/';
const ADMIN = !document.body.classList.contains('emp');
const ROLES = ADMIN ? ['super_admin', 'hr'] : ['employee'];
const TZ = 'Africa/Dar_es_Salaam';

/* ---------- SDK loading (from Google's CDN, no install) ---------- */
let SDK;
const sdk = () => SDK || (SDK = window.__WEDA_TEST_SDK ? Promise.resolve(window.__WEDA_TEST_SDK) : (async () => {
  const [A, Au, St] = await Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js')]);
  const app = A.initializeApp(CFG), auth = Au.getAuth(app), db = St.getFirestore(app);
  return { A, Au, St, app, auth, db };
})());
let S; // loaded SDK bundle

/* ---------- Errors ---------- */
const E = (msg, status = 400) => { const e = new Error(msg); e.status = status; e.isWeda = true; return e; };
const fail = E;
function toErr(e) {
  if (e && e.isWeda) return e;
  const c = (e && e.code) || ''; let m = 'Server error. Please try again.', s = 500;
  if (c === 'permission-denied') { m = 'You do not have permission for this action.'; s = 403; }
  else if (c === 'unavailable' || c === 'auth/network-request-failed') { m = 'No connection to the server. Check your network and try again.'; s = 503; }
  else if (c === 'auth/too-many-requests') { m = 'Too many failed attempts. Please wait a few minutes and try again.'; s = 429; }
  else if (c === 'failed-precondition' || c === 'not-found') { m = 'The database is not ready or the record was not found. Check the setup steps in README.md.'; s = 500; }
  console.error(e);
  const x = new Error(m); x.status = s; x.isWeda = true; return x;
}

/* ---------- Small utilities (same behaviour as the old server helpers) ---------- */
const todayStr = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s)) && parse(s).toISOString().slice(0, 10) === s;
const isMonth = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isWeekend = s => [0, 6].includes(parse(s).getUTCDay());
function eachDay(start, end) {
  const out = [];
  for (let d = parse(start); d <= parse(end) && out.length < 400; d = new Date(d.getTime() + 864e5)) out.push(d.toISOString().slice(0, 10));
  return out;
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const str = (v, min, max) => { if (typeof v !== 'string') return null; const t = v.trim(); return t.length >= min && t.length <= max ? t : null; };
const num = (v, min, max) => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
const strongPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 100 && /[A-Za-z]/.test(p) && /\d/.test(p);
const PW_RULE = 'Password must be at least 8 characters and contain letters and numbers.';
function normPhone(v) {
  if (typeof v !== 'string') return null;
  const p = v.replace(/[\s\-()]/g, '');
  return /^\+?\d{9,15}$/.test(p) ? p : null;
}
const emailOf = phone => phone.replace(/\D/g, '') + '@weda.app'; // phone number -> Firebase sign-in id
const newId = () => Math.floor(Date.now() * 1000 + Math.random() * 1000);
const like = (s, q) => String(s || '').toLowerCase().includes(q.toLowerCase());
const cleanQ = v => String(v || '').slice(0, 60).replace(/[%_\\]/g, '');

const PERMS = {
  approve_users: 'Approve or reject new employee registrations',
  manage_employees: 'Edit employee titles & salaries, suspend / reactivate accounts',
  manage_offices: 'Manage office locations and sign-in distance',
  manage_holidays: 'Manage public holidays',
  view_attendance: 'View attendance records',
  review_leave: 'Review (approve / reject) leave requests',
  view_reports: 'Read employees\u2019 daily reports',
  manage_payroll: 'Create payroll, publish it and mark payments as paid'
};
const ALL = Object.keys(PERMS);
const permsOf = u => u.role === 'super_admin' ? ALL : (Array.isArray(u.permissions) ? u.permissions.filter(p => ALL.includes(p)) : []);
const can = (u, p) => permsOf(u).includes(p);
const need = (c, ...ps) => { if (!ps.some(p => can(c.user, p))) throw E('You do not have permission for this action.', 403); };
const superOnly = c => { if (c.user.role !== 'super_admin') throw E('Super admin only.', 403); };
const publicUser = u => ({ id: u.id, full_name: u.full_name, title: u.title, phone: u.phone, role: u.role, permissions: permsOf(u), must_change: !!u.must_change, base_salary: u.base_salary });

/* ---------- Firestore helpers ---------- */
const ms = v => v && typeof v.toMillis === 'function' ? v.toMillis() : v;
const row = d => { const o = d.data(); for (const k in o) o[k] = ms(o[k]); o.id = d.id; return o; };
const rowN = d => { const o = row(d); o.id = +d.id; return o; };
const ref = (name, id) => S.St.doc(S.db, name, String(id));
const col = name => S.St.collection(S.db, name);
async function list(name, numeric, ...cons) {
  const s = await S.St.getDocs(S.St.query(col(name), ...cons));
  return s.docs.map(numeric ? rowN : row);
}
async function one(name, id, numeric) {
  const s = await S.St.getDoc(ref(name, id));
  return s.exists() ? (numeric ? rowN(s) : row(s)) : null;
}
const W = (f, op, v) => S.St.where(f, op, v);
async function count(name, ...cons) { try { return (await S.St.getCountFromServer(S.St.query(col(name), ...cons))).data().count; } catch { return 0; } }
async function commit(ops) { // ops: [['set'|'update'|'delete', ref, data]] in chunks of 400
  for (let i = 0; i < ops.length; i += 400) {
    const b = S.St.writeBatch(S.db);
    ops.slice(i, i + 400).forEach(([t, r, d]) => t === 'delete' ? b.delete(r) : b[t](r, d));
    await b.commit();
  }
}
const holidayMap = async () => new Map((await list('holidays', false)).map(r => [r.date, r.name]));
async function workingDays(start, end, hs) { hs = hs || await holidayMap(); return eachDay(start, end).filter(s => !isWeekend(s) && !hs.has(s)); }
const usersMap = async () => new Map((await list('users', false)).map(u => [u.id, u]));

/* ---------- Session / context ---------- */
let CTX = null;
async function ctx() {
  await S.auth.authStateReady();
  const u = S.auth.currentUser; if (!u) throw E('Please sign in.', 401);
  if (CTX && CTX.uid === u.uid && Date.now() - CTX.t < 15000) return CTX;
  let d = null; try { const s = await S.St.getDoc(ref('users', u.uid)); d = s.exists() ? s.data() : null; } catch { d = null; }
  if (!d || d.status !== 'active' || !ROLES.includes(d.role)) throw E('Your session has expired. Please sign in again.', 401);
  return CTX = { uid: u.uid, user: { ...d, id: u.uid }, t: Date.now() };
}
async function audit(action, detail = '') {
  try { const c = await ctx(); await S.St.addDoc(col('audit'), { user_id: c.uid, full_name: c.user.full_name, action, detail: String(detail).slice(0, 300), created_at: S.St.serverTimestamp() }); } catch (e) { console.warn('audit failed', e); }
}
async function reauth(password) {
  const u = S.auth.currentUser;
  try { await S.Au.reauthenticateWithCredential(u, S.Au.EmailAuthProvider.credential(u.email, String(password || ''))); return true; } catch (e) {
    if (e && e.code === 'auth/too-many-requests') throw toErr(e);
    return false;
  }
}

/* ---------- Routing ---------- */
const routes = [];
const R = (m, p, fn) => routes.push([m, new RegExp('^' + p.replace(/:id/g, '([^/]+)') + '$'), fn]);

async function api(url, opts = {}) {
  const method = opts.method || 'GET', [path, qs] = url.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || '')), body = opts.body || {};
  try {
    S = await sdk();
    for (const [m, re, fn] of routes) {
      if (m !== method) continue;
      const mm = re.exec(path);
      if (mm) return await fn({ q, body, p: mm.slice(1).map(decodeURIComponent) });
    }
    throw E('Not found.', 404);
  } catch (e) {
    const err = toErr(e);
    if (err.status === 401 && window.onUnauth && !url.includes('/login')) window.onUnauth();
    throw err;
  }
}
window.api = api;

/* =====================================================================
   ACCOUNT (both apps)
   ===================================================================== */
R('POST', '/api/login', async ({ body }) => {
  const idRaw = String(body.phone || '').trim(), pw = String(body.password || '').slice(0, 200);
  const phone = normPhone(idRaw), loginId = ADMIN && /^\S+@\S+\.\S+$/.test(idRaw) ? idRaw.toLowerCase() : phone ? emailOf(phone) : null; // admins may also sign in with their e-mail
  if (!loginId || !pw) throw E('Invalid phone number or password.', 401);
  let cred;
  try { cred = await S.Au.signInWithEmailAndPassword(S.auth, loginId, pw); } catch (e) {
    if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email'].includes(e.code)) throw E('Invalid phone number or password.', 401);
    throw e;
  }
  CTX = null;
  let u = null; try { const s = await S.St.getDoc(ref('users', cred.user.uid)); u = s.exists() ? { ...s.data(), id: cred.user.uid } : null; } catch {}
  const out = async (msg, code) => { await S.Au.signOut(S.auth).catch(() => {}); throw E(msg, code); };
  if (!u) await out('This account has no profile. Please contact HR.', 403);
  if (!ROLES.includes(u.role)) await out(ROLES.includes('employee') ? 'This account signs in through the Admin portal.' : 'This account signs in through the Employee app.', 403);
  if (u.status === 'pending') await out('Your account is waiting for admin approval.', 403);
  if (u.status === 'rejected') await out('Your registration was not approved. Please contact HR.', 403);
  if (u.status === 'suspended') await out('Your account is suspended. Please contact HR.', 403);
  await audit('login');
  return { user: publicUser(u) };
});
R('POST', '/api/logout', async () => { await S.Au.signOut(S.auth).catch(() => {}); CTX = null; return { ok: true }; });
R('GET', '/api/me', async () => { const c = await ctx(); return ADMIN ? { user: publicUser(c.user), perms: PERMS } : { user: publicUser(c.user) }; });
R('POST', '/api/change-password', async ({ body }) => {
  const c = await ctx(), cur = String(body.current || ''), nw = body.password;
  if (!strongPassword(nw)) throw E(PW_RULE);
  if (!(await reauth(cur))) throw E('Current password is incorrect.', 403);
  await S.Au.updatePassword(S.auth.currentUser, nw);
  if (c.user.must_change) await S.St.updateDoc(ref('users', c.uid), { must_change: false });
  CTX = null; await audit('password_changed');
  return { ok: true };
});

/* =====================================================================
   EMPLOYEE APP
   ===================================================================== */
if (!ADMIN) {
  R('POST', '/api/register', async ({ body: b }) => {
    const name = str(b.full_name, 3, 80), title = str(b.title, 2, 80), phone = normPhone(b.phone);
    if (!name || !title) throw E('Enter your full name and your job title/position.');
    if (!phone) throw E('Enter a valid phone number that can receive text messages (e.g. +255712345678).');
    if (!strongPassword(b.password)) throw E(PW_RULE);
    if (b.password !== b.confirm) throw E('Passwords do not match.');
    let cred;
    try { cred = await S.Au.createUserWithEmailAndPassword(S.auth, emailOf(phone), b.password); } catch (e) {
      if (e.code === 'auth/email-already-in-use') throw E('This phone number is already registered.', 409);
      if (e.code === 'auth/operation-not-allowed') throw E('Sign-up is not switched on yet. In Firebase Console enable Authentication -> Email/Password.', 500);
      throw e;
    }
    try {
      await S.St.setDoc(ref('users', cred.user.uid), { full_name: name, title, phone, role: 'employee', status: 'pending', permissions: [], base_salary: 0, must_change: false, created_at: Date.now() });
      await S.St.addDoc(col('audit'), { user_id: cred.user.uid, full_name: name, action: 'register', detail: phone, created_at: S.St.serverTimestamp() }).catch(() => {});
    } catch (e) { await S.Au.deleteUser(cred.user).catch(() => {}); throw e; }
    await S.Au.signOut(S.auth).catch(() => {}); CTX = null;
    return { ok: true };
  });

  const dayInfo = async (uid, date) => {
    const [hol, leaves] = await Promise.all([one('holidays', date), list('leaves', true, W('user_id', '==', uid))]);
    const lv = leaves.find(l => l.status === 'approved' && l.start_date <= date && l.end_date >= date);
    return { weekend: isWeekend(date), holiday: hol ? hol.name : null, leave: lv ? lv.type : null };
  };
  R('GET', '/api/attendance/today', async () => {
    const c = await ctx(), date = todayStr();
    const [info, rec, offices] = await Promise.all([dayInfo(c.uid, date), one('attendance', c.uid + '_' + date), list('offices', true, W('active', '==', 1))]);
    return { date, ...info, record: rec ? { date: rec.date, check_in: rec.check_in, check_out: rec.check_out, in_distance: rec.in_distance } : null,
      offices: offices.map(o => ({ id: o.id, name: o.name, lat: o.lat, lng: o.lng, radius_m: o.radius_m })) };
  });
  async function locate(body) {
    const lat = num(body.lat, -90, 90), lng = num(body.lng, -180, 180), acc = num(body.accuracy ?? 0, 0, 1e6);
    if (lat === null || lng === null) return { error: 'Your location could not be read. Turn on GPS/location and try again.' };
    if (acc > 200) return { error: `GPS signal is weak (±${Math.round(acc)} m). Move near a window or outdoors and try again.` };
    const offices = await list('offices', true, W('active', '==', 1));
    if (!offices.length) return { error: 'No office location has been set up yet. Please contact HR.' };
    let best = null;
    for (const o of offices) { const d = haversine(lat, lng, o.lat, o.lng); if (!best || d < best.d) best = { o, d }; }
    if (best.d > best.o.radius_m) return { error: `You are about ${Math.round(best.d)} m from ${best.o.name}. You must be within ${best.o.radius_m} m to sign.` };
    return { lat, lng, office: best.o, dist: Math.round(best.d) };
  }
  R('POST', '/api/attendance/checkin', async ({ body }) => {
    const c = await ctx(), date = todayStr(), i = await dayInfo(c.uid, date);
    if (i.weekend) throw E('Today is a weekend — attendance is not required.');
    if (i.holiday) throw E(`Today is a public holiday (${i.holiday}).`);
    if (i.leave) throw E(`You are on approved ${i.leave} leave today.`);
    if (await one('attendance', c.uid + '_' + date)) throw E('You have already signed in today.', 409);
    const L = await locate(body); if (L.error) throw E(L.error, 403);
    await S.St.setDoc(ref('attendance', c.uid + '_' + date), { user_id: c.uid, date, check_in: S.St.serverTimestamp(), check_out: null, in_lat: L.lat, in_lng: L.lng, in_office_id: L.office.id, in_distance: L.dist, out_lat: null, out_lng: null, out_distance: null });
    return { ok: true, office: L.office.name };
  });
  R('POST', '/api/attendance/checkout', async ({ body }) => {
    const c = await ctx(), date = todayStr(), rec = await one('attendance', c.uid + '_' + date);
    if (!rec) throw E('Sign in first before signing out.');
    if (rec.check_out) throw E('You have already signed out today.', 409);
    const L = await locate(body); if (L.error) throw E(L.error, 403);
    await S.St.updateDoc(ref('attendance', c.uid + '_' + date), { check_out: S.St.serverTimestamp(), out_lat: L.lat, out_lng: L.lng, out_distance: L.dist });
    return { ok: true };
  });
  R('GET', '/api/attendance/history', async ({ q }) => {
    const c = await ctx(), month = isMonth(q.month) ? q.month : todayStr().slice(0, 7);
    const mine = await list('attendance', false, W('user_id', '==', c.uid));
    const rows = mine.filter(r => r.date.startsWith(month + '-')).sort((a, b) => b.date.localeCompare(a.date)).map(r => ({ date: r.date, check_in: r.check_in, check_out: r.check_out, in_distance: r.in_distance }));
    const today = todayStr(), last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).toISOString().slice(0, 10);
    const end = last < today ? last : today, start = month + '-01';
    const wd = start <= end ? await workingDays(start, end) : [];
    const present = new Set(rows.map(r => r.date));
    const leaves = (await list('leaves', true, W('user_id', '==', c.uid))).filter(l => l.status === 'approved' && l.start_date <= last && l.end_date >= start);
    const onLeave = new Set(); leaves.forEach(l => eachDay(l.start_date, l.end_date).forEach(d => onLeave.add(d)));
    const leaveDays = wd.filter(d => onLeave.has(d) && !present.has(d)).length;
    const absent = wd.filter(d => !present.has(d) && !onLeave.has(d) && d !== today).length;
    return { month, rows, summary: { workingDays: wd.length, present: present.size, leave: leaveDays, absent } };
  });
  R('GET', '/api/holidays', async () => {
    await ctx(); const t = todayStr();
    return { holidays: (await list('holidays', false)).filter(h => h.date >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40).map(h => ({ date: h.date, name: h.name })) };
  });

  /* ---- Leave ---- */
  const LEAVE_TYPES = ['Annual', 'Sick', 'Maternity', 'Paternity', 'Compassionate', 'Study', 'Unpaid', 'Other'];
  R('GET', '/api/leaves/calc', async ({ q }) => {
    await ctx(); const { start, end } = q;
    if (!isDate(start) || !isDate(end) || end < start) throw E('Choose a valid start and end date.');
    if (eachDay(start, end).length > 366) throw E('Leave cannot be longer than one year.');
    const hs = await holidayMap(), all = eachDay(start, end);
    return { working: (await workingDays(start, end, hs)).length, weekends: all.filter(isWeekend).length, holidays: all.filter(d => hs.has(d) && !isWeekend(d)).map(d => ({ date: d, name: hs.get(d) })) };
  });
  R('GET', '/api/leaves', async () => {
    const c = await ctx();
    const rows = (await list('leaves', true, W('user_id', '==', c.uid))).sort((a, b) => b.id - a.id).slice(0, 100)
      .map(l => ({ id: l.id, type: l.type, start_date: l.start_date, end_date: l.end_date, days: l.days, reason: l.reason, status: l.status, review_note: l.review_note, reviewed_at: l.reviewed_at, created_at: l.created_at }));
    return { types: LEAVE_TYPES, leaves: rows };
  });
  R('POST', '/api/leaves', async ({ body }) => {
    const c = await ctx(), { type, start, end } = body, reason = str(body.reason ?? '', 0, 600);
    if (!LEAVE_TYPES.includes(type)) throw E('Choose a leave type.');
    if (!isDate(start) || !isDate(end) || end < start) throw E('Choose a valid start and end date.');
    if (start < todayStr()) throw E('Leave cannot start in the past.');
    if (eachDay(start, end).length > 366) throw E('Leave cannot be longer than one year.');
    if (reason === null) throw E('Reason is too long (max 600 characters).');
    const days = (await workingDays(start, end)).length;
    if (!days) throw E('The dates you chose are only weekends or public holidays — no leave is needed.');
    const mine = await list('leaves', true, W('user_id', '==', c.uid));
    if (mine.some(l => ['pending', 'approved'].includes(l.status) && l.start_date <= end && l.end_date >= start)) throw E('You already have a leave request that overlaps these dates.', 409);
    const id = newId();
    await S.St.setDoc(ref('leaves', id), { user_id: c.uid, type, start_date: start, end_date: end, days, reason, status: 'pending', reviewed_by: null, review_note: null, reviewed_at: null, created_at: Date.now() });
    return { ok: true, days };
  });
  R('POST', '/api/leaves/:id/cancel', async ({ p }) => {
    const c = await ctx(), l = await one('leaves', p[0], true);
    if (!l || l.user_id !== c.uid || l.status !== 'pending') throw E('Only pending requests can be cancelled.');
    await S.St.updateDoc(ref('leaves', p[0]), { status: 'cancelled' });
    return { ok: true };
  });

  /* ---- Daily report ---- */
  R('GET', '/api/reports', async () => {
    const c = await ctx();
    const rows = (await list('reports', false, W('user_id', '==', c.uid))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60)
      .map(r => ({ date: r.date, work_done: r.work_done, challenges: r.challenges, suggestions: r.suggestions, updated_at: r.updated_at }));
    return { today: todayStr(), reports: rows };
  });
  R('POST', '/api/reports', async ({ body }) => {
    const c = await ctx(), w = str(body.work_done, 10, 4000), ch = str(body.challenges ?? '', 0, 3000), s = str(body.suggestions ?? '', 0, 3000);
    if (!w) throw E('Describe what you worked on today (at least 10 characters).');
    if (ch === null || s === null) throw E('Challenges and suggestions are limited to 3000 characters each.');
    const date = todayStr(), now = Date.now(), old = await one('reports', c.uid + '_' + date);
    await S.St.setDoc(ref('reports', c.uid + '_' + date), { user_id: c.uid, date, work_done: w, challenges: ch, suggestions: s, created_at: old ? old.created_at : now, updated_at: now });
    return { ok: true };
  });

  /* ---- Payroll (only published runs are visible) ---- */
  R('GET', '/api/payroll', async () => {
    const c = await ctx();
    const items = (await list('payroll_items', true, W('user_id', '==', c.uid), W('published', '==', true))).sort((a, b) => b.month.localeCompare(a.month));
    return { items: items.map(i => ({ id: i.id, month: i.month, basic: i.basic, allowances: i.allowances, deductions: i.deductions, total_salary: i.total_salary, net_pay: i.net_pay, status: i.status, signed_at: i.signed_at, paid_at: i.paid_at, payment_ref: i.payment_ref, payment_method: i.payment_method })) };
  });
  R('POST', '/api/payroll/:id/sign', async ({ p, body }) => {
    const c = await ctx(), it = await one('payroll_items', p[0], true);
    if (!it || it.user_id !== c.uid || !it.published) throw E('Payroll record not found.', 404);
    if (it.status !== 'pending') throw E('This payroll is already signed.', 409);
    if (!(await reauth(body.password))) throw E('Wrong password — signature not accepted.', 403);
    await S.St.updateDoc(ref('payroll_items', p[0]), { status: 'signed', signed_at: S.St.serverTimestamp(), signed_name: c.user.full_name });
    await audit('payroll_signed', 'item ' + p[0]);
    return { ok: true };
  });
}

/* =====================================================================
   ADMIN / HR APP
   ===================================================================== */
if (ADMIN) {
  R('GET', '/api/stats', async () => {
    await ctx(); const d = todayStr();
    const [pu, em, pr, pl, rp, tp, appr, wd] = await Promise.all([
      count('users', W('role', '==', 'employee'), W('status', '==', 'pending')),
      count('users', W('role', '==', 'employee'), W('status', '==', 'active')),
      count('attendance', W('date', '==', d)),
      count('leaves', W('status', '==', 'pending')),
      count('reports', W('date', '==', d)),
      count('payroll_items', W('status', '==', 'signed')),
      list('leaves', true, W('status', '==', 'approved')).catch(() => []),
      workingDays(d, d).catch(() => [])
    ]);
    return { pending_users: pu, employees: em, present: pr, on_leave: appr.filter(l => l.start_date <= d && l.end_date >= d).length, pending_leaves: pl, reports: rp, to_pay: tp, today: d, working_day: wd.length === 1 };
  });

  /* ---- Employees ---- */
  R('GET', '/api/users', async ({ q }) => {
    const c = await ctx(); need(c, 'approve_users', 'manage_employees');
    const st = ['pending', 'active', 'rejected', 'suspended'].includes(q.status) ? q.status : null, s = cleanQ(q.q);
    const cons = [W('role', '==', 'employee')]; if (st) cons.push(W('status', '==', st));
    const rows = (await list('users', false, ...cons)).filter(u => !s || like(u.full_name, s) || like(u.phone, s) || like(u.title, s))
      .sort((a, b) => b.created_at - a.created_at).slice(0, 500)
      .map(u => ({ id: u.id, full_name: u.full_name, title: u.title, phone: u.phone, status: u.status, base_salary: u.base_salary, created_at: u.created_at }));
    return { users: rows };
  });
  const setStatus = (perm, from, to, label) => R('POST', '/api/users/:id/' + label, async ({ p }) => {
    const c = await ctx(); need(c, perm);
    const u = await one('users', p[0]);
    if (!u || u.role !== 'employee' || !from.includes(u.status)) throw E('That action is not possible for this account.', 409);
    await S.St.updateDoc(ref('users', p[0]), { status: to });
    await audit('user_' + label, 'user ' + p[0]);
    return { ok: true };
  });
  setStatus('approve_users', ['pending'], 'active', 'approve');
  setStatus('approve_users', ['pending'], 'rejected', 'reject');
  setStatus('manage_employees', ['active'], 'suspended', 'suspend');
  setStatus('manage_employees', ['suspended', 'rejected'], 'active', 'reactivate');
  R('PATCH', '/api/users/:id', async ({ p, body }) => {
    const c = await ctx(); need(c, 'manage_employees');
    const title = str(body.title, 2, 80), sal = num(body.base_salary, 0, 1e10), name = str(body.full_name, 3, 80);
    if (!title || !name || sal === null) throw E('Enter a name, a title and a valid salary.');
    const u = await one('users', p[0]); if (!u || u.role !== 'employee') throw E('Employee not found.', 404);
    await S.St.updateDoc(ref('users', p[0]), { full_name: name, title, base_salary: sal });
    await audit('user_edit', `user ${p[0]} salary ${sal}`);
    return { ok: true };
  });

  /* ---- Offices ---- */
  function officeBody(b) {
    const name = str(b.name, 2, 80), lat = num(b.lat, -90, 90), lng = num(b.lng, -180, 180), rad = num(b.radius_m, 10, 5000);
    return name && lat !== null && lng !== null && rad !== null ? { name, lat, lng, radius_m: Math.round(rad) } : null;
  }
  const OFFICE_ERR = 'Enter a name, valid latitude/longitude and a distance between 10 and 5000 metres.';
  R('GET', '/api/offices', async () => {
    const c = await ctx(); need(c, 'manage_offices', 'view_attendance');
    return { offices: (await list('offices', true)).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)) };
  });
  R('POST', '/api/offices', async ({ body }) => {
    const c = await ctx(); need(c, 'manage_offices');
    const o = officeBody(body); if (!o) throw E(OFFICE_ERR);
    await S.St.setDoc(ref('offices', newId()), { ...o, active: 1 }); await audit('office_add', o.name);
    return { ok: true };
  });
  R('PUT', '/api/offices/:id', async ({ p, body }) => {
    const c = await ctx(); need(c, 'manage_offices');
    const o = officeBody(body); if (!o) throw E(OFFICE_ERR);
    if (!(await one('offices', p[0]))) throw E('Office not found.', 404);
    await S.St.updateDoc(ref('offices', p[0]), { ...o, active: body.active === false || body.active === 0 ? 0 : 1 }); await audit('office_edit', o.name);
    return { ok: true };
  });

  /* ---- Holidays ---- */
  R('GET', '/api/holidays', async () => {
    const c = await ctx(); need(c, 'manage_holidays');
    return { holidays: (await list('holidays', false)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300).map(h => ({ id: h.id, date: h.date, name: h.name })) };
  });
  R('POST', '/api/holidays', async ({ body }) => {
    const c = await ctx(); need(c, 'manage_holidays');
    const name = str(body.name, 2, 80); if (!name || !isDate(body.date)) throw E('Enter a valid date and holiday name.');
    if (await one('holidays', body.date)) throw E('A holiday already exists on that date.', 409);
    await S.St.setDoc(ref('holidays', body.date), { date: body.date, name }); await audit('holiday_add', body.date);
    return { ok: true };
  });
  R('DELETE', '/api/holidays/:id', async ({ p }) => {
    const c = await ctx(); need(c, 'manage_holidays');
    await S.St.deleteDoc(ref('holidays', p[0])); return { ok: true };
  });

  /* ---- Attendance ---- */
  R('GET', '/api/attendance', async ({ q }) => {
    const c = await ctx(); need(c, 'view_attendance');
    const t = todayStr(), from = isDate(q.from) ? q.from : t, to = isDate(q.to) ? q.to : from, s = cleanQ(q.q);
    const [recs, users, offices] = await Promise.all([list('attendance', false, W('date', '>=', from), W('date', '<=', to)), usersMap(), list('offices', false)]);
    const om = new Map(offices.map(o => [String(o.id), o.name]));
    const rows = recs.map(a => { const u = users.get(a.user_id) || {}; return { date: a.date, check_in: a.check_in, check_out: a.check_out, in_distance: a.in_distance, full_name: u.full_name || '—', title: u.title || '', office: om.get(String(a.in_office_id)) || null }; })
      .filter(r => !s || like(r.full_name, s)).sort((a, b) => b.date.localeCompare(a.date) || (b.check_in || 0) - (a.check_in || 0)).slice(0, 1000);
    let absent = [];
    if (from === to && from <= t && (await workingDays(from, from)).length === 1) {
      const here = new Set(recs.map(a => a.user_id));
      const approved = (await list('leaves', true, W('status', '==', 'approved'))).filter(l => l.start_date <= from && l.end_date >= from).map(l => l.user_id);
      absent = [...users.values()].filter(u => u.role === 'employee' && u.status === 'active' && (!s || like(u.full_name, s)) && !here.has(u.id) && !approved.includes(u.id)).map(u => ({ full_name: u.full_name, title: u.title, phone: u.phone }));
    }
    return { from, to, rows, absent };
  });

  /* ---- Leave ---- */
  R('GET', '/api/leaves', async ({ q }) => {
    const c = await ctx(); need(c, 'review_leave');
    const st = ['pending', 'approved', 'rejected', 'cancelled'].includes(q.status) ? q.status : null;
    const [ls, users] = await Promise.all([list('leaves', true, ...(st ? [W('status', '==', st)] : [])), usersMap()]);
    const rows = ls.map(l => ({ ...l, full_name: (users.get(l.user_id) || {}).full_name || '—', title: (users.get(l.user_id) || {}).title || '', reviewer: l.reviewed_by ? (users.get(l.reviewed_by) || {}).full_name || null : null }))
      .sort((a, b) => ((b.status === 'pending') - (a.status === 'pending')) || b.id - a.id).slice(0, 300);
    return { leaves: rows };
  });
  R('POST', '/api/leaves/:id/review', async ({ p, body }) => {
    const c = await ctx(); need(c, 'review_leave');
    const dec = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : null, note = str(body.note ?? '', 0, 300);
    if (!dec || note === null) throw E('Choose approve or reject (note max 300 characters).');
    const l = await one('leaves', p[0], true);
    if (!l || l.status !== 'pending') throw E('This request was already reviewed or cancelled.', 409);
    await S.St.updateDoc(ref('leaves', p[0]), { status: dec, review_note: note, reviewed_by: c.uid, reviewed_at: S.St.serverTimestamp() });
    await audit('leave_' + dec, 'leave ' + p[0]);
    return { ok: true };
  });

  /* ---- Daily reports ---- */
  R('GET', '/api/reports', async ({ q }) => {
    const c = await ctx(); need(c, 'view_reports');
    const d = isDate(q.date) ? q.date : todayStr(), s = cleanQ(q.q);
    const [rs, users] = await Promise.all([list('reports', false, W('date', '==', d)), usersMap()]);
    return { date: d, reports: rs.map(r => { const u = users.get(r.user_id) || {}; return { date: r.date, work_done: r.work_done, challenges: r.challenges, suggestions: r.suggestions, updated_at: r.updated_at, full_name: u.full_name || '—', title: u.title || '' }; })
      .filter(r => !s || like(r.full_name, s)).sort((a, b) => a.full_name.localeCompare(b.full_name)) };
  });

  /* ---- Payroll ---- */
  const needPay = async () => { const c = await ctx(); need(c, 'manage_payroll'); return c; };
  async function addMissing(run) {
    const [users, items] = await Promise.all([list('users', false, W('role', '==', 'employee'), W('status', '==', 'active')), list('payroll_items', true, W('run_id', '==', run.id))]);
    const have = new Set(items.map(i => i.user_id)), ops = [];
    users.filter(u => !have.has(u.id)).forEach(u => ops.push(['set', ref('payroll_items', newId()), { run_id: run.id, user_id: u.id, month: run.month, published: run.status === 'published', basic: u.base_salary, allowances: 0, deductions: 0, total_salary: u.base_salary, net_pay: u.base_salary, status: 'pending', signed_at: null, signed_name: null, paid_at: null, paid_by: null, payment_ref: null, payment_method: null }]));
    await commit(ops); return ops.length;
  }
  R('GET', '/api/payroll/runs', async () => {
    await needPay();
    const [runs, items] = await Promise.all([list('payroll_runs', true), list('payroll_items', true)]);
    return { runs: runs.sort((a, b) => b.month.localeCompare(a.month)).map(r => { const it = items.filter(i => i.run_id === r.id); return { ...r, n: it.length, net: it.reduce((s, i) => s + (i.net_pay || 0), 0), signed: it.filter(i => i.status === 'signed').length, paid: it.filter(i => i.status === 'paid').length }; }) };
  });
  R('POST', '/api/payroll/runs', async ({ body }) => {
    const c = await needPay();
    if (!isMonth(body.month)) throw E('Choose a valid month.');
    if ((await list('payroll_runs', true, W('month', '==', body.month))).length) throw E('Payroll for this month already exists.', 409);
    const id = newId(), run = { id, month: body.month, status: 'draft' };
    await S.St.setDoc(ref('payroll_runs', id), { month: body.month, status: 'draft', created_by: c.uid, created_at: Date.now(), published_at: null });
    await addMissing(run); await audit('payroll_create', body.month);
    return { ok: true, id };
  });
  R('GET', '/api/payroll/runs/:id', async ({ p }) => {
    await needPay();
    const run = await one('payroll_runs', p[0], true); if (!run) throw E('Not found.', 404);
    const [items, users] = await Promise.all([list('payroll_items', true, W('run_id', '==', run.id)), usersMap()]);
    return { run, items: items.map(i => { const u = users.get(i.user_id) || {}; return { ...i, full_name: u.full_name || '—', title: u.title || '', phone: u.phone || '', paid_by_name: i.paid_by ? (users.get(i.paid_by) || {}).full_name || null : null }; }).sort((a, b) => a.full_name.localeCompare(b.full_name)) };
  });
  R('POST', '/api/payroll/runs/:id/sync', async ({ p }) => {
    await needPay(); const run = await one('payroll_runs', p[0], true); if (!run) throw E('Not found.', 404);
    return { ok: true, added: await addMissing(run) };
  });
  R('POST', '/api/payroll/runs/:id/publish', async ({ p }) => {
    await needPay(); const run = await one('payroll_runs', p[0], true);
    if (!run || run.status !== 'draft') throw E('Payroll is already published.', 409);
    const items = await list('payroll_items', true, W('run_id', '==', run.id));
    await commit(items.map(i => ['update', ref('payroll_items', i.id), { published: true }]));
    await S.St.updateDoc(ref('payroll_runs', p[0]), { status: 'published', published_at: Date.now() });
    await audit('payroll_publish', 'run ' + p[0]);
    return { ok: true };
  });
  R('DELETE', '/api/payroll/runs/:id', async ({ p }) => {
    await needPay(); const run = await one('payroll_runs', p[0], true);
    if (!run || run.status !== 'draft') throw E('Only draft payroll can be deleted.', 409);
    const items = await list('payroll_items', true, W('run_id', '==', run.id));
    await commit(items.map(i => ['delete', ref('payroll_items', i.id)]));
    await S.St.deleteDoc(ref('payroll_runs', p[0]));
    return { ok: true };
  });
  R('PATCH', '/api/payroll/items/:id', async ({ p, body }) => {
    await needPay();
    const b = num(body.basic, 0, 1e10), a = num(body.allowances, 0, 1e10), d = num(body.deductions, 0, 1e10);
    if (b === null || a === null || d === null) throw E('Enter valid amounts (0 or more).');
    const total = b + a; if (d > total) throw E('Deductions cannot be more than the total salary.');
    const it = await one('payroll_items', p[0], true);
    if (!it || it.status !== 'pending') throw E('Signed or paid payroll cannot be edited.', 409);
    await S.St.updateDoc(ref('payroll_items', p[0]), { basic: b, allowances: a, deductions: d, total_salary: total, net_pay: total - d });
    await audit('payroll_edit', 'item ' + p[0]);
    return { ok: true };
  });
  R('POST', '/api/payroll/pay', async ({ body }) => {
    const c = await needPay();
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger).slice(0, 500) : [];
    const method = str(body.method, 2, 40), reference = str(body.reference ?? '', 0, 80);
    if (!ids.length || !method || reference === null) throw E('Select at least one signed employee and enter the payment method.');
    const items = (await Promise.all(ids.map(i => one('payroll_items', i, true)))).filter(i => i && i.status === 'signed');
    await commit(items.map(i => ['update', ref('payroll_items', i.id), { status: 'paid', paid_at: S.St.serverTimestamp(), paid_by: c.uid, payment_ref: reference, payment_method: method }]));
    await audit('payroll_paid', `${items.length} item(s) ${reference}`);
    return { ok: true, updated: items.length };
  });

  /* ---- HR team (super admin only) ---- */
  const cleanPerms = p => (Array.isArray(p) ? p : []).filter(x => ALL.includes(x));
  R('GET', '/api/hr', async () => {
    const c = await ctx(); superOnly(c);
    return { hr: (await list('users', false, W('role', '==', 'hr'))).sort((a, b) => b.created_at - a.created_at).map(u => ({ id: u.id, full_name: u.full_name, title: u.title, phone: u.phone, status: u.status, permissions: u.permissions || [], created_at: u.created_at })) };
  });
  R('POST', '/api/hr', async ({ body: b }) => {
    const c = await ctx(); superOnly(c);
    const name = str(b.full_name, 3, 80), title = str(b.title, 2, 80), phone = normPhone(b.phone);
    if (!name || !title || !phone) throw E('Enter name, title and a valid phone number.');
    if (!strongPassword(b.password)) throw E(PW_RULE);
    // A second, throw-away Firebase app creates the login so the super admin stays signed in.
    const sec = S.A.getApps().find(a => a.name === 'sec') || S.A.initializeApp(CFG, 'sec'), sAuth = S.Au.getAuth(sec);
    let cred;
    try { cred = await S.Au.createUserWithEmailAndPassword(sAuth, emailOf(phone), b.password); } catch (e) {
      if (e.code === 'auth/email-already-in-use') throw E('This phone number is already registered.', 409);
      throw e;
    }
    try {
      await S.St.setDoc(ref('users', cred.user.uid), { full_name: name, title, phone, role: 'hr', status: 'active', permissions: cleanPerms(b.permissions), base_salary: 0, must_change: true, created_at: Date.now() });
    } catch (e) { await S.Au.deleteUser(cred.user).catch(() => {}); throw e; } finally { await S.Au.signOut(sAuth).catch(() => {}); }
    await audit('hr_create', phone);
    return { ok: true };
  });
  R('PATCH', '/api/hr/:id', async ({ p, body }) => {
    const c = await ctx(); superOnly(c);
    const u = await one('users', p[0]); if (!u || u.role !== 'hr') throw E('HR account not found.', 404);
    if (body.password) throw E('Resetting another person\u2019s password needs a server and is not available in the Firebase-only version. Create a new HR account instead, or see README \u201cForgotten passwords\u201d.', 400);
    const status = ['active', 'suspended'].includes(body.status) ? body.status : u.status;
    await S.St.updateDoc(ref('users', p[0]), { permissions: cleanPerms(body.permissions), status });
    await audit('hr_update', 'user ' + p[0]);
    return { ok: true };
  });
  R('GET', '/api/audit', async () => {
    const c = await ctx(); superOnly(c);
    const s = await S.St.getDocs(S.St.query(col('audit'), S.St.orderBy('created_at', 'desc'), S.St.limit(200)));
    return { log: s.docs.map(d => { const r = row(d); return { id: r.id, action: r.action, detail: r.detail, created_at: r.created_at, full_name: r.full_name || null }; }) };
  });
}
})();
