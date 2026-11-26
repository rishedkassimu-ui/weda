'use strict';
const root = $('#root');
let me = null, PERMS = {};
window.onUnauth = () => { if (me) { me = null; toast('Your session has ended. Please sign in again.', 'err'); route(); } };
const PAGES = [['dashboard', 'Dashboard', 'grid', null], ['employees', 'Employees', 'users', ['approve_users', 'manage_employees']], ['offices', 'Offices', 'pin', ['manage_offices']],
  ['holidays', 'Holidays', 'star', ['manage_holidays']], ['attendance', 'Attendance', 'clock', ['view_attendance']], ['leaves', 'Leave requests', 'calendar', ['review_leave']],
  ['reports', 'Daily reports', 'doc', ['view_reports']], ['payroll', 'Payroll', 'wallet', ['manage_payroll']], ['hr', 'HR team', 'shield', 'super'], ['audit', 'Audit log', 'list', 'super'], ['security', 'My password', 'key', null]];
const allowed = p => p[3] === null || (p[3] === 'super' ? me.role === 'super_admin' : p[3].some(x => me.permissions.includes(x)));
const has = p => me.permissions.includes(p);
const head = (t, s, right = '') => h`<div class="top"><div class="row"><button class="burger" id="bg" aria-label="Menu">${ico('menu')}</button><div><h1>${t}</h1><p>${s}</p></div></div><div>${right}</div></div>`;
const opts = (arr, sel) => arr.map(([v, l]) => h`<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`);

async function boot() { try { const d = await api('/api/me'); me = d.user; PERMS = d.perms; } catch { me = null; } route(); }
window.addEventListener('hashchange', route);
function route() {
  if (!me) return login();
  if (me.must_change) return forceChange();
  const [pg, arg] = (location.hash.replace('#/', '') || 'dashboard').split('/');
  const entry = PAGES.find(p => p[0] === pg && allowed(p)) || PAGES[0];
  put(root, h`<div class="app"><nav class="nav" aria-label="Main">${logo()}
    ${PAGES.filter(allowed).map(p => h`<a class="nav-i ${p[0] === entry[0] ? 'on' : ''}" href="#/${p[0]}">${ico(p[2])}<span>${p[1]}</span></a>`)}
    <div class="nav-foot"><b>${me.full_name}</b>${me.role === 'super_admin' ? 'Super admin' : 'HR · ' + me.title}<br><a href="#" id="lo" style="color:#ffd88a">Sign out</a></div></nav>
    <main class="main" id="view"><div class="loading">Loading…</div></main></div>`);
  $('#lo').onclick = async e => { e.preventDefault(); await api('/api/logout', { method: 'POST', body: {} }).catch(() => {}); me = null; location.hash = ''; route(); };
  document.body.classList.remove('open');
  P[entry[0]]($('#view'), arg).then(() => { const b = $('#bg'); if (b) b.onclick = () => document.body.classList.toggle('open'); })
    .catch(e => put($('#view'), h`<div class="note bad">${e.message}</div>`));
}

/* ---------------- Auth ---------------- */
function login() {
  put(root, h`<div class="auth"><section class="auth-l">${logo()}<div><h1>Run the people side of WEDA with confidence.</h1><p>Approve staff, check attendance, review leave and release payroll — all from one secure portal.</p></div><small>Authorised administrators and HR only</small></section>
    <section class="auth-r"><div class="auth-card"><h2>Admin sign in</h2><p class="sub">Super admin and HR accounts only.</p>
    <form id="f"><div class="field"><label for="p">Phone number or e-mail</label><input id="p" name="phone" type="text" autocomplete="username" required></div>
    <div class="field"><label for="w">Password</label><input id="w" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn block" type="submit">Sign in</button></form></div></section></div>`);
  $('#f').onsubmit = e => { e.preventDefault(); busy($('button', e.target), async () => { await api('/api/login', { method: 'POST', body: form(e.target) }); await boot(); }); };
}
function forceChange() {
  put(root, h`<div class="auth"><section class="auth-l">${logo()}<div><h1>One last step: set your own password.</h1><p>The temporary password you were given must be replaced before you continue.</p></div><small></small></section>
    <section class="auth-r"><div class="auth-card"><h2>Create a new password</h2><p class="sub">At least 8 characters with letters and numbers.</p>
    <form id="f"><div class="field"><label for="a">Temporary password</label><input id="a" name="current" type="password" required></div>
    <div class="field"><label for="b">New password</label><input id="b" name="password" type="password" minlength="8" autocomplete="new-password" required></div>
    <button class="btn block" type="submit">Save and continue</button></form></div></section></div>`);
  $('#f').onsubmit = e => { e.preventDefault(); busy($('button', e.target), async () => { await api('/api/change-password', { method: 'POST', body: form(e.target) }); toast('Password updated.', 'ok'); await boot(); }); };
}

const P = {};
const stat = (n, l, i, c = '') => h`<div class="card stat ${c}"><div class="ic">${ico(i)}</div><div><b>${n}</b><span>${l}</span></div></div>`;
const empty = t => h`<div class="card empty">${t}</div>`;
const table = (cols, rows) => h`<div class="tw"><table><thead><tr>${cols.map(c => h`<th>${c}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>`;
const act = (el, sel, fn) => $$(sel, el).forEach(b => b.onclick = () => busy(b, () => fn(b)));

/* ---------------- Dashboard ---------------- */
P.dashboard = async el => {
  const s = await api('/api/stats');
  put(el, h`<div class="hero"><p>${fmtDate(s.today)}</p><h2>Good day, ${me.full_name.split(' ')[0]}</h2><p>${s.working_day ? 'Today is a working day.' : 'Today is a weekend or public holiday — attendance is not required.'}</p></div>
  <div class="grid g4 mt">${stat(s.pending_users, 'Registrations waiting', 'users', 'coral')}${stat(s.pending_leaves, 'Leave requests waiting', 'calendar', 'gold')}${stat(s.to_pay, 'Signed — ready to pay', 'wallet', 'ok')}${stat(s.employees, 'Active employees', 'users')}
  ${stat(s.present, 'Signed in today', 'check', 'ok')}${stat(s.on_leave, 'On leave today', 'calendar', 'gold')}${stat(s.reports, 'Reports today', 'doc')}</div>
  <div class="grid g3 mt">${has('approve_users') ? h`<a class="card" href="#/employees" style="text-decoration:none;color:inherit"><h3>Approve new staff</h3><p class="sub">${s.pending_users} waiting</p></a>` : ''}
  ${has('review_leave') ? h`<a class="card" href="#/leaves" style="text-decoration:none;color:inherit"><h3>Review leave</h3><p class="sub">${s.pending_leaves} waiting</p></a>` : ''}
  ${has('manage_payroll') ? h`<a class="card" href="#/payroll" style="text-decoration:none;color:inherit"><h3>Payroll</h3><p class="sub">${s.to_pay} employee(s) signed and waiting for payment</p></a>` : ''}</div>`);
};

/* ---------------- Employees ---------------- */
let empFilter = 'pending', empQ = '';
P.employees = async el => {
  const d = await api(`/api/users?status=${empFilter === 'all' ? '' : empFilter}&q=${encodeURIComponent(empQ)}`);
  put(el, h`${head('Employees', 'Approve registrations and manage staff records.')}
  <div class="row sp" style="margin-bottom:16px"><div class="tabs" style="margin:0">${['pending', 'active', 'suspended', 'rejected', 'all'].map(f => h`<button class="${f === empFilter ? 'on' : ''}" data-f="${f}">${f}</button>`)}</div>
  <div class="field" style="margin:0;min-width:220px"><input id="q" placeholder="Search name, phone, title" value="${empQ}" aria-label="Search"></div></div>
  ${d.users.length ? table(['Name', 'Title', 'Phone', 'Base salary', 'Status', 'Actions'], d.users.map(u => h`<tr><td><b>${u.full_name}</b><div class="mut small">Registered ${fmtStamp(u.created_at)}</div></td><td>${u.title}</td><td class="nowrap">${u.phone}</td><td class="nowrap">${money(u.base_salary)}</td><td>${badge(u.status)}</td>
  <td class="nowrap">${u.status === 'pending' && has('approve_users') ? h`<button class="btn sm ok" data-a="approve" data-id="${u.id}">Approve</button> <button class="btn sm bad" data-a="reject" data-id="${u.id}">Reject</button> ` : ''}
  ${has('manage_employees') ? h`<button class="btn sm ghost" data-e="${u.id}" data-n="${u.full_name}" data-t="${u.title}" data-s="${u.base_salary}">Edit</button> ${u.status === 'active' ? h`<button class="btn sm ghost" data-a="suspend" data-id="${u.id}">Suspend</button>` : ['suspended', 'rejected'].includes(u.status) ? h`<button class="btn sm ghost" data-a="reactivate" data-id="${u.id}">Reactivate</button>` : ''}` : ''}</td></tr>`)) : empty('No employees in this view.')}`);
  $$('[data-f]', el).forEach(b => b.onclick = () => { empFilter = b.dataset.f; P.employees(el); });
  let tm; $('#q').oninput = e => { clearTimeout(tm); tm = setTimeout(async () => { empQ = e.target.value; const pos = e.target.selectionStart; await P.employees(el); const i = $('#q'); i.focus(); i.setSelectionRange(pos, pos); }, 350); };
  act(el, '[data-a]', async b => { if (b.dataset.a === 'reject' && !confirm('Reject this registration?')) return; await api(`/api/users/${b.dataset.id}/${b.dataset.a}`, { method: 'POST', body: {} }); toast('Done.', 'ok'); P.employees(el); });
  $$('[data-e]', el).forEach(b => b.onclick = () => modal('Edit employee', h`<form id="ef"><div class="field"><label>Full name</label><input name="full_name" value="${b.dataset.n}" required minlength="3"></div>
    <div class="field"><label>Title / position</label><input name="title" value="${b.dataset.t}" required></div><div class="field"><label>Base monthly salary (TZS)</label><input name="base_salary" type="number" min="0" step="1000" value="${b.dataset.s}" required><span class="hint">Used when payroll is created. Individual payroll lines can still be adjusted.</span></div>
    <button class="btn block" type="submit">Save changes</button></form>`, o => { $('#ef', o).onsubmit = ev => { ev.preventDefault(); busy($('button', ev.target), async () => { await api('/api/users/' + b.dataset.e, { method: 'PATCH', body: form(ev.target) }); o.remove(); toast('Saved.', 'ok'); P.employees(el); }); }; }));
};

/* ---------------- Offices ---------------- */
P.offices = async el => {
  const { offices } = await api('/api/offices');
  put(el, h`${head('Office locations', 'Employees can only sign in when they are inside the distance you set here.')}
  <div class="grid split"><div class="card"><h3>Add office</h3><p class="sub">Stand inside the office and tap “Use my current location”, or paste coordinates from a map.</p>
    <form id="of"><div class="field"><label>Office name</label><input name="name" required placeholder="e.g. Mwanza Head Office"></div>
    <div class="two"><div class="field"><label>Latitude</label><input name="lat" id="lat" type="number" step="any" required></div><div class="field"><label>Longitude</label><input name="lng" id="lng" type="number" step="any" required></div></div>
    <button class="btn ghost block" type="button" id="here">${ico('pin')} Use my current location</button>
    <div class="field mt2"><label>Eligible distance to sign in (metres)</label><input name="radius_m" type="number" min="10" max="5000" value="100" required><span class="hint">100 m suits most offices. GPS can drift by 10–30 m indoors.</span></div>
    <button class="btn block" type="submit">Save office</button></form></div>
  <div class="grid" style="align-content:start">${offices.length ? offices.map(o => h`<div class="card"><div class="row sp"><h3>${o.name}</h3>${badge(o.active ? 'active' : 'suspended')}</div>
    <dl class="kv mt2"><dt>Coordinates</dt><dd>${o.lat.toFixed(6)}, ${o.lng.toFixed(6)}</dd><dt>Sign-in distance</dt><dd>${o.radius_m} m</dd></dl>
    <div class="row mt"><a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lng}#map=18/${o.lat}/${o.lng}">View on map</a>
    <button class="btn sm ghost" data-o='${JSON.stringify(o)}'>Edit</button></div></div>`) : empty('No office yet. Add the first one to enable attendance.')}</div></div>`);
  $('#here').onclick = e => busy(e.currentTarget, () => new Promise((ok, no) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => { $('#lat').value = p.coords.latitude.toFixed(6); $('#lng').value = p.coords.longitude.toFixed(6); toast(`Location captured (±${Math.round(p.coords.accuracy)} m).`, 'ok'); ok(); }, () => no(new Error('Could not read your location. Allow location access and try again.')), { enableHighAccuracy: true, timeout: 20000 }) : no(new Error('This device does not support location.'))));
  $('#of').onsubmit = ev => { ev.preventDefault(); busy($('button[type=submit]', ev.target), async () => { await api('/api/offices', { method: 'POST', body: form(ev.target) }); toast('Office saved.', 'ok'); P.offices(el); }); };
  $$('[data-o]', el).forEach(b => b.onclick = () => { const o = JSON.parse(b.dataset.o); modal('Edit office', h`<form id="eo"><div class="field"><label>Name</label><input name="name" value="${o.name}" required></div>
    <div class="two"><div class="field"><label>Latitude</label><input name="lat" type="number" step="any" value="${o.lat}" required></div><div class="field"><label>Longitude</label><input name="lng" type="number" step="any" value="${o.lng}" required></div></div>
    <div class="two"><div class="field"><label>Distance (m)</label><input name="radius_m" type="number" min="10" max="5000" value="${o.radius_m}" required></div><div class="field"><label>Status</label><select name="active">${opts([['1', 'Active'], ['0', 'Disabled']], String(o.active))}</select></div></div>
    <button class="btn block" type="submit">Save changes</button></form>`, m => { $('#eo', m).onsubmit = ev => { ev.preventDefault(); const f = form(ev.target); f.active = f.active === '1'; busy($('button', ev.target), async () => { await api('/api/offices/' + o.id, { method: 'PUT', body: f }); m.remove(); toast('Office updated.', 'ok'); P.offices(el); }); }; }); });
};

/* ---------------- Holidays ---------------- */
P.holidays = async el => {
  const { holidays } = await api('/api/holidays');
  put(el, h`${head('Public holidays', 'Holidays and weekends are excluded from attendance and leave counts.')}
  <div class="grid split"><div>${holidays.length ? table(['Date', 'Holiday', ''], holidays.map(x => h`<tr><td>${fmtDate(x.date)}</td><td>${x.name}</td><td class="right"><button class="btn sm ghost" data-d="${x.id}">Remove</button></td></tr>`)) : empty('No holidays added.')}</div>
  <div class="card" style="align-self:start"><h3>Add holiday</h3><p class="sub">Add movable holidays (Easter, Eid) each year.</p><form id="hf"><div class="field"><label>Date</label><input name="date" type="date" required></div>
  <div class="field"><label>Name</label><input name="name" required maxlength="80"></div><button class="btn block" type="submit">Add holiday</button></form></div></div>`);
  $('#hf').onsubmit = ev => { ev.preventDefault(); busy($('button', ev.target), async () => { await api('/api/holidays', { method: 'POST', body: form(ev.target) }); toast('Holiday added.', 'ok'); P.holidays(el); }); };
  act(el, '[data-d]', async b => { await api('/api/holidays/' + b.dataset.d, { method: 'DELETE' }); P.holidays(el); });
};

/* ---------------- Attendance ---------------- */
let attDay = '', attQ = '';
P.attendance = async el => {
  attDay = attDay || todayISO();
  const d = await api(`/api/attendance?from=${attDay}&to=${attDay}&q=${encodeURIComponent(attQ)}`);
  put(el, h`${head('Attendance', fmtDate(attDay))}
  <div class="row" style="margin-bottom:16px"><div class="field" style="margin:0"><input id="ad" type="date" value="${attDay}" aria-label="Date"></div><div class="field" style="margin:0;min-width:220px"><input id="aq" placeholder="Search name" value="${attQ}" aria-label="Search"></div></div>
  <div class="grid g3" style="margin-bottom:18px">${stat(d.rows.length, 'Signed in', 'check', 'ok')}${stat(d.absent.length, 'No sign-in & no leave', 'clock', 'coral')}</div>
  <h3>Signed in</h3><div class="mt2">${d.rows.length ? table(['Employee', 'Office', 'In', 'Out', 'Distance'], d.rows.map(r => h`<tr><td><b>${r.full_name}</b><div class="mut small">${r.title}</div></td><td>${r.office || '—'}</td><td>${fmtTime(r.check_in)}</td><td>${fmtTime(r.check_out)}</td><td>${r.in_distance} m</td></tr>`)) : empty('No sign-ins for this date.')}</div>
  ${d.absent.length ? h`<h3 class="mt">Not signed in (not on leave)</h3><div class="mt2">${table(['Employee', 'Phone'], d.absent.map(a => h`<tr><td><b>${a.full_name}</b><div class="mut small">${a.title}</div></td><td>${a.phone}</td></tr>`))}</div>` : ''}`);
  $('#ad').onchange = e => { attDay = e.target.value; P.attendance(el); };
  let tm; $('#aq').oninput = e => { clearTimeout(tm); tm = setTimeout(async () => { attQ = e.target.value; await P.attendance(el); const i = $('#aq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 350); };
};

/* ---------------- Leave ---------------- */
let lvFilter = 'pending';
P.leaves = async el => {
  const { leaves } = await api('/api/leaves?status=' + (lvFilter === 'all' ? '' : lvFilter));
  put(el, h`${head('Leave requests', 'Approve or reject. Employees see your decision straight away.')}
  <div class="tabs">${['pending', 'approved', 'rejected', 'cancelled', 'all'].map(f => h`<button class="${f === lvFilter ? 'on' : ''}" data-f="${f}">${f}</button>`)}</div>
  ${leaves.length ? table(['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Status', ''], leaves.map(l => h`<tr><td><b>${l.full_name}</b><div class="mut small">${l.title}</div></td><td>${l.type}</td><td class="nowrap">${fmtDate(l.start_date)}${l.end_date !== l.start_date ? h`<br>→ ${fmtDate(l.end_date)}` : ''}</td><td>${l.days}</td><td style="max-width:240px">${l.reason || '—'}</td>
  <td>${badge(l.status)}${l.reviewer ? h`<div class="mut small">by ${l.reviewer}</div>` : ''}${l.review_note ? h`<div class="small">“${l.review_note}”</div>` : ''}</td>
  <td class="nowrap">${l.status === 'pending' ? h`<button class="btn sm ok" data-r="approve" data-id="${l.id}">Approve</button> <button class="btn sm bad" data-r="reject" data-id="${l.id}">Reject</button>` : ''}</td></tr>`)) : empty('Nothing here.')}`);
  $$('[data-f]', el).forEach(b => b.onclick = () => { lvFilter = b.dataset.f; P.leaves(el); });
  $$('[data-r]', el).forEach(b => b.onclick = () => modal(b.dataset.r === 'approve' ? 'Approve leave' : 'Reject leave', h`<form id="lf"><div class="field"><label>Note to employee <span class="mut">(optional)</span></label><textarea name="note" maxlength="300"></textarea></div>
    <button class="btn block ${b.dataset.r === 'approve' ? 'ok' : 'bad'}" type="submit">${b.dataset.r === 'approve' ? 'Approve' : 'Reject'} request</button></form>`, o => {
    $('#lf', o).onsubmit = ev => { ev.preventDefault(); busy($('button', ev.target), async () => { await api(`/api/leaves/${b.dataset.id}/review`, { method: 'POST', body: { decision: b.dataset.r, note: form(ev.target).note } }); o.remove(); toast('Decision saved.', 'ok'); P.leaves(el); }); };
  }));
};

/* ---------------- Daily reports ---------------- */
let rpDay = '';
P.reports = async el => {
  rpDay = rpDay || todayISO();
  const d = await api('/api/reports?date=' + rpDay);
  put(el, h`${head('Daily reports', fmtDate(rpDay))}
  <div class="field" style="max-width:220px"><input id="rd" type="date" value="${rpDay}" aria-label="Date"></div>
  ${d.reports.length ? h`<div class="grid g2">${d.reports.map(r => h`<div class="card"><h3>${r.full_name}</h3><p class="sub">${r.title} · updated ${fmtTime(r.updated_at)}</p>
    <b class="small">Work done</b><p class="mt2" style="white-space:pre-wrap">${r.work_done}</p>
    ${r.challenges ? h`<b class="small" style="display:block;margin-top:12px;color:var(--coral)">Challenges</b><p class="mt2" style="white-space:pre-wrap">${r.challenges}</p>` : ''}
    ${r.suggestions ? h`<b class="small" style="display:block;margin-top:12px;color:var(--ok)">Suggestions</b><p class="mt2" style="white-space:pre-wrap">${r.suggestions}</p>` : ''}</div>`)}</div>` : empty('No reports submitted for this date.')}`);
  $('#rd').onchange = e => { rpDay = e.target.value; P.reports(el); };
};

/* ---------------- Payroll ---------------- */
P.payroll = async (el, arg) => {
  if (arg) return payrollRun(el, +arg);
  const { runs } = await api('/api/payroll/runs');
  put(el, h`${head('Payroll', 'Create, publish and track monthly payroll.', h`<button class="btn gold" id="np">New payroll</button>`)}
  ${runs.length ? h`<div class="grid g3">${runs.map(r => h`<a class="card pay" href="#/payroll/${r.id}" style="text-decoration:none;color:inherit"><div class="row sp"><h3>${fmtMonth(r.month)}</h3>${badge(r.status)}</div>
    <div class="amt" style="font-family:var(--serif);font-size:26px;color:var(--plum2)">${money(r.net)}</div><p class="mut small">${r.n} employees · ${r.signed || 0} signed · ${r.paid || 0} paid</p>
    <div class="bar mt2"><i style="width:${r.n ? Math.round(100 * (r.paid || 0) / r.n) : 0}%"></i></div></a>`)}</div>` : empty('No payroll yet. Create the first month to begin.')}`);
  $('#np').onclick = () => modal('New payroll', h`<form id="pf"><div class="field"><label>Salary month</label><input name="month" type="month" value="${thisMonth()}" required></div>
    <p class="hint" style="margin-bottom:14px">Every active employee is added using their base salary. You can adjust allowances and deductions before publishing.</p><button class="btn block" type="submit">Create draft</button></form>`, o => {
    $('#pf', o).onsubmit = ev => { ev.preventDefault(); busy($('button', ev.target), async () => { const r = await api('/api/payroll/runs', { method: 'POST', body: form(ev.target) }); o.remove(); location.hash = '#/payroll/' + r.id; }); }; });
};
async function payrollRun(el, rid) {
  const { run, items } = await api('/api/payroll/runs/' + rid);
  const signed = items.filter(i => i.status === 'signed'), paid = items.filter(i => i.status === 'paid');
  put(el, h`${head('Payroll · ' + fmtMonth(run.month), run.status === 'draft' ? 'Draft — employees cannot see this yet.' : 'Published — employees can see and sign.',
    h`<a class="btn ghost" href="#/payroll">← All payroll</a> ${run.status === 'draft' ? h`<button class="btn ok" id="pub">Publish to employees</button>` : ''}`)}
  <div class="grid g4" style="margin-bottom:18px">${stat(items.length, 'Employees', 'users')}${stat(items.filter(i => i.status === 'pending').length, 'Not yet signed', 'clock', 'gold')}${stat(signed.length, 'Signed — to pay', 'wallet', 'coral')}${stat(paid.length, 'Paid', 'check', 'ok')}</div>
  <div class="row sp" style="margin-bottom:12px"><div class="row"><button class="btn ghost sm" id="sy">Add missing employees</button>${run.status === 'draft' ? h`<button class="btn ghost sm" id="dl">Delete draft</button>` : ''}</div>
  <button class="btn gold" id="pay" ${signed.length ? '' : 'disabled'}>Mark selected as paid</button></div>
  ${items.length ? table(['', 'Employee', 'Basic', 'Allowances', 'Deductions', 'Total salary', 'Amount to pay', 'Status', ''], items.map(i => h`<tr><td>${i.status === 'signed' ? h`<input type="checkbox" class="ck" value="${i.id}" checked aria-label="Select ${i.full_name}">` : ''}</td>
    <td><b>${i.full_name}</b><div class="mut small">${i.title} · ${i.phone}</div></td><td class="nowrap">${money(i.basic)}</td><td class="nowrap">${money(i.allowances)}</td><td class="nowrap">${money(i.deductions)}</td><td class="nowrap">${money(i.total_salary)}</td><td class="nowrap"><b>${money(i.net_pay)}</b></td>
    <td>${badge(i.status)}${i.signed_at && i.status === 'signed' ? h`<div class="mut small">${fmtStamp(i.signed_at)}</div>` : ''}${i.paid_at ? h`<div class="mut small">${fmtStamp(i.paid_at)}<br>${i.payment_method || ''} ${i.payment_ref || ''}<br>by ${i.paid_by_name || ''}</div>` : ''}</td>
    <td>${i.status === 'pending' ? h`<button class="btn sm ghost" data-i='${JSON.stringify({ id: i.id, n: i.full_name, b: i.basic, a: i.allowances, d: i.deductions })}'>Edit</button>` : ''}</td></tr>`)) : empty('No employees in this payroll. Approve staff and set salaries first.')}`);
  const pub = $('#pub'); if (pub) pub.onclick = () => confirm('Publish now? Employees will see their payroll and can sign.') && busy(pub, async () => { await api(`/api/payroll/runs/${rid}/publish`, { method: 'POST', body: {} }); toast('Published to employees.', 'ok'); payrollRun(el, rid); });
  const dl = $('#dl'); if (dl) dl.onclick = () => confirm('Delete this draft payroll?') && busy(dl, async () => { await api('/api/payroll/runs/' + rid, { method: 'DELETE' }); location.hash = '#/payroll'; });
  $('#sy').onclick = e => busy(e.currentTarget, async () => { const r = await api(`/api/payroll/runs/${rid}/sync`, { method: 'POST', body: {} }); toast(r.added + ' employee(s) added.', 'ok'); payrollRun(el, rid); });
  $('#pay').onclick = () => { const ids = $$('.ck', el).filter(c => c.checked).map(c => +c.value); if (!ids.length) return toast('Select at least one signed employee.', 'err');
    modal(`Mark ${ids.length} as paid`, h`<form id="pf"><div class="field"><label>Payment method</label><select name="method"><option>Cash</option><option>Bank transfer</option><option>Mobile money</option><option>Cheque</option></select></div>
      <div class="field"><label>Reference <span class="mut">(receipt / transaction no.)</span></label><input name="reference" maxlength="80"></div>
      <p class="hint" style="margin-bottom:14px">Confirm only after the money has been handed over. This is recorded with your name and the time.</p><button class="btn ok block" type="submit">Confirm payment</button></form>`, o => {
      $('#pf', o).onsubmit = ev => { ev.preventDefault(); busy($('button', ev.target), async () => { const r = await api('/api/payroll/pay', { method: 'POST', body: { ids, ...form(ev.target) } }); o.remove(); toast(r.updated + ' payment(s) recorded.', 'ok'); payrollRun(el, rid); }); }; }); };
  $$('[data-i]', el).forEach(b => b.onclick = () => { const i = JSON.parse(b.dataset.i); modal('Adjust · ' + i.n, h`<form id="ip"><div class="field"><label>Basic salary</label><input name="basic" type="number" min="0" step="any" value="${i.b}" required></div>
    <div class="two"><div class="field"><label>Allowances</label><input name="allowances" type="number" min="0" step="any" value="${i.a}" required></div><div class="field"><label>Deductions</label><input name="deductions" type="number" min="0" step="any" value="${i.d}" required></div></div>
    <p class="hint" style="margin-bottom:14px">Total salary = basic + allowances. Amount to pay = total − deductions.</p><button class="btn block" type="submit">Save</button></form>`, o => {
    $('#ip', o).onsubmit = ev => { ev.preventDefault(); busy($('button', ev.target), async () => { await api('/api/payroll/items/' + i.id, { method: 'PATCH', body: form(ev.target) }); o.remove(); toast('Saved.', 'ok'); payrollRun(el, rid); }); }; }); });
}

/* ---------------- HR team (super admin) ---------------- */
const permBoxes = sel => h`<div class="checks">${Object.entries(PERMS).map(([k, l]) => h`<label><input type="checkbox" name="p" value="${k}" ${sel.includes(k) ? 'checked' : ''}><span>${l}</span></label>`)}</div>`;
const picked = f => $$('[name=p]:checked', f).map(c => c.value);
P.hr = async el => {
  const { hr } = await api('/api/hr');
  put(el, h`${head('HR team', 'Delegate exactly the powers each HR officer needs.', h`<button class="btn gold" id="nh">Add HR officer</button>`)}
  ${hr.length ? h`<div class="grid g2">${hr.map(u => h`<div class="card"><div class="row sp"><h3>${u.full_name}</h3>${badge(u.status)}</div><p class="sub">${u.title} · ${u.phone}</p>
    <div>${u.permissions.length ? u.permissions.map(p => h`<span class="chip">${PERMS[p] ? PERMS[p].split(' ').slice(0, 4).join(' ') : p}</span>`) : h`<span class="mut small">No permissions yet</span>`}</div>
    <button class="btn sm ghost mt" data-u='${JSON.stringify(u)}'>Edit access</button></div>`)}</div>` : empty('No HR officers yet. Add one and choose what they can do.')}`);
  $('#nh').onclick = () => modal('Add HR officer', h`<form id="nf"><div class="two"><div class="field"><label>Full name</label><input name="full_name" required></div><div class="field"><label>Title</label><input name="title" value="HR Officer" required></div></div>
    <div class="two"><div class="field"><label>Phone number</label><input name="phone" type="tel" required></div><div class="field"><label>Temporary password</label><input name="password" type="text" minlength="8" required autocomplete="off"></div></div>
    <label style="font-weight:600;font-size:13.5px">Permissions</label><div class="mt2" style="margin-bottom:16px">${permBoxes(['approve_users', 'review_leave', 'view_attendance', 'view_reports'])}</div>
    <p class="hint" style="margin-bottom:14px">They will be asked to choose their own password at first sign-in.</p><button class="btn block" type="submit">Create HR account</button></form>`, o => {
    $('#nf', o).onsubmit = ev => { ev.preventDefault(); busy($('button', ev.target), async () => { await api('/api/hr', { method: 'POST', body: { ...form(ev.target), permissions: picked(ev.target) } }); o.remove(); toast('HR account created.', 'ok'); P.hr(el); }); }; });
  $$('[data-u]', el).forEach(b => b.onclick = () => { const u = JSON.parse(b.dataset.u); modal('Access · ' + u.full_name, h`<form id="ef"><div class="field"><label>Account status</label><select name="status">${opts([['active', 'Active'], ['suspended', 'Suspended']], u.status)}</select></div>
    ${permBoxes(u.permissions)}<div class="field mt"><label>Reset password <span class="mut">(optional)</span></label><input name="password" type="text" autocomplete="off" placeholder="Leave empty to keep the current one"></div>
    <button class="btn block" type="submit">Save access</button></form>`, o => {
    $('#ef', o).onsubmit = ev => { ev.preventDefault(); const f = form(ev.target); busy($('button', ev.target), async () => { await api('/api/hr/' + u.id, { method: 'PATCH', body: { status: f.status, password: f.password || undefined, permissions: picked(ev.target) } }); o.remove(); toast('Access updated.', 'ok'); P.hr(el); }); }; }); });
};

/* ---------------- Audit & security ---------------- */
P.audit = async el => {
  const { log } = await api('/api/audit');
  put(el, h`${head('Audit log', 'The last 200 sensitive actions across the system.')}${table(['When', 'Who', 'Action', 'Detail'], log.map(l => h`<tr><td class="nowrap">${fmtStamp(l.created_at)}</td><td>${l.full_name || '—'}</td><td><span class="chip">${l.action}</span></td><td class="mut small">${l.detail || ''}</td></tr>`))}`);
};
P.security = async el => {
  put(el, h`${head('My password', 'Keep your administrator account safe.')}<div class="card" style="max-width:480px"><form id="pf"><div class="field"><label>Current password</label><input name="current" type="password" autocomplete="current-password" required></div>
    <div class="field"><label>New password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div><button class="btn block" type="submit">Save password</button></form></div>`);
  $('#pf').onsubmit = ev => { ev.preventDefault(); busy($('button', ev.target), async () => { await api('/api/change-password', { method: 'POST', body: form(ev.target) }); ev.target.reset(); toast('Password updated.', 'ok'); }); };
};
boot();
