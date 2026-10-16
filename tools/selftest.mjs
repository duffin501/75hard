/* Checks the scoring rules. Run with:  node tools/selftest.mjs
 *
 * The finish-date maths is the part nobody would notice going wrong, so it
 * gets the most attention here. */

import {
  scoreFor, isoIn, addDays, diffDays,
  waterOunces, waterDone, doneCount, isComplete, WATER_TOTAL, WATER_STEPS, WATER_MAX,
  keysOn, requiredOn,
  fixableDay, missingKeys, REQUIRED
} from "../core.js";
import { PEOPLE } from "../config.js";

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  if (Object.is(got, want)) { pass++; return; }
  fail++;
  console.error(`  FAIL  ${what}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};
const group = (name) => console.log(`\n${name}`);

const FULL = { w1: 1, w2: 1, waterOz: WATER_TOTAL, read: 1, diet: 1, photo: true };
const PARTIAL = { w1: 1, w2: 1, read: 1, diet: 1, photo: true };   // no water

/* Builds a day map from `from` to `to` inclusive, with `holes` left incomplete. */
function run(from, to, holes = []) {
  const days = {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days[d] = holes.includes(d) ? { ...PARTIAL } : { ...FULL };
  }
  return days;
}

const MARY = { start: "2026-07-01", tz: "America/New_York" };

/* ------------------------------------------------------------------ */
group("A clean run, mid-stride");
{
  const days = run("2026-07-01", "2026-08-23");
  const sc = scoreFor(MARY, days, { today: "2026-08-23" });
  eq(sc.count, 54, "54 clean days scores 54");
  eq(sc.misses, 0, "no misses");
  eq(sc.streak, 54, "streak counts every day");
  eq(sc.elapsed, 54, "calendar day 54");
  eq(sc.perfect, "2026-09-13", "a perfect run would end Sep 13");
  eq(sc.finish, "2026-09-13", "and it is still on that date");
  eq(sc.pushed, 0, "nothing has pushed it");
}

/* ------------------------------------------------------------------ */
group("One miss, well clear of the floor");
{
  const days = run("2026-07-01", "2026-08-23", ["2026-08-10"]);
  const sc = scoreFor(MARY, days, { today: "2026-08-23" });
  eq(sc.count, 43, "40 up, minus 10, plus 13 back = 43");
  eq(sc.misses, 1, "one missed day");
  eq(sc.streak, 13, "streak restarted after the miss");
  eq(sc.finish, "2026-09-24", "finish line is Sep 24");
  eq(sc.pushed, 11, "one miss costs 11 days: the penalty plus the day itself");
}

/* ------------------------------------------------------------------ */
group("The cost of missing tonight");
{
  const days = run("2026-07-01", "2026-08-22", ["2026-08-10"]);   // today untouched
  const sc = scoreFor(MARY, days, { today: "2026-08-23" });
  eq(sc.count, 42, "today is not banked yet");
  eq(sc.todayDone, false, "today incomplete");
  eq(sc.left, 6, "all six still open");
  eq(sc.costOfMissing, 11, "missing tonight would cost 11 days");
}

/* ------------------------------------------------------------------ */
group("The floor at zero");
{
  const days = run("2026-08-16", "2026-08-23", ["2026-08-18"]);
  const sc = scoreFor({ start: "2026-08-16", tz: "America/New_York" }, days, { today: "2026-08-23" });
  eq(sc.count, 5, "2 up, minus 10 floors to 0, then 5 back");
  eq(sc.misses, 1, "one missed day");
  eq(sc.elapsed, 8, "calendar day 8");
}
{
  // At zero the penalty has nothing left to take, so a miss costs one day.
  const sc = scoreFor({ start: "2026-08-23", tz: "America/New_York" }, {}, { today: "2026-08-23" });
  eq(sc.count, 0, "day one, nothing done");
  eq(sc.elapsed, 1, "calendar day 1");
  eq(sc.finish, addDays("2026-08-23", 74), "75 clean days from today");
  eq(sc.costOfMissing, 1, "at zero, a miss only costs the day itself");
  eq(sc.pushed, 0, "nothing pushed yet");
}

/* ------------------------------------------------------------------ */
group("Two misses in a row wipe a small score");
{
  const days = run("2026-08-16", "2026-08-23", ["2026-08-21", "2026-08-22"]);
  const sc = scoreFor({ start: "2026-08-16", tz: "America/New_York" }, days, { today: "2026-08-23" });
  eq(sc.count, 1, "back to zero, then today puts one on the board");
  eq(sc.misses, 2, "two missed days");
  eq(sc.streak, 1, "streak is just today");
}

/* ------------------------------------------------------------------ */
group("Finishing");
{
  const days = run("2026-07-01", "2026-09-13");
  const sc = scoreFor(MARY, days, { today: "2026-09-13" });
  eq(sc.count, 75, "75 clean days");
  eq(sc.finished, true, "finished");
  eq(sc.finish, "2026-09-13", "finished today");
}
{
  // The score is capped, so an extra clean day cannot push it past the goal.
  const days = run("2026-07-01", "2026-09-20");
  const sc = scoreFor(MARY, days, { today: "2026-09-20" });
  eq(sc.count, 75, "score stops at 75");
}

/* ------------------------------------------------------------------ */
group("A start date in the future");
{
  const sc = scoreFor({ start: "2026-09-01", tz: "America/New_York" }, {}, { today: "2026-08-23" });
  eq(sc.count, 0, "nothing scored before you begin");
  eq(sc.elapsed, 1, "no elapsed days are invented");
  eq(sc.misses, 0, "and no penalties for days that have not happened");
}

/* ------------------------------------------------------------------ */
group("Two timezones, one instant");
{
  // 05:30 UTC is just past midnight in New York and still the day before in Denver.
  const now = new Date("2026-08-24T05:30:00Z");
  eq(isoIn("America/New_York", now), "2026-08-24", "New York has rolled over");
  eq(isoIn("America/Denver", now), "2026-08-23", "Denver has not");

  const days = run("2026-08-20", "2026-08-23");
  const east = scoreFor({ start: "2026-08-20", tz: "America/New_York" }, days, { now });
  const west = scoreFor({ start: "2026-08-20", tz: "America/Denver" }, days, { now });
  eq(east.today, "2026-08-24", "east is on the new day");
  eq(east.todayDone, false, "and has done nothing on it yet");
  eq(east.count, 4, "four banked days behind it");
  eq(west.today, "2026-08-23", "west is still on the old day");
  eq(west.todayDone, true, "which is already complete");
  eq(west.count, 4, "same four days, different clock");
}

/* ------------------------------------------------------------------ */
group("Date arithmetic survives a daylight saving change");
{
  // US clocks go back on 2026-11-01. Pure UTC date maths must not drift.
  eq(addDays("2026-10-31", 2), "2026-11-02", "two days across the change");
  eq(diffDays("2026-10-25", "2026-11-08"), 14, "a fortnight is still 14 days");
  eq(addDays("2026-02-27", 2), "2026-03-01", "2026 is not a leap year");
  eq(addDays("2024-02-27", 2), "2024-02-29", "2024 was");
}

/* ------------------------------------------------------------------ */
group("Water is counted in ounces");
{
  eq(waterOunces({}), 0, "nothing logged is nothing drunk");
  eq(waterOunces({ waterOz: 48 }), 48, "ounces read straight back");
  eq(waterOunces({ waterOz: 0 }), 0, "an explicit zero is zero");
  eq(waterOunces({ waterOz: WATER_MAX + 500 }), WATER_MAX, "clamped at the ceiling");
  eq(waterOunces({ waterOz: -20 }), 0, "clamped at empty");
  eq(waterOunces({ waterOz: "lots" }), 0, "junk reads as empty");

  eq(waterDone({ waterOz: 120 }), false, "120 oz is short of a gallon");
  eq(waterDone({ waterOz: WATER_TOTAL }), true, "128 is the gallon");
  eq(waterDone({ waterOz: 200 }), true, "drinking more than a gallon still counts");
}

group("Water written in older shapes still reads");
{
  // Three formats have existed. Days logged under any of them must survive.
  eq(waterOunces({ water: true }), WATER_TOTAL, "the original checkbox was a gallon");
  eq(waterOunces({ water: 8 }), WATER_TOTAL, "eight glasses was a gallon");
  eq(waterOunces({ water: 3 }), 48, "three glasses was 48 oz");
  eq(waterOunces({ water: 0 }), 0, "no glasses was nothing");
  eq(waterOunces({ waterOz: 40, water: 8 }), 40,
     "once ounces are written they win, so a half-migrated day is not double counted");

  eq(isComplete({ d: { w1: 1, w2: 1, water: true, read: 1, diet: 1, photo: true } }, "d"), true,
     "a day from the checkbox era is still complete");
  eq(isComplete({ d: { w1: 1, w2: 1, water: 8, read: 1, diet: 1, photo: true } }, "d"), true,
     "and so is one from the glasses era");
}

group("A short gallon does not complete the day");
{
  const days = { d: { w1: 1, w2: 1, waterOz: 120, read: 1, diet: 1, photo: true } };
  eq(doneCount(days, "d"), 5, "120 oz leaves the day at five of six");
  eq(isComplete(days, "d"), false, "so the day is not complete");

  const scDays = {};
  for (let d = 1; d <= 5; d++) scDays[`2026-08-0${d}`] = { w1: 1, w2: 1, waterOz: 120, read: 1, diet: 1, photo: true };
  const sc = scoreFor({ start: "2026-08-01", tz: "America/New_York" }, scDays, { today: "2026-08-06" });
  eq(sc.misses, 5, "five short days are five misses");
  eq(sc.count, 0, "and score nothing");
}

group("The add buttons can land on a gallon, and overshooting is fine");
{
  eq(WATER_STEPS.join(","), "8,16,24", "the three offered amounts");

  // 24 does not divide 128, so the biggest button alone overshoots. What
  // matters is that some combination lands exactly, and that going over
  // still counts rather than being treated as a mistake.
  const reachable = (target, steps) => {
    const seen = new Set([0]);
    let edge = [0];
    while (edge.length) {
      const next = [];
      for (const v of edge) for (const st of steps) {
        const n = v + st;
        if (n === target) return true;
        if (n < target && !seen.has(n)) { seen.add(n); next.push(n); }
      }
      edge = next;
    }
    return false;
  };
  eq(reachable(WATER_TOTAL, WATER_STEPS), true, "a gallon is reachable exactly");
  eq(WATER_TOTAL % 24, 8, "though not by +24 alone: it lands on 120, then +8 finishes it");

  let oz = 0, taps = 0;
  while (oz + 24 <= WATER_TOTAL) { oz += 24; taps++; }
  eq(oz, 120, "five taps of +24 gets to 120");
  eq(oz + 8, WATER_TOTAL, "and one +8 closes it");

  // Overshooting records what was actually drunk and still completes the day.
  eq(waterDone({ waterOz: 144 }), true, "144 oz still counts as the gallon");
  const over = { d: { w1: 1, w2: 1, waterOz: 144, read: 1, diet: 1, photo: true } };
  eq(isComplete(over, "d"), true, "and completes the day");
  eq(waterOunces({ waterOz: 144 }), 144, "without quietly rounding down to 128");
}

/* ------------------------------------------------------------------ */
group("An extra wicket counts from its own date forward, never backward");
{
  // Jon exactly as config.js has him, with fifty clean days behind him.
  const JON = PEOPLE.find((p) => p.id === "jon");
  const FROM = "2026-10-14";
  eq(JON.extras?.[0]?.k, "media", "Jon carries the media wicket");
  eq(JON.extras?.[0]?.from, FROM, "starting 14 Oct");

  eq(requiredOn(JON, "2026-10-13"), 6, "the day before it, six boxes");
  eq(requiredOn(JON, FROM), 7, "from its first day, seven");
  eq(keysOn(JON, FROM).at(-1), "media", "and the seventh is media");
  eq(requiredOn(PEOPLE.find((p) => p.id === "mary"), FROM), 6, "Mary is untouched");

  // The whole point: nothing already banked turns into a miss.
  const banked = run(JON.start, "2026-10-12");
  const now = scoreFor(JON, banked, { today: "2026-10-13" });
  eq(now.count, 50, "fifty clean days still score fifty");
  eq(now.misses, 0, "with no misses invented");
  eq(now.required, 6, "and today still asks for six");

  // From the 14th, a day without media is a miss and a day with it is clean.
  const sixOnly = { ...banked, "2026-10-13": { ...FULL }, [FROM]: { ...FULL } };
  const withMedia = { ...sixOnly, [FROM]: { ...FULL, media: true } };
  eq(isComplete(sixOnly, FROM, keysOn(JON, FROM)), false, "six of seven on the 14th is not done");
  eq(isComplete(withMedia, FROM, keysOn(JON, FROM)), true, "seven of seven is");
  eq(doneCount(sixOnly, FROM, keysOn(JON, FROM)), 6, "it reads as 6 of 7");

  const t = scoreFor(JON, withMedia, { today: FROM });
  eq(t.required, 7, "today asks for seven");
  eq(t.todayDone, true, "and is banked at seven");
  eq(t.count, 52, "fifty, plus the 13th, plus the 14th");
  eq(scoreFor(JON, sixOnly, { today: "2026-10-15" }).misses, 1,
    "skipping media on the 14th is a miss once the 15th arrives");

  // A media tick on a day before the wicket existed is ignored.
  eq(doneCount({ d: { ...FULL, media: true } }, "d", keysOn(JON, "2026-10-13")), 6,
    "a stray tick before the start date does not count");

  // Yesterday's fix strip asks for the seventh box too, once it exists.
  const y14 = { [FROM]: { ...FULL } };
  eq(missingKeys(y14, FROM, keysOn(JON, FROM)).join(","), "media", "a six-box 14th is short only media");
  eq(fixableDay(JON, y14, { today: "2026-10-15" }), FROM, "so it is offered on the 15th");
}

/* ------------------------------------------------------------------ */
group("Yesterday stays open for one day, and only for a day that was underway");
{
  const TODAY = "2026-09-13";
  const Y = "2026-09-12";
  const P = { start: "2026-08-24", tz: "America/New_York" };

  // The real case this was built for: everything done, two boxes untapped.
  const near = { [Y]: { w1: 1, w2: 1, diet: 1, photo: true, waterOz: 120 } };
  eq(missingKeys(near, Y).join(","), "water,read", "a short gallon and the reading are what is missing");
  eq(doneCount(near, Y), 4, "which leaves the day at 4 of 6");
  eq(fixableDay(P, near, { today: TODAY }), Y, "so yesterday is offered");

  // A day that closed clean has nothing to offer.
  const clean = { [Y]: { w1: 1, w2: 1, read: 1, diet: 1, photo: true, waterOz: WATER_TOTAL } };
  eq(fixableDay(P, clean, { today: TODAY }), null, "a clean yesterday is not offered");

  // An untouched day is a day off, not a correction.
  eq(fixableDay(P, {}, { today: TODAY }), null, "a day with nothing logged is not offered");
  eq(missingKeys({}, Y).length, REQUIRED, "and it reads as all six missing");
  const oneBox = { [Y]: { w1: 1 } };
  eq(fixableDay(P, oneBox, { today: TODAY }), Y, "one tap is enough to call it underway");

  // Nothing older than yesterday is ever reachable.
  const older = { "2026-09-11": { w1: 1, w2: 1, diet: 1, photo: true } };
  eq(fixableDay(P, older, { today: TODAY }), null, "the day before yesterday is shut");

  // Day one has no yesterday inside the challenge.
  eq(fixableDay(P, { "2026-08-23": { w1: 1 } }, { today: "2026-08-24" }), null,
    "the day before the start date is not offered");

  // Filling it in is worth eleven days: the -10 becomes a +1. Scored against
  // a real run, nineteen clean days behind it, which is the case that hit.
  const real = { ...run(P.start, "2026-09-11"), ...near };
  const before = scoreFor(P, real, { today: TODAY });
  eq(before.count, 9, "nineteen clean days minus the ten for one miss");
  eq(before.misses, 1, "one miss on the board");
  eq(before.finish, "2026-11-17", "finish line shoved out to Nov 17");

  const after = scoreFor(P, { ...real, [Y]: { ...near[Y], read: 1, waterOz: WATER_TOTAL } }, { today: TODAY });
  eq(after.count - before.count, 11, "fixing the day swings the count by eleven");
  eq(after.count, 20, "twenty clean days");
  eq(diffDays(after.finish, before.finish), 11, "and pulls the finish line in by eleven days");
  eq(after.finish, "2026-11-06", "back to the original date");
  eq(after.misses, 0, "with the miss gone");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
