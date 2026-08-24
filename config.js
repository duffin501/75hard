/* The only file you edit by hand.
 *
 * 1. Paste the web config from the Firebase console into FIREBASE below.
 * 2. Put both Google addresses in emails.local.json (SETUP.md step 6).
 * 3. Run  node tools/build-rules.mjs  and publish the generated rules.
 *
 * Note what is NOT in here: anybody's email address. Every visitor to the
 * site downloads this file, so anything in it is public. The addresses live
 * only in the Firebase rules, which are private to the console, and in
 * emails.local.json, which is never committed.
 *
 * The Firebase config itself is fine to publish. That is how Firebase web
 * apps are designed to work, and it is why the security rules do the real
 * work of keeping people out. */

export const FIREBASE = {
  apiKey: "AIzaSyCUXgLZkxoNUZpjtx-jyPnEMw232r9hY3U",
  authDomain: "hard-1599c.firebaseapp.com",
  databaseURL: "https://hard-1599c-default-rtdb.firebaseio.com",
  projectId: "hard-1599c",
  storageBucket: "hard-1599c.firebasestorage.app",
  messagingSenderId: "132417017058",
  appId: "1:132417017058:web:e2bb6a905b5b77f8ccbabb"
};

/* The two columns. On first sign-in each person claims one, and the rules
 * only let the right person claim the right column, so a wrong tap just
 * bounces. Everything below is only a starting value: once you are running,
 * each of you can change your own name, timezone, diet rule and start date
 * from the Setup tab. */
export const PEOPLE = [
  {
    id: "mary",
    name: "Mary",
    relation: "Sister",
    tz: "America/New_York",
    // What the clock says under your name. Falls back to the timezone's own
    // city if you ever change the timezone from the Setup tab.
    zoneLabel: "Virginia",
    start: "2026-08-24",
    diet: "150 g protein, track every calorie"
  },
  {
    id: "jon",
    name: "Jon",
    relation: "Brother",
    tz: "America/Denver",
    zoneLabel: "Utah",
    start: "2026-08-24",
    diet: "Protein-dense breakfast"
  }
];

export const GOAL = 75;
export const PENALTY = 10;
export const MOTTO = "For us. For our kids.";
