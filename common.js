'use strict';
/* Shared helpers. All dynamic HTML goes through h`` which escapes every value (XSS-safe). */
class Raw { constructor(s) { this.s = s; } }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const raw = s => new Raw(s);
const one = v => v instanceof Raw ? v.s : esc(v);
const h = (strs, ...vals) => new Raw(strs.reduce((o, s, i) => o + s + (i < vals.length ? (Array.isArray(vals[i]) ? vals[i].map(one).join('') : one(vals[i])) : ''), ''));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const put = (el, r) => { el.innerHTML = r instanceof Raw ? r.s : esc(r); };

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0M17 4.5a3.5 3.5 0 0 1 0 7M22 20a6 6 0 0 0-4-5.6"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  logout: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 17l5-5-5-5M21 12H9"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  out: '<path d="M10 17l5-5-5-5M15 12H3M21 3v18"/>'
};
const ico = n => raw(`<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`);

/* api() is provided by /js/firebase-api.js (Firebase Auth + Firestore) */
function toast(msg, type = '') {
  let w = $('.toasts'); if (!w) { w = document.createElement('div'); w.className = 'toasts'; w.setAttribute('role', 'status'); document.body.appendChild(w); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; w.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
function modal(title, body, onMount) {
  const o = document.createElement('div'); o.className = 'ov';
  o.innerHTML = h`<div class="modal" role="dialog" aria-modal="true"><div class="mh"><h3>${title}</h3><button class="x" data-close aria-label="Close">&times;</button></div><div class="mb">${body}</div></div>`.s;
  o.addEventListener('mousedown', e => { if (e.target === o) o.remove(); });
  o.addEventListener('click', e => { if (e.target.closest('[data-close]')) o.remove(); });
  document.body.appendChild(o); const f = $('input,select,textarea', o); f && f.focus();
  onMount && onMount(o); return o;
}
async function busy(btn, fn) {
  if (btn.disabled) return; const t = btn.innerHTML; btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; btn.innerHTML = t; }
}
const form = f => Object.fromEntries(new FormData(f));
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime = t => t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtStamp = t => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtMonth = m => m ? new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—';
const money = n => 'TZS ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const badge = s => h`<span class="bd ${s}">${s}</span>`;
const todayISO = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const thisMonth = () => todayISO().slice(0, 7);
const logo = () => raw('<div class="brand"><img src="img/icon-192.png" alt=""><div><b>WEDA</b><small>Women Empowerment Development Alliance</small></div></div>');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
