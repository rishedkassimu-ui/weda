'use strict';
/* One-time Super Admin setup. Allowed by firestore.rules only while no Super Admin exists AND the setup code matches. */
const CFG = { apiKey: 'AIzaSyBXIonUY-Vm-RqkVUYzwOBtkCcKFk_CXWE', authDomain: 'weda-16b9e.firebaseapp.com', projectId: 'weda-16b9e', storageBucket: 'weda-16b9e.firebasestorage.app', messagingSenderId: '46710940238', appId: '1:46710940238:web:aede9471adbf9f80e6991f' };
const CDN = 'https://www.gstatic.com/firebasejs/10.14.1/';
const $ = s => document.querySelector(s);
const say = (t, ok) => { const m = $('#msg'); m.textContent = t; m.className = 'note ' + (ok ? 'ok' : 'bad'); m.hidden = false; };
$('#f').onsubmit = async e => {
  e.preventDefault(); const btn = $('button[type=submit]'); btn.disabled = true; $('#msg').hidden = true;
  try {
    const f = Object.fromEntries(new FormData(e.target));
    const phone = (f.phone || '').replace(/[\s\-()]/g, '');
    if (!/^\+?\d{9,15}$/.test(phone)) throw new Error('Enter a valid phone number.');
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) throw new Error('Password must be at least 8 characters and contain letters and numbers.');
    if (f.password !== f.confirm) throw new Error('Passwords do not match.');
    const [A, Au, St] = await Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js')]);
    const app = A.initializeApp(CFG), auth = Au.getAuth(app), db = St.getFirestore(app);
    const email = String(f.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid e-mail.');
    let cred;
    try { cred = await Au.createUserWithEmailAndPassword(auth, email, f.password); }
    catch (er) { if (er.code === 'auth/email-already-in-use') cred = await Au.signInWithEmailAndPassword(auth, email, f.password); else throw er; }
    if (!cred.user.emailVerified) { await Au.reload(cred.user); }
    if (!cred.user.emailVerified) {
      await Au.sendEmailVerification(cred.user);
      say('A verification link was sent to ' + email + '. Open that e-mail, click the link, then come back here and press "Create Super Admin" again (same details).', true);
      return;
    }
    await cred.user.getIdToken(true);
    const b = St.writeBatch(db);
    b.set(St.doc(db, 'meta', 'superadmin'), { uid: cred.user.uid, created_at: Date.now() });
    b.set(St.doc(db, 'users', cred.user.uid), { full_name: f.full_name.trim(), title: 'Super Admin', phone, role: 'super_admin', status: 'active', permissions: [], base_salary: 0, must_change: false, created_at: Date.now() });
    await b.commit();
    const fixed = [['01-01', "New Year's Day"], ['01-12', 'Zanzibar Revolution Day'], ['04-07', 'Karume Day'], ['04-26', 'Union Day'], ['05-01', "Workers' Day"], ['07-07', 'Saba Saba'], ['08-08', 'Farmers\u2019 Day (Nane Nane)'], ['10-14', 'Nyerere Day'], ['12-09', 'Independence Day'], ['12-25', 'Christmas Day'], ['12-26', 'Boxing Day']];
    const hb = St.writeBatch(db);
    for (const y of [2026, 2027]) fixed.forEach(([d, n]) => hb.set(St.doc(db, 'holidays', `${y}-${d}`), { date: `${y}-${d}`, name: n }));
    await hb.commit();
    await Au.signOut(auth);
    e.target.reset(); say('Done! Super Admin created. Go back and sign in with that phone number and password.', true);
  } catch (er) {
    console.error(er);
    const c = er.code || '';
    say(c === 'permission-denied' ? 'Refused: only the verified e-mail rishedkassimu@gmail.com can do this, and only while no Super Admin exists.'
      : c === 'auth/operation-not-allowed' ? 'Turn on Authentication → Email/Password in the Firebase console first.'
      : c === 'auth/invalid-credential' ? 'That e-mail already has an account with a different password. Use "Forgot password" from the Firebase console, or enter the original password.'
      : er.message || 'Something went wrong.');
  } finally { btn.disabled = false; }
};
