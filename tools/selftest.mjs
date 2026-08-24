/* Checks the scoring rules. Run with:  node tools/selftest.mjs
 *
 * The finish-date maths is the part nobody would notice going wrong, so it
 * gets the most attention here. */

import {
  scoreFor, isoIn, addDays, diffDays,
  waterCount, waterDone, doneCount, isComplete, WATER_UNITS
} from "../core.js";

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  if (Object.is(got, want)) { pass++; return; }
  fail++;
  console.error(`  FAIL  ${what}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};
const group = (name) => console.log(`\n${name}`);

const FULL = { w1: 1, w2: 1, water: WATER_UNITS, read: 1, diet: 1, photo: true };
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
group("Water is counted in glasses");
{
  eq(waterCount({}), 0, "nothing logged is nothing drunk");
  eq(waterCount({ water: 3 }), 3, "three glasses");
  eq(waterCount({ water: WATER_UNITS }), WATER_UNITS, "eight glasses");
  eq(waterCount({ water: true }), WATER_UNITS, "days logged before glasses existed still count");
  eq(waterCount({ water: 99 }), WATER_UNITS, "clamped at a gallon");
  eq(waterCount({ water: -3 }), 0, "clamped at empty");
  eq(waterCount({ water: "lots" }), 0, "junk reads as empty");

  eq(waterDone({ water: 7 }), false, "seven glasses is not a gallon");
  eq(waterDone({ water: 8 }), true, "eight is");
  eq(waterDone({ water: true }), true, "and so is the old format");
}
{
  // A part-drunk gallon must not quietly complete the day.
  const days = { d: { w1: 1, w2: 1, water: 7, read: 1, diet: 1, photo: true } };
  eq(doneCount(days, "d"), 5, "seven glasses leaves the day at five of six");
  eq(isComplete(days, "d"), false, "so the day is not complete");

  const legacy = { d: { w1: 1, w2: 1, water: true, read: 1, diet: 1, photo: true } };
  eq(isComplete(legacy, "d"), true, "a day logged in the old format is still complete");
}
{
  // Scoring has to agree: a run of seven-glass days is a run of misses.
  const days = {};
  for (let d = 1; d <= 5; d++) days["2026-08-0" + d] = { w1: 1, w2: 1, water: 7, read: 1, diet: 1, photo: true };
  const sc = scoreFor({ start: "2026-08-01", tz: "America/New_York" }, days, { today: "2026-08-06" });
  eq(sc.misses, 5, "five short-of-a-gallon days are five misses");
  eq(sc.count, 0, "and score nothing");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
