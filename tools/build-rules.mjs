/* Generates the Firebase database rules. Run it after changing an address:
 *
 *     node tools/build-rules.mjs
 *
 * Then paste database.rules.json into Realtime Database, Rules, and press
 * Publish. There is no storage.rules, because photos live in the database.
 *
 * Addresses are read from emails.local.json, which is gitignored and never
 * shipped to the browser. They belong in the rules and nowhere else: the
 * client bundle is public to anyone who loads the page.
 *
 * The shape of it: both people can read everything, each person can only
 * write their own row, and nobody else can touch anything at all. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PEOPLE } from "../config.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const secretsPath = join(repo, "emails.local.json");

if (!existsSync(secretsPath)) {
  const template = Object.fromEntries(PEOPLE.map((p) => [p.id, ""]));
  writeFileSync(secretsPath, JSON.stringify(template, null, 2) + "\n");
  console.error(
    `\nCreated emails.local.json. Put each Google address in it, then run this again:\n\n` +
    `${JSON.stringify(template, null, 2)}\n\n` +
    `That file is gitignored on purpose. Do not move these into config.js.\n`
  );
  process.exit(1);
}

const secrets = JSON.parse(readFileSync(secretsPath, "utf8"));
const lower = (e) => String(e || "").trim().toLowerCase();

const missing = PEOPLE.filter((p) => !lower(secrets[p.id]).includes("@"));
if (missing.length) {
  console.error(
    `\nStop: ${missing.map((p) => p.name).join(" and ")} has no address in emails.local.json.\n` +
    `Fill it in first, otherwise the rules would lock that person out.\n`
  );
  process.exit(1);
}

const emailOf = (p) => lower(secrets[p.id]);
const emails = PEOPLE.map(emailOf);

if (new Set(emails).size !== emails.length) {
  console.error("\nStop: both entries in emails.local.json are the same address.\n");
  process.exit(1);
}

// A signed-in, verified Google account belonging to one of the two.
const verified = "auth !== null && auth.token.email_verified === true";
const guard = `${verified} && (${emails.map((e) => `auth.token.email === '${e}'`).join(" || ")})`;
const owner = (p) => `${verified} && auth.token.email === '${emailOf(p)}'`;

// Ceilings on the stored JPEG data URLs, roughly 300 KB and 45 KB of actual
// picture. Generous next to what the app writes, tight enough that a bug
// cannot quietly fill the free tier.
const FULL_MAX = 400_000;
const THUMB_MAX = 60_000;

const perPerson = (build) => Object.fromEntries(PEOPLE.map((p) => [p.id, build(p)]));

/* ---------------------------------------------------------------------------
 * The NAVS 302 check-in form lives in this same Firebase project, so its rules
 * have to be generated here too. Publishing replaces the entire ruleset:
 * leaving this branch out breaks the form, leaving the branches below out
 * breaks 75 Hard. One project, one generator, one paste.
 *
 * Shape of it: a student's phone signs in anonymously and owns exactly one
 * record, keyed by its own uid. It can write that record and read it back, and
 * that is the whole list. It cannot read the roster, cannot see a classmate's
 * phone number, cannot touch anybody else's row. Mary reads everything and can
 * delete. Flipping /navs302/closed to true stops new submissions without
 * anyone editing rules again.
 * ------------------------------------------------------------------------- */

const mary = PEOPLE.find((p) => p.id === "mary");
if (!mary) {
  console.error("\nStop: no person with id 'mary' in config.js, so the NAVS 302 rules have no owner.\n");
  process.exit(1);
}
const maryGuard = owner(mary);

const IMG_MAX = 400_000;
const str = (max) => ({ ".validate": `newData.isString() && newData.val().length <= ${max}` });
const required = (max) =>
  ({ ".validate": `newData.isString() && newData.val().length > 0 && newData.val().length <= ${max}` });

const navs302 = {
  ".read": maryGuard,
  ".write": false,

  // Public on purpose. The form checks this one boolean before letting anyone
  // submit, and a student is not signed in as anybody who could read more.
  closed: { ".read": true, ".write": maryGuard },

  responses: {
    ".read": maryGuard,
    $uid: {
      ".read": "auth !== null && auth.uid === $uid",
      // Own your row, or be Mary. An absent /closed counts as open, so a fresh
      // database does not silently reject the whole class.
      ".write":
        `(auth !== null && auth.uid === $uid && root.child('navs302/closed').val() !== true) || (${maryGuard})`,
      ".validate":
        "newData.hasChildren(['uid','at','name','email','phone','service','physical'])",

      uid:      { ".validate": "newData.isString() && newData.val() === auth.uid" },
      at:       required(40),
      name:     required(120),
      email:    required(160),
      phone:    required(40),
      service:  required(200),
      physical: required(500),
      concerns: str(2000),
      img:      str(IMG_MAX),
      imgName:  str(200),
      $other:   { ".validate": false }
    }
  }
};

const database = {
  rules: {
    ".read": false,
    ".write": false,

    navs302,

    meta: { ".read": guard, ".write": guard },

    people: {
      ".read": guard,
      ...perPerson((p) => ({
        ".write": owner(p),
        // You cannot write someone else's address into your own row, which
        // also means you cannot lock yourself out by fat-fingering it.
        email: { ".validate": `newData.val() === '${emailOf(p)}'` }
      }))
    },

    days: { ".read": guard, ...perPerson((p) => ({ ".write": owner(p) })) },

    pics: {
      ".read": guard,
      ...perPerson((p) => ({
        ".write": owner(p),
        $date: {
          full:  { ".validate": `newData.isString() && newData.val().length <= ${FULL_MAX}` },
          thumb: { ".validate": `newData.isString() && newData.val().length <= ${THUMB_MAX}` },
          $other: { ".validate": false }
        }
      }))
    }
  }
};

writeFileSync(join(repo, "database.rules.json"), JSON.stringify(database, null, 2) + "\n");

console.log("Wrote database.rules.json:");
for (const p of PEOPLE) {
  console.log(`  ${p.name.padEnd(6)} ${emailOf(p).padEnd(30)} owns /people/${p.id}, /days/${p.id}, /pics/${p.id}`);
}
console.log(`  ${mary.name.padEnd(6)} ${emailOf(mary).padEnd(30)} reads /navs302 (NAVS 302 check-in roster)`);
console.log("  anon   students                       write /navs302/responses/<own uid> only, read nothing else");
console.log("\nPaste it into Firebase, Realtime Database, Rules, then press Publish.");

const cfg = readFileSync(join(repo, "config.js"), "utf8");
if (/apiKey:\s*""/.test(cfg)) {
  console.log("\nNote: FIREBASE.apiKey in config.js is still empty, so the app shows the setup screen.");
}
if (/@/.test(cfg)) {
  console.log("\nWarning: config.js appears to contain an email address. That file is public. Remove it.");
}
