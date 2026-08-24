/* Dates and scoring. Pure functions, no DOM and no Firebase, so
 * tools/selftest.mjs can run them under Node.
 *
 * The scoring rule: all six done before your own local midnight is +1.
 * Anything missing is -10, floored at zero. Days are evaluated in the
 * person's own timezone, so two people in two states each get their own
 * midnight. */

export const GOAL_DEFAULT = 75;
export const PENALTY_DEFAULT = 10;

/* ---------- dates ---------- */

export const pad = (n) => String(n).padStart(2, "0");
export const toNum = (iso) => { const a = iso.split("-"); return Date.UTC(+a[0], +a[1] - 1, +a[2]); };
export const fromNum = (n) => {
  const d = new Date(n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const addDays = (iso, n) => fromNum(toNum(iso) + n * 86400000);
export const diffDays = (a, b) => Math.round((toNum(b) - toNum(a)) / 86400000);
export const utc = (iso) => new Date(toNum(iso));

/* `now` is injectable so tests are not at the mercy of the wall clock. */
export function isoIn(tz, now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(now);
  }
}

export function untilMidnight(tz, now = new Date()) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const o = {};
  for (const part of f.formatToParts(now)) o[part.type] = part.value;
  const left = 86400 - ((+o.hour % 24) * 3600 + +o.minute * 60 + +o.second);
  return { total: left, h: Math.floor(left / 3600), m: Math.floor((left % 3600) / 60), s: left % 60 };
}

export const fmt = (iso, o) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(utc(iso));
export const pretty = (iso) => fmt(iso, { weekday: "short", month: "short", day: "numeric" });
export const shortDate = (iso) => fmt(iso, { month: "short", day: "numeric" });
export const longDate = (iso) => fmt(iso, { weekday: "long", month: "long", day: "numeric" });
export const zoneName = (tz) => String(tz).split("/").pop().replace(/_/g, " ");

/* ---------- completion ---------- */

export const TASK_KEYS = ["w1", "w2", "water", "read", "diet"];
export const REQUIRED = TASK_KEYS.length + 1;   // the five boxes plus the photo

/* Water is tracked in ounces, added 8, 16 or 24 at a time, against a gallon.
 *
 * It has been stored three ways over the life of this app, and old days must
 * keep reading correctly, so ounces live under their own key rather than
 * overloading the old one. `water: 8` is genuinely ambiguous between eight
 * glasses and eight ounces; `waterOz` is not. */
export const WATER_TOTAL = 128;          // ounces in a gallon
export const WATER_STEPS = [8, 16, 24];  // the add buttons
export const WATER_MAX = 512;            // a sanity ceiling on what gets stored
const GLASS_OZ = 16;                     // the short-lived middle format

export function waterOunces(rec) {
  if (!rec) return 0;
  const clamp = (n) => Math.max(0, Math.min(WATER_MAX, Math.round(n)));

  if (typeof rec.waterOz === "number" && isFinite(rec.waterOz)) return clamp(rec.waterOz);

  const w = rec.water;
  if (w === true) return WATER_TOTAL;                       // the original checkbox
  if (typeof w === "number" && isFinite(w)) return clamp(w * GLASS_OZ);   // the glasses
  return 0;
}
export const waterDone = (rec) => waterOunces(rec) >= WATER_TOTAL;

export function doneCount(days, iso) {
  const r = days?.[iso];
  if (!r) return 0;
  let n = 0;
  for (const k of TASK_KEYS) {
    if (k === "water") { if (waterDone(r)) n++; }
    else if (r[k]) n++;
  }
  if (r.photo) n++;
  return n;
}
export const isComplete = (days, iso) => doneCount(days, iso) === REQUIRED;

/* ---------- scoring ---------- */

/* `person` needs { start, tz }. `days` is that person's map of
 * "YYYY-MM-DD" -> { w1, w2, water, read, diet, photo }. */
export function scoreFor(person, days, opts = {}) {
  const GOAL = opts.goal ?? GOAL_DEFAULT;
  const PENALTY = opts.penalty ?? PENALTY_DEFAULT;
  const today = opts.today ?? isoIn(person.tz, opts.now);

  let cur = person.start;
  if (diffDays(cur, today) < 0) cur = today;      // start date sits in the future

  let count = 0, streak = 0, misses = 0, elapsed = 0, guard = 0;
  while (cur < today && guard++ < 4000) {
    elapsed++;
    if (isComplete(days, cur)) { count = Math.min(GOAL, count + 1); streak++; }
    else { count = Math.max(0, count - PENALTY); streak = 0; misses++; }
    cur = addDays(cur, 1);
  }
  elapsed++;                                       // today itself

  const todayDone = isComplete(days, today);
  if (todayDone) { count = Math.min(GOAL, count + 1); streak++; }

  const finished = count >= GOAL;
  const perfect = addDays(person.start, GOAL - 1);

  // The finish line is a live date. Every clean day pulls it in by one; every
  // miss shoves it back by the penalty plus the day you burned. The floor at
  // zero means an early miss costs less than a late one, which is honest.
  const finish = finished
    ? today
    : addDays(todayDone ? addDays(today, 1) : today, GOAL - count - 1);
  const afterMiss = Math.max(0, count - PENALTY);
  const finishIfMissed = addDays(addDays(today, 1), GOAL - afterMiss - 1);

  const todayCount = doneCount(days, today);
  return {
    count, streak, misses, elapsed, today, todayDone, finished, perfect, finish, finishIfMissed,
    todayCount,
    left: REQUIRED - todayCount,
    pushed: Math.max(0, diffDays(perfect, finish)),
    costOfMissing: diffDays(finish, finishIfMissed)
  };
}
