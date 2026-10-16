/* 75 Hard, shared between two people in two timezones.
 *
 * Rules: every box done before your own local midnight is +1. Anything missing
 * is -10, floored at zero. Every miss shoves your projected finish date
 * later, which is the number that actually stings.
 *
 * Past days lock at midnight, with one exception: yesterday stays open for
 * the whole of today so a day that was really done cannot be lost to a
 * checkbox nobody tapped. See `fixableDay` in core.js for the guard rails.
 * Anything filled in that way is stamped `late` and the ledger says so.
 *
 * Each person can only ever write their own row. That is enforced in the
 * Firebase security rules, not just here.
 *
 * Photos live in the database as JPEG data, not in Cloud Storage, because
 * Storage started requiring a billing card in February 2026 and this did not
 * seem worth a credit card. They are kept in their own branch so the
 * checkbox sync stays small: only the two photos for today are subscribed,
 * and a full-size one is fetched on demand when you tap it. */

import { FIREBASE, PEOPLE, GOAL, PENALTY, MOTTO } from "./config.js";
import {
  pad, addDays, diffDays, utc, isoIn, untilMidnight,
  fmt, pretty, shortDate, longDate, zoneName,
  doneCount as countDone, isComplete as complete, scoreFor, keysOn, requiredOn,
  fixableDay, missingKeys,
  waterOunces, waterDone, WATER_TOTAL, WATER_STEPS, WATER_MAX,
  TASK_KEYS, REQUIRED
} from "./core.js";

const SDK = "https://www.gstatic.com/firebasejs/11.10.0/";
const { initializeApp } = await import(SDK + "firebase-app.js");
const {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged, setPersistence, browserLocalPersistence
} = await import(SDK + "firebase-auth.js");
const { getDatabase, ref, onValue, get, set, remove } = await import(SDK + "firebase-database.js");

/* ===================== constants ===================== */

const TASKS = [
  { k: "w1",    label: "Workout one",         sub: "30 minutes, minimum" },
  { k: "w2",    label: "Workout two",         sub: "30 minutes, minimum", tag: "Outside" },
  { k: "water", label: "One gallon of water", sub: "128 oz, no exceptions" },
  { k: "read",  label: "Ten pages",           sub: "Non-fiction only" },
  { k: "diet",  label: "Diet",                sub: "", diet: true }
];
if (TASKS.length + 1 !== REQUIRED || TASKS.some((t, i) => t.k !== TASK_KEYS[i])) {
  console.error("TASKS in app.js and TASK_KEYS in core.js disagree. Scoring will be wrong.");
}
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/* The boxes one person owes on one date: the five everybody has, plus any
 * extra wicket from config.js that has started by then. */
function tasksOn(p, iso) {
  const extra = (p.extras || []).filter((x) => x?.k && x.from && iso >= x.from)
    .map((x) => ({ k: x.k, label: x.label || x.k, sub: x.sub || "" }));
  return extra.length ? [...TASKS, ...extra] : TASKS;
}
/* An extra that starts tomorrow, so the Today view can give a day's warning. */
const startingTomorrow = (p, iso) => (p.extras || []).filter((x) => x?.from === addDays(iso, 1));

const LABELS = { ...Object.fromEntries(TASKS.map((t) => [t.k, t.label])), photo: "Progress photo" };

// Roughly 110 KB of JPEG for the keeper, 16 KB for the row thumbnail. Both
// numbers are the length of the data URL, which is what the database stores.
const FULL_PX = 900, FULL_BUDGET = 150_000;
const THUMB_PX = 220, THUMB_BUDGET = 22_000;

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6"/></svg>';
const MARK = '<svg class="mark" viewBox="0 0 100 100" aria-hidden="true">' +
  '<circle cx="50" cy="50" r="34" fill="var(--jon)"/>' +
  '<path d="M50 16 A34 34 0 0 0 26 74 Z" fill="var(--mary)"/></svg>';
const GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6z"/>' +
  '<path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.4 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.4 7.6 24 12 24z"/>' +
  '<path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.7l3.8-3z"/>' +
  '<path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.2 15.1 0 12 0 7.6 0 3.7 2.6 1.8 6.4l3.8 3C6.5 6.7 9 4.8 12 4.8z"/></svg>';

const RESET = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M3.5 12a8.5 8.5 0 1 0 2.9-6.4"/><path d="M3 4.2v5h5"/></svg>';

const ICONS = {
  today: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12.5l2.8 2.8L16.5 9"/></svg>',
  us: '<svg viewBox="0 0 24 24"><path d="M8.5 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M2.8 20c0-3.1 2.6-5.2 5.7-5.2s5.7 2.1 5.7 5.2"/><path d="M16.5 11.2a2.7 2.7 0 1 0 0-5.4"/><path d="M17.4 14.9c2.3.3 3.8 2.2 3.8 5.1"/></svg>',
  ledger: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17.2h2M11 17.2h2"/></svg>',
  setup: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="2.1"/><circle cx="15" cy="12" r="2.1"/><circle cx="8" cy="17" r="2.1"/></svg>'
};

/* ===================== app state ===================== */

const S = {
  phase: "boot",          // boot | noconfig | signedout | loading | claim | denied | ready
  user: null,
  me: null,
  tab: "today",
  data: { meta: {}, people: {}, days: {} },
  online: true,
  authErr: null,
  claimErr: null,
  lightbox: null,
  upload: null,           // {pct, label} while a photo is being saved
  shootIso: null,         // the date the file picker is currently filling
  lateFixed: null         // a day repaired this session, kept on screen to say so
};
try { const t = sessionStorage.getItem("h75.tab"); if (t) S.tab = t; } catch {}

const PICS = new Map();   // "id|iso|thumb" and "id|iso|full" -> data URL
let db = null, auth = null;

/* ===================== people and scoring ===================== */

function person(id) {
  const seed = PEOPLE.find((p) => p.id === id) || {};
  const live = S.data.people?.[id] || {};
  return { ...seed, ...live, id: seed.id, relation: seed.relation };
}
const everyone = () => PEOPLE.map((p) => person(p.id));
const otherId = (id) => PEOPLE.find((p) => p.id !== id)?.id ?? null;
const daysOf = (id) => S.data.days?.[id] || {};
const dayRec = (id, iso) => daysOf(id)[iso] || {};

const doneCount = (id, iso) => countDone(daysOf(id), iso, keysOn(person(id), iso));
const isComplete = (id, iso) => complete(daysOf(id), iso, keysOn(person(id), iso));
const score = (id) => scoreFor(person(id), daysOf(id), { goal: GOAL, penalty: PENALTY });

/* ===================== small helpers ===================== */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, one, many) => `${n} ${Math.abs(n) === 1 ? one : many}`;
const accent = (id) => id === "mary"
  ? "--accent:var(--mary);--accent-soft:var(--mary-soft)"
  : "--accent:var(--jon);--accent-soft:var(--jon-soft)";

function statusOf(sc) {
  if (sc.finished) return { c: "done", t: "Finished" };
  if (sc.todayDone) return { c: "ok", t: "Locked in" };
  if (sc.todayCount === 0) return { c: "bad", t: "Nothing yet" };
  return { c: "warn", t: `${sc.todayCount} of ${sc.required}` };
}
/* The clock says "Virginia", not "New York". If someone changes their
 * timezone from Setup the label would be a lie, so fall back to the zone's
 * own city in that case. */
const seedOf = (id) => PEOPLE.find((p) => p.id === id) || {};
function placeOf(p) {
  const seed = seedOf(p.id);
  return seed.zoneLabel && p.tz === seed.tz ? seed.zoneLabel : zoneName(p.tz);
}

const hasPhoto = (id, iso) => !!dayRec(id, iso).photo;
const thumbOf = (id, iso) => PICS.get(`${id}|${iso}|thumb`) || null;

/* ===================== firebase ===================== */

function boot() {
  if (!FIREBASE.apiKey || !FIREBASE.databaseURL) { S.phase = "noconfig"; return render(); }

  const app = initializeApp(FIREBASE);
  auth = getAuth(app);
  db = getDatabase(app);
  setPersistence(auth, browserLocalPersistence).catch(() => {});

  onAuthStateChanged(auth, (user) => {
    S.user = user;
    if (!user) { S.phase = "signedout"; S.me = null; peopleLoaded = false; return render(); }
    S.phase = "loading";
    subscribe();
    render();
  });
}

/* Identity comes from the database, never from the bundle. Whoever signs in
 * is whichever column already carries their address; if neither does, they
 * claim one, and the rules decide whether that was allowed. Firebase is the
 * authority on who gets in, so a stranger simply cannot read anything. */
let peopleLoaded = false;

function resolveMe() {
  const email = (S.user?.email || "").toLowerCase();
  if (!email) return null;
  for (const p of PEOPLE) {
    const live = S.data.people?.[p.id];
    if (live?.email && String(live.email).toLowerCase() === email) return p.id;
  }
  return null;
}

function settle() {
  if (S.phase === "denied" || S.phase === "signedout") return;
  const found = resolveMe();
  if (found) { S.me = found; S.phase = "ready"; watchTodayPics(); }
  else if (peopleLoaded) { S.me = null; S.phase = "claim"; }
}

async function claim(id) {
  const seed = PEOPLE.find((x) => x.id === id);
  S.claimErr = null;
  try {
    await set(ref(db, `people/${id}`), {
      name: seed.name, tz: seed.tz, start: seed.start, diet: seed.diet,
      email: (S.user?.email || "").toLowerCase()
    });
    if (!S.data.meta?.motto) set(ref(db, "meta/motto"), MOTTO).catch(() => {});
  } catch (e) {
    S.claimErr = e?.code === "PERMISSION_DENIED"
      ? `That column is not yours. Try the other one.`
      : `Could not claim that (${e?.code || e?.message}).`;
    render();
  }
}

let subscribed = false, treeUnsubs = [];
function subscribe() {
  if (subscribed) return;
  subscribed = true;

  // Checkbox state only. Small enough to hold the whole history in memory.
  for (const branch of ["meta", "people", "days"]) {
    treeUnsubs.push(onValue(ref(db, branch), (snap) => {
      S.data = { ...S.data, [branch]: snap.val() || {} };
      if (branch === "people") { peopleLoaded = true; settle(); }
      render();
    }, (err) => {
      if (err?.code === "PERMISSION_DENIED") { S.phase = "denied"; S.me = null; return render(); }
      S.authErr = `Could not read ${branch} (${err.code || err.message}).`;
      render();
    }));
  }

  treeUnsubs.push(onValue(ref(db, ".info/connected"), (snap) => { S.online = !!snap.val(); paintLink(); }));
  watchTodayPics();
}

/* Only today's two photos stay subscribed, so his picture appears the moment
 * he takes it without dragging the whole album along. */
let picUnsubs = [], picKeys = "";
function watchTodayPics() {
  const wanted = everyone().map((p) => `${p.id}|${isoIn(p.tz)}`);
  const sig = wanted.join(",");
  if (sig === picKeys) return;
  picKeys = sig;

  picUnsubs.forEach((u) => { try { u(); } catch {} });
  picUnsubs = wanted.map((key) => {
    const [id, iso] = key.split("|");
    return onValue(ref(db, `pics/${id}/${iso}/thumb`), (snap) => {
      const v = snap.val();
      if (v) PICS.set(`${id}|${iso}|thumb`, v); else PICS.delete(`${id}|${iso}|thumb`);
      render();
    }, () => {});
  });
}

async function loadFull(id, iso) {
  const key = `${id}|${iso}|full`;
  if (PICS.has(key)) return PICS.get(key);
  try {
    const snap = await get(ref(db, `pics/${id}/${iso}/full`));
    const v = snap.val();
    if (v) PICS.set(key, v);
    return v;
  } catch { return null; }
}

async function signIn() {
  S.authErr = null; render();
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = e?.code || "";
    S.authErr =
      code === "auth/unauthorized-domain"
        ? `This address is not on the Firebase allow list yet. In the Firebase console open Authentication, Settings, Authorized domains, and add ${location.hostname}.`
      : code === "auth/popup-blocked"
        ? "Your browser blocked the sign-in popup. Allow popups for this site and try again."
      : code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request"
        ? null
      : code === "auth/operation-not-allowed"
        ? "Google sign-in is not switched on for this Firebase project yet. Open Authentication, Sign-in method, and enable Google."
      : `Sign-in failed (${code || e.message}).`;
    render();
  }
}

/* ===================== writes ===================== */

function flashError(e) {
  S.authErr = `That did not save (${e?.code || e?.message || "unknown error"}).`;
  render();
  setTimeout(() => { S.authErr = null; render(); }, 6000);
}

const todayIso = () => isoIn(person(S.me).tz);

/* A day touched after its own midnight keeps the mark. The stamp is never
 * worth failing the real write for, so it is allowed to fail quietly. */
async function stampLate(iso) {
  if (iso === todayIso()) return;
  S.lateFixed = iso;
  try { await set(ref(db, `days/${S.me}/${iso}/late`), true); } catch { /* cosmetic */ }
}

async function toggleTask(key, iso = todayIso()) {
  if (S.phase !== "ready") return;
  const rec = dayRec(S.me, iso);
  const node = ref(db, `days/${S.me}/${iso}/${key}`);
  try {
    if (key === "water") {
      // The row's own checkbox fills or empties the whole gallon at once.
      await writeWater(waterDone(rec) ? 0 : WATER_TOTAL, iso);
      return;
    }
    rec[key] ? await remove(node) : await set(node, true);
    await stampLate(iso);
  } catch (e) { flashError(e); }
}

/* Every write lands on `waterOz` and clears the old key, so a day only ever
 * carries one format once it has been touched. */
async function writeWater(oz, iso = todayIso()) {
  if (S.phase !== "ready") return;
  const rec = dayRec(S.me, iso);
  const next = Math.max(0, Math.min(WATER_MAX, Math.round(oz)));
  try {
    const node = ref(db, `days/${S.me}/${iso}/waterOz`);
    next <= 0 ? await remove(node) : await set(node, next);
    if (rec.water !== undefined) await remove(ref(db, `days/${S.me}/${iso}/water`));
    await stampLate(iso);
  } catch (e) { flashError(e); }
}
const addWater = (oz) => writeWater(waterOunces(dayRec(S.me, todayIso())) + oz);
const resetWater = () => writeWater(0);

async function saveField(field, value) {
  try { await set(ref(db, `people/${S.me}/${field}`), value); }
  catch (e) { flashError(e); }
}
async function saveMotto(value) {
  try { await set(ref(db, "meta/motto"), value); }
  catch (e) { flashError(e); }
}

/* ===================== photos ===================== */

async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { /* HEIC and friends fall through to the element decoder */ }
  return await new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That image could not be read")); };
    img.src = url;
  });
}

function encode(src, maxPx, budget) {
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  const k = Math.min(1, maxPx / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));

  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(src, 0, 0, w, h);

  let q = 0.8;
  let out = c.toDataURL("image/jpeg", q);
  while (out.length > budget && q > 0.34) { q -= 0.08; out = c.toDataURL("image/jpeg", q); }
  return out;
}

async function savePhoto(file, iso = todayIso()) {
  if (!file) return;
  S.upload = { pct: 0.08, label: "Reading" };
  render();

  try {
    const src = await decode(file);
    S.upload = { pct: 0.35, label: "Resizing" }; paintUpload();
    const full = encode(src, FULL_PX, FULL_BUDGET);
    const thumb = encode(src, THUMB_PX, THUMB_BUDGET);
    src.close?.();

    S.upload = { pct: 0.7, label: "Saving" }; paintUpload();
    await set(ref(db, `pics/${S.me}/${iso}`), { full, thumb });
    await set(ref(db, `days/${S.me}/${iso}/photo`), true);

    PICS.set(`${S.me}|${iso}|full`, full);
    PICS.set(`${S.me}|${iso}|thumb`, thumb);
    await stampLate(iso);
    S.upload = null;
    render();
  } catch (e) {
    S.upload = null;
    flashError(e);
  }
}

async function removePhoto() {
  const iso = todayIso();
  try {
    await remove(ref(db, `days/${S.me}/${iso}/photo`));
    await remove(ref(db, `pics/${S.me}/${iso}`));
    PICS.delete(`${S.me}|${iso}|full`);
    PICS.delete(`${S.me}|${iso}|thumb`);
    render();
  } catch (e) { flashError(e); }
}

/* ===================== render ===================== */

const root = () => document.getElementById("root");

function render() {
  const el = root();
  const scroll = window.scrollY;
  const focusId = document.activeElement?.id || null;
  const caret = document.activeElement?.selectionStart ?? null;

  el.innerHTML =
      S.phase === "boot"      ? screenBoot("Starting up")
    : S.phase === "loading"   ? screenBoot("Signing you in")
    : S.phase === "noconfig"  ? screenNoConfig()
    : S.phase === "signedout" ? screenSignedOut()
    : S.phase === "claim"     ? screenClaim()
    : S.phase === "denied"    ? screenDenied()
    :                           appHTML();

  wire();

  if (scroll) window.scrollTo(0, scroll);
  if (focusId) {
    const again = document.getElementById(focusId);
    if (again) {
      again.focus();
      if (caret != null && again.setSelectionRange) {
        try { again.setSelectionRange(caret, caret); } catch {}
      }
    }
  }
  paintClocks();
}

const errHTML = () => S.authErr ? `<p class="err">${esc(S.authErr)}</p>` : "";

const screenBoot = (what) =>
  `<div class="screen"><div class="screen-in">${MARK}<p class="eyebrow">${esc(what)}</p></div></div>`;

const screenNoConfig = () =>
  `<div class="screen"><div class="screen-in">${MARK}
    <h2 class="disp">Almost there</h2>
    <p>No Firebase project is attached yet. Paste the web config from the Firebase
      console into <b>config.js</b>, put both Google addresses in
      <b>emails.local.json</b>, then run <b>node tools/build-rules.mjs</b> and publish
      the generated rules.</p>
    <p class="fine">Step by step instructions are in SETUP.md in the repository.</p>
  </div></div>`;

const screenSignedOut = () =>
  `<div class="screen"><div class="screen-in">${MARK}
    <h2 class="disp">75 Hard</h2>
    <p>${esc(S.data.meta?.motto || MOTTO)}</p>
    <button class="gbtn" data-signin="1">${GOOGLE} Continue with Google</button>
    <p class="fine">Only ${esc(PEOPLE.map((p) => p.name).join(" and "))} can open this.
      Use the Google account you gave each other.</p>
    ${errHTML()}
  </div></div>`;

function screenClaim() {
  const taken = (id) => !!S.data.people?.[id]?.email;
  const cards = PEOPLE.map((p) => `
    <button class="pick ${p.id}" data-claim="${p.id}"${taken(p.id) ? " disabled" : ""}>
      <span class="nm">${esc(p.name)}</span>
      <span class="sub">${taken(p.id) ? "Taken" : esc(p.relation)}</span>
    </button>`).join("");

  return `<div class="screen"><div class="screen-in">${MARK}
    <h2 class="disp">Which one are you?</h2>
    <p>You are signed in as <b>${esc(S.user?.email || "")}</b>. Claim your column once and
      this account owns it from then on.</p>
    <div class="gate-picks">${cards}</div>
    ${S.claimErr ? `<p class="err">${esc(S.claimErr)}</p>` : ""}
    <button class="btn" data-signout="1">Wrong account, sign out</button>
  </div></div>`;
}

const screenDenied = () =>
  `<div class="screen"><div class="screen-in">${MARK}
    <h2 class="disp">Not on the list</h2>
    <p>You are signed in as <b>${esc(S.user?.email || "")}</b>. Firebase will not let that
      account read this tracker, so it is not one of the two addresses in the rules.
      Sign out and try the other one.</p>
    <button class="gbtn" data-signout="1">Sign out</button>
    ${errHTML()}
  </div></div>`;

function appHTML() {
  const me = person(S.me);
  const body =
      S.tab === "today"  ? viewToday(me)
    : S.tab === "us"     ? viewUs(me)
    : S.tab === "ledger" ? viewLedger()
    :                      viewSetup();

  return `<div class="top">${barHTML(me)}${clocksHTML()}</div>` +
    `<main class="view" id="view"><div class="pad">${body}</div></main>` +
    navHTML(me) +
    (S.lightbox
      ? `<div class="lb" id="lb"><img src="${esc(S.lightbox.src)}" alt="Progress photo">
         <div class="cap">${esc(S.lightbox.cap)}</div></div>`
      : "");
}

const barHTML = (me) => `<header class="bar">
    <h1 class="disp">75 Hard</h1>
    <div class="right">
      <span class="link" id="link"></span>
      <button class="who ${me.id}" data-signout="1" title="Sign out">
        <span class="dot"></span>${esc(me.name)}</button>
    </div></header>`;

const clocksHTML = () => `<div class="clocks">` + everyone().map((p) => `
    <div class="ck" id="ck-${p.id}" style="${accent(p.id)}">
      <div class="nm">${esc(p.name)}<span class="zone">${esc(placeOf(p))}</span></div>
      <div class="t" id="t-${p.id}">--:--:--</div>
      <div class="st" id="s-${p.id}">&nbsp;</div>
    </div>`).join("") + `</div>`;

function navHTML(me) {
  const sc = score(me.id);
  const tabs = [["today", "Today"], ["us", "Us"], ["ledger", "Ledger"], ["setup", "Setup"]];
  return `<nav class="nav" style="--accent-me:var(--${me.id})">` + tabs.map(([k, label]) => {
    const badge = (k === "today" && !sc.todayDone && !sc.finished) ? '<span class="badge"></span>' : "";
    return `<button class="${S.tab === k ? "on" : ""}" data-tab="${k}"
      aria-current="${S.tab === k ? "page" : "false"}">${ICONS[k]}${badge}<span>${label}</span></button>`;
  }).join("") + `</nav>`;
}

/* ---------- yesterday, when it did not close clean ---------- */

/* What finishing yesterday would actually buy, in the only two numbers that
 * matter: the count, and how far the finish line moves back toward honest. */
function fixGain(p, sc, iso) {
  const days = { ...daysOf(p.id) };
  const all = Object.fromEntries(keysOn(p, iso).filter((k) => k !== "water").map((k) => [k, true]));
  days[iso] = { ...(days[iso] || {}), ...all, waterOz: WATER_TOTAL, photo: true };
  const after = scoreFor(person(p.id), days, { goal: GOAL, penalty: PENALTY, today: sc.today });
  return { count: after.count - sc.count, finish: after.finish };
}

function yesterdayHTML(p, sc) {
  if (sc.finished) return "";
  const iso = fixableDay(p, daysOf(p.id), { today: sc.today });

  // Fixed a moment ago: say so rather than vanishing out from under her.
  if (!iso) {
    const y = addDays(sc.today, -1);
    if (S.lateFixed !== y || !isComplete(p.id, y)) return "";
    return `<div class="fixstrip done" style="${accent(p.id)}">
      <div class="fixhd"><b>Yesterday is in.</b>
        <span class="rt">${pretty(y)} &nbsp;·&nbsp; ${requiredOn(p, y)}/${requiredOn(p, y)}</span></div>
      <p>That day counts. Finish line back to <b>${longDate(sc.finish)}</b>.</p></div>`;
  }

  const missing = missingKeys(daysOf(p.id), iso, keysOn(p, iso));
  const label = (k) => LABELS[k] || tasksOn(p, iso).find((t) => t.k === k)?.label || k;
  const gain = fixGain(p, sc, iso);
  const oz = waterOunces(dayRec(p.id, iso));
  const busy = !!S.upload;

  const rows = missing.map((k) => {
    if (k === "water") {
      return `<button class="fixrow" data-fix-water="${iso}">
        <span class="box">${CHECK}</span>
        <span class="lbl"><b>${LABELS.water}</b><small>${WATER_TOTAL - oz} oz short of the gallon</small></span>
        <span class="tag">+${WATER_TOTAL - oz} oz</span></button>`;
    }
    if (k === "photo") {
      return `<button class="fixrow" data-fix-photo="${iso}" ${busy ? "disabled" : ""}>
        <span class="box">${CHECK}</span>
        <span class="lbl"><b>${LABELS.photo}</b><small>Pick yesterday's picture from your camera roll</small></span>
        <span class="tag">${busy ? esc(S.upload.label) + "…" : "Add"}</span></button>`;
    }
    return `<button class="fixrow" data-fix="${k}" data-fix-iso="${iso}">
      <span class="box">${CHECK}</span>
      <span class="lbl"><b>${esc(label(k))}</b><small>Never ticked</small></span>
      <span class="tag">Tick</span></button>`;
  }).join("");

  return `<div class="fixstrip" style="${accent(p.id)}">
    <div class="fixhd"><b>Yesterday did not close clean.</b>
      <span class="rt">${pretty(iso)} &nbsp;·&nbsp; ${doneCount(p.id, iso)}/${requiredOn(p, iso)}</span></div>
    <p>${plural(missing.length, "box", "boxes")} short. If you did them, fill them in:
      worth <b>${plural(gain.count, "day", "days")}</b> on the count and pulls your finish line
      in to <b>${longDate(gain.finish)}</b>.</p>
    <div class="fixrows">${rows}</div>
    <p class="fine">Closes for good at midnight tonight, and the day is marked as a late fix.
      Only yesterday can be touched.</p></div>`;
}

/* ---------- today ---------- */
function viewToday(p) {
  const sc = score(p.id);
  const iso = sc.today;
  const r = dayRec(p.id, iso);
  const thumb = thumbOf(p.id, iso);
  const busy = !!S.upload;

  const oz = waterOunces(r);
  const rows = tasksOn(p, iso).map((t) => {
    if (t.k === "water") return waterRow(oz);
    return `
    <button class="task${r[t.k] ? " on" : ""}" data-task="${t.k}">
      <span class="box">${CHECK}</span>
      <span class="lbl"><b>${t.label}</b><small>${t.diet ? esc(p.diet) : t.sub}</small></span>
      ${t.tag ? `<span class="tag out">${t.tag}</span>` : "<span></span>"}
    </button>`;
  }).join("");

  const slot = thumb
    ? `<img class="shot" src="${esc(thumb)}" alt="Your progress photo for today" data-zoom="${p.id}|${iso}">`
    : r.photo
      ? '<span class="shot empty"><span class="eyebrow" style="font-size:8.5px">Loading</span></span>'
      : '<span class="box"></span>';

  const photoRow = `
    <div class="photorow${r.photo ? " on" : ""}">
      ${slot}
      <span class="lbl"><b>Progress photo</b><small>Required. No photo by midnight is a miss.</small></span>
      <span class="acts">
        <button class="btn sm${r.photo ? "" : " primary"}" data-shoot="1" ${busy ? "disabled" : ""}>
          ${busy ? esc(S.upload.label) + "…" : (r.photo ? "Replace" : "Add photo")}</button>
        ${r.photo && !busy ? '<button class="btn ghost sm" data-unshoot="1">Remove</button>' : ""}
      </span>
    </div>
    ${busy ? `<div class="prog" id="prog"><i style="width:${Math.round(S.upload.pct * 100)}%"></i></div>` : ""}`;

  const banner = sc.finished
    ? '<div class="banner good"><b>Seventy-five.</b> You finished the whole thing.</div>'
    : sc.todayDone
      ? `<div class="banner good"><b>Today is banked.</b> Finish line holds at <b>${longDate(sc.finish)}</b>.</div>`
      : `<div class="banner warn"><b>${plural(sc.left, "box", "boxes")} left.</b>
         Miss tonight and your finish line moves from <b>${shortDate(sc.finish)}</b> to
         <b>${shortDate(sc.finishIfMissed)}</b>, ${plural(sc.costOfMissing, "day", "days")} later.</div>`;

  const soon = startingTomorrow(p, iso).map((x) =>
    `<div class="banner"><b>Starting tomorrow:</b> ${esc(x.label || x.k)} becomes box
      ${WORDS[sc.required + 1] || sc.required + 1}. Today still counts on ${WORDS[sc.required] || sc.required}.</div>`).join("");

  return yesterdayHTML(p, sc) +
    `<div class="hd" style="${accent(p.id)}"><h2>Today</h2>
      <span class="rt">${pretty(iso)} &nbsp;·&nbsp; ${sc.todayCount}/${sc.required}</span></div>
    <div class="tasks" style="${accent(p.id)}">${rows}</div>
    <div style="${accent(p.id)}">${photoRow}${banner}${soon}</div>
    <input type="file" id="shooter" accept="image/*" hidden>
    ${S.authErr ? `<div class="banner warn">${esc(S.authErr)}</div>` : ""}`;
}

function waterRow(oz) {
  const full = oz >= WATER_TOTAL;
  const pct = Math.min(100, Math.round(oz / WATER_TOTAL * 100));
  // The total is printed twice at the same offset, once under the fill and
  // once over it, so it stays legible whatever the level.
  const label = full ? `${oz} oz &middot; gallon done` : `${oz} of ${WATER_TOTAL} oz`;
  const adds = WATER_STEPS.map((n) =>
    `<button class="addw" data-add="${n}" aria-label="Add ${n} ounces">+${n}<span>oz</span></button>`).join("");

  return `
    <button class="task${full ? " on" : ""}" data-task="water">
      <span class="box">${CHECK}</span>
      <span class="lbl"><b>One gallon of water</b>
        <small>${full ? "Gallon done" : `${WATER_TOTAL - oz} oz to go`}</small></span>
      <span class="tag">${oz} oz</span>
    </button>
    <div class="watertray">
      <div class="waterbar" role="progressbar" aria-valuenow="${oz}" aria-valuemin="0"
        aria-valuemax="${WATER_TOTAL}" aria-label="Water toward a gallon">
        <div class="under"><span class="lab">${label}</span></div>
        <div class="fill" style="width:${pct}%"><span class="lab">${label}</span></div>
      </div>
      <div class="addrow">${adds}
        <button class="addw reset" data-water-reset="1" aria-label="Start the water over"
          ${oz ? "" : "disabled"}>${RESET}</button>
      </div>
    </div>`;
}

/* ---------- us ---------- */
function rigHTML(p) {
  const sc = score(p.id);
  const st = statusOf(sc);
  const r = dayRec(p.id, sc.today);
  const dots = [...keysOn(p, sc.today), "photo"].map((k) =>
    `<span class="${(k === "water" ? waterDone(r) : !!r[k]) ? "on" : ""}"></span>`).join("");
  return `<div class="rig" data-pid="${p.id}" style="${accent(p.id)}">
    <div class="rig-head"><span class="rig-name">${esc(p.name)}</span>
      <span class="pill ${st.c}">${st.t}</span></div>
    <div class="count"><span class="n">${sc.count}</span>
      <span class="of"><span class="slash">/ ${GOAL}</span><span class="lbl">Score</span></span></div>
    <div class="meter"><i style="width:${Math.round(sc.count / GOAL * 100)}%"></i></div>
    <div class="dots">${dots}</div>
    <div class="rigstats">
      <span class="stat"><span class="v">${sc.elapsed}</span><span class="k">Calendar day</span></span>
      <span class="stat"><span class="v">${sc.streak}</span><span class="k">Streak</span></span>
      <span class="stat${sc.misses ? " bad" : ""}"><span class="v">${sc.misses ? "−" + sc.misses * PENALTY : "0"}</span><span class="k">Lost to misses</span></span>
      <span class="stat"><span class="v">${shortDate(sc.finish)}</span><span class="k">Finish line</span></span>
    </div></div>`;
}

function viewUs(me) {
  const themId = otherId(me.id);
  if (!themId) return `<div class="duel">${rigHTML(me)}</div>`;
  const them = person(themId);

  const [a, b] = everyone();
  const gap = score(a.id).count - score(b.id).count;
  const duel = `<div class="duel">${rigHTML(a)}
    <div class="versus"><span class="lead">${gap === 0 ? "Dead even" : esc(gap > 0 ? a.name : b.name) + " leads"}</span>
      ${gap === 0 ? "" : `<span class="amt">+${Math.abs(gap)}</span>`}</div>
    ${rigHTML(b)}</div>`;

  const sc = score(them.id);
  const r = dayRec(them.id, sc.today);
  const thumb = thumbOf(them.id, sc.today);
  const items = tasksOn(them, sc.today).map((t) => {
    if (t.k === "water") {
      const o = waterOunces(r);
      return `<li class="${waterDone(r) ? "on" : ""}"><span class="m">${CHECK}</span>${t.label}
        ${o && !waterDone(r) ? `<span class="mini">${o} oz</span>` : ""}</li>`;
    }
    return `<li class="${r[t.k] ? "on" : ""}"><span class="m">${CHECK}</span>${t.label}</li>`;
  }).join("") +
    `<li class="${r.photo ? "on" : ""}"><span class="m">${CHECK}</span>Progress photo</li>`;
  const shot = thumb
    ? `<img class="shot" src="${esc(thumb)}" alt="${esc(them.name)} progress photo" data-zoom="${them.id}|${sc.today}">`
    : `<span class="shot empty"><span class="eyebrow" style="font-size:8.5px">${r.photo ? "Loading" : "No pic<br>yet"}</span></span>`;

  return duel + '<div class="gap"></div>' +
    `<div class="hd" style="${accent(them.id)}"><h2>${esc(them.name)} right now</h2>
      <span class="rt">${pretty(sc.today)} in ${esc(placeOf(them))} &nbsp;·&nbsp; ${sc.todayCount}/${sc.required}</span></div>
     <div class="mirror" style="${accent(them.id)}">${shot}<ul>${items}</ul></div>`;
}

/* ---------- ledger ---------- */
function monthsHTML(p, sc) {
  const first = p.start;
  let last = sc.finish;
  if (diffDays(first, last) < GOAL - 1) last = addDays(first, GOAL - 1);

  let out = "", y = +first.slice(0, 4), m = +first.slice(5, 7), guard = 0;
  const endY = +last.slice(0, 4), endM = +last.slice(5, 7);

  while ((y < endY || (y === endY && m <= endM)) && guard++ < 48) {
    const firstIso = `${y}-${pad(m)}-01`;
    const lead = utc(firstIso).getUTCDay();
    const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let cells = '<div class="day blank"></div>'.repeat(lead);

    for (let d = 1; d <= len; d++) {
      const iso = `${y}-${pad(m)}-${pad(d)}`;
      let cls = "day", label = pretty(iso), attr = "";

      if (iso < p.start || iso > last) cls += " off";
      else if (iso === sc.today) {
        cls += " today" + (isComplete(p.id, iso) ? " done" : "");
        label += ` — today, ${doneCount(p.id, iso)} of ${requiredOn(p, iso)}`;
      } else if (iso > sc.today) { cls += " future"; label += " — still ahead"; }
      else if (isComplete(p.id, iso)) {
        cls += " done";
        label += dayRec(p.id, iso).late ? " — +1, filled in late" : " — clean, +1";
        if (dayRec(p.id, iso).late) cls += " late";
      }
      else { cls += " miss"; label += ` — missed, −${PENALTY}`; }

      if (iso === last && !sc.finished) { cls += " fin"; label += " — projected finish"; }
      if (hasPhoto(p.id, iso) && iso <= sc.today) {
        cls += " haspic";
        attr = ` data-zoom="${p.id}|${iso}"`;
        label += " — has a photo";
      }
      cells += `<div class="${cls}" title="${esc(label)}"${attr}>${d}</div>`;
    }

    out += `<div class="mo"><h4>${fmt(firstIso, { month: "long", year: "numeric" })}</h4>
      <div class="dow">${DOW.map((x) => `<span>${x}</span>`).join("")}</div>
      <div class="days">${cells}</div></div>`;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function viewLedger() {
  const blocks = everyone().map((p) => {
    const sc = score(p.id);
    const head = sc.finished
      ? `<div class="fin">Finished on <b>${longDate(sc.today)}</b></div>
         <div class="sub">${plural(sc.misses, "day", "days")} missed along the way</div>`
      : `<div class="fin">Finish line <b>${longDate(sc.finish)}</b></div>
         <div class="sub${sc.pushed ? " pushed" : ""}">${sc.pushed
            ? `${plural(sc.misses, "miss has", "misses have")} pushed it ${plural(sc.pushed, "day", "days")} past ${shortDate(sc.perfect)}`
            : "clean run, still on the original date"}</div>`;
    return `<div class="ldg" style="${accent(p.id)}">
      <div class="ldg-head"><span class="nm">${esc(p.name)} &middot; ${sc.count} of ${GOAL}</span>${head}</div>
      <div class="months">${monthsHTML(p, sc)}</div></div>`;
  }).join("");

  return `<div class="hd"><h2>Ledger</h2><span class="rt">Every dated day, +1 or −${PENALTY}</span></div>
    <div class="gap"></div>${blocks}
    <div class="legend">
      <span><i style="background:linear-gradient(90deg,var(--mary) 50%,var(--jon) 50%)"></i>Clean, +1</span>
      <span><i style="background:var(--miss-soft);border:1px solid var(--miss)"></i>Missed, −${PENALTY}</span>
      <span><i style="border:2px solid var(--ink-3)"></i>Today</span>
      <span><i style="border:1px dashed var(--rule-2)"></i>Ahead</span>
      <span><i style="box-shadow:0 0 0 2px var(--ink) inset"></i>Finish line</span>
      <span>A dot in the corner means a photo. Tap it.</span>
    </div>`;
}

/* ---------- setup ---------- */
function tzOptions(sel) {
  let list;
  try { list = Intl.supportedValuesOf("timeZone"); } catch { list = null; }
  if (!list?.length) {
    list = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
            "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Europe/London",
            "Europe/Rome", "Asia/Tokyo", "Asia/Manila", "Australia/Sydney"];
  }
  if (!list.includes(sel)) list = [sel, ...list];
  return list.map((z) => `<option value="${esc(z)}"${z === sel ? " selected" : ""}>${esc(z.replace(/_/g, " "))}</option>`).join("");
}

/* One line per extra wicket, so the rule box says who owes what from when. */
const extrasNote = () => everyone().flatMap((p) => (p.extras || []).map((x) =>
  ` ${esc(p.name)} also owes <b>${esc(x.label || x.k)}</b> from ${esc(longDate(x.from))} on;
    days before that still score on the original six.`)).join("");

function viewSetup() {
  const cards = everyone().map((p) => {
    const mine = p.id === S.me;
    const lock = mine ? "" : " disabled";
    return `<div class="setcard" style="${accent(p.id)}"><h3>${esc(p.name)}${mine ? "" : " (theirs)"}</h3>
      <div class="fld"><label for="nm-${p.id}">Name</label>
        <input id="nm-${p.id}" data-set="name" data-pid="${p.id}" value="${esc(p.name)}" maxlength="24"${lock}></div>
      <div class="fld"><label for="dt-${p.id}">Diet rule</label>
        <input id="dt-${p.id}" data-set="diet" data-pid="${p.id}" value="${esc(p.diet)}" maxlength="80"${lock}></div>
      <div class="fld"><label for="st-${p.id}">Start date</label>
        <input id="st-${p.id}" type="date" data-set="start" data-pid="${p.id}" value="${esc(p.start)}"${lock}></div>
      <div class="fld"><label for="tz-${p.id}">Timezone</label>
        <select id="tz-${p.id}" data-set="tz" data-pid="${p.id}"${lock}>${tzOptions(p.tz)}</select>
        <span class="hint">${mine
          ? `Sets your midnight. Right now it is ${esc(pretty(isoIn(p.tz)))} where you are.`
          : `Only ${esc(p.name)} can change these.`}</span></div>
    </div>`;
  }).join("");

  return `<div class="hd"><h2>Setup</h2><span class="rt">${esc(S.user?.email || "")}</span></div>
    <div class="setgrid">${cards}
      <div class="setcard" style="--accent:var(--ink-2);--accent-soft:var(--surface-2)"><h3>Shared</h3>
        <div class="fld"><label for="motto">Motto</label>
          <input id="motto" data-set="motto" value="${esc(S.data.meta?.motto || MOTTO)}" maxlength="60"></div>
        <div class="fld"><label>The rule</label><div class="rulebox">
          Every box done before your own midnight: <b>+1</b>. Anything missing:
          <span class="neg">−${PENALTY}</span>, floor of zero. Past days lock at midnight, so the
          ledger cannot be back-filled. A miss costs the day plus ${PENALTY} off the score, so it
          shoves your finish line up to ${PENALTY + 1} days later. Less if your score is already
          near zero, since it cannot go under.${extrasNote()}
        </div></div>
        <div class="fld"><label>Put it on your home screen</label><div class="rulebox">
          iPhone: open this page in Safari, tap Share, then <b>Add to Home Screen</b>.
          Android: open the menu and tap <b>Install app</b>. It runs full screen with its own
          icon and opens with no signal, though it needs a connection to sync.
        </div></div>
        <div class="fld"><label>Sign out</label>
          <button class="btn" data-signout="1">Sign out of ${esc(S.user?.email || "this account")}</button></div>
      </div>
    </div>
    <div class="gap"></div>
    <div class="banner">${esc(S.data.meta?.motto || MOTTO)}</div>`;
}

/* ===================== wiring ===================== */

function wire() {
  const on = (sel, ev, fn) => document.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));

  on("[data-signin]", "click", signIn);
  on("[data-claim]", "click", (e) => claim(e.currentTarget.getAttribute("data-claim")));

  on("[data-signout]", "click", () => {
    // Detach everything, or signing in again stacks duplicate listeners.
    subscribed = false; peopleLoaded = false; picKeys = "";
    S.claimErr = null;
    [...treeUnsubs, ...picUnsubs].forEach((u) => { try { u(); } catch {} });
    treeUnsubs = []; picUnsubs = []; PICS.clear();
    S.data = { meta: {}, people: {}, days: {} };
    signOut(auth).catch(() => {});
  });

  on("[data-tab]", "click", (e) => {
    S.tab = e.currentTarget.getAttribute("data-tab");
    try { sessionStorage.setItem("h75.tab", S.tab); } catch {}
    render();
    window.scrollTo(0, 0);
  });

  on("[data-add]", "click", (e) => {
    const b = e.currentTarget;
    b.classList.add("pop");
    setTimeout(() => b.classList.remove("pop"), 240);
    addWater(+b.getAttribute("data-add"));
  });
  on("[data-water-reset]", "click", resetWater);

  on("[data-fix]", "click", (e) => {
    const b = e.currentTarget;
    b.classList.add("stamp");
    toggleTask(b.getAttribute("data-fix"), b.getAttribute("data-fix-iso"));
  });
  on("[data-fix-water]", "click", (e) =>
    writeWater(WATER_TOTAL, e.currentTarget.getAttribute("data-fix-water")));
  on("[data-fix-photo]", "click", (e) => {
    S.shootIso = e.currentTarget.getAttribute("data-fix-photo");
    document.getElementById("shooter")?.click();
  });

  on("[data-task]", "click", (e) => {
    const btn = e.currentTarget;
    btn.classList.add("stamp");
    setTimeout(() => btn.classList.remove("stamp"), 320);
    toggleTask(btn.getAttribute("data-task"));
  });

  const shooter = document.getElementById("shooter");
  on("[data-shoot]", "click", () => { S.shootIso = null; shooter?.click(); });
  shooter?.addEventListener("change", () => {
    const f = shooter.files?.[0];
    const iso = S.shootIso || todayIso();
    shooter.value = "";
    S.shootIso = null;
    savePhoto(f, iso);
  });
  on("[data-unshoot]", "click", removePhoto);

  on("[data-zoom]", "click", async (e) => {
    const [id, iso] = e.currentTarget.getAttribute("data-zoom").split("|");
    // Show the thumbnail instantly, then swap in the big one when it lands.
    S.lightbox = { src: thumbOf(id, iso) || "", cap: `${person(id).name} · ${pretty(iso)}` };
    render();
    const full = await loadFull(id, iso);
    if (full && S.lightbox) {
      S.lightbox.src = full;
      const img = document.querySelector("#lb img");
      if (img) img.src = full;
    }
  });
  document.getElementById("lb")?.addEventListener("click", () => { S.lightbox = null; render(); });

  on("[data-set]", "change", (e) => {
    const el = e.currentTarget;
    const field = el.getAttribute("data-set");
    const val = el.value.trim();
    if (field === "motto") return saveMotto(val || MOTTO);
    if (el.getAttribute("data-pid") !== S.me) return;
    if (field === "start" && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return;
    if (field === "name" && !val) return;
    saveField(field, val);
  });
}

/* ===================== painters ===================== */

function paintLink() {
  const el = document.getElementById("link");
  if (!el) return;
  el.dataset.s = S.online ? "ok" : "off";
  el.textContent = S.online ? "live" : "offline";
}

function paintUpload() {
  const bar = document.querySelector("#prog i");
  if (bar && S.upload) bar.style.width = Math.round(S.upload.pct * 100) + "%";
}

function paintClocks() {
  if (S.phase !== "ready") return;
  for (const p of everyone()) {
    const box = document.getElementById(`ck-${p.id}`);
    if (!box) continue;
    const t = untilMidnight(p.tz);
    const sc = score(p.id);
    const tEl = document.getElementById(`t-${p.id}`);
    const sEl = document.getElementById(`s-${p.id}`);
    const urgent = !sc.todayDone && !sc.finished && t.total < 7200;

    box.classList.toggle("done", sc.todayDone || sc.finished);
    box.classList.toggle("urgent", urgent);

    if (sc.finished) { tEl.textContent = "DONE"; sEl.textContent = "all 75 banked"; continue; }
    tEl.textContent = `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`;
    sEl.textContent = sc.todayDone ? `all ${WORDS[sc.required] || sc.required} done, banked` : plural(sc.left, "box left", "boxes left");
  }
  paintLink();
}

const lastDay = {};
setInterval(() => {
  if (S.phase !== "ready") return;
  paintClocks();
  let rolled = false;
  for (const p of everyone()) {
    const d = isoIn(p.tz);
    if (lastDay[p.id] && lastDay[p.id] !== d) rolled = true;
    lastDay[p.id] = d;
  }
  if (rolled) { watchTodayPics(); render(); }   // a midnight passed, yesterday just locked
}, 1000);

/* ===================== go ===================== */

window.addEventListener("online", paintLink);
window.addEventListener("offline", () => { S.online = false; paintLink(); });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  });
}

boot();
