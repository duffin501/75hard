# 75 Hard

A shared tracker for two people doing 75 Hard in two different timezones.
Installs on a phone as an app. Free to run.

**Setup instructions: [SETUP.md](SETUP.md)**

## The six

Every day, before your own local midnight:

- Workout one, 30 minutes minimum
- Workout two, 30 minutes minimum, **outside**
- One gallon of water, added 8, 16 or 24 oz at a time
- Ten pages of non-fiction
- Your diet rule (each person sets their own)
- A progress photo

## The scoring

All six done: **+1**. Anything missing: **−10**, floored at zero.

Past days lock at midnight, so the ledger cannot be back-filled. That is the
point of it.

Because the score is capped below at zero, a miss costs the day plus up to 10,
so it shoves your projected finish date **up to 11 days later**. Less if your
score is already near zero, since it cannot go under. The app shows you that
number before you go to bed, which is the part that actually works.

Each person is scored in their own timezone, so two people in two states each
get their own midnight and their own countdown.

## What it looks like

Four tabs. **Today** is your six boxes and the photo. **Us** is the head to
head scoreboard. **Ledger** is every dated day laid out as calendar months,
with the moving finish line marked. **Setup** is names, diet rules, start
dates and timezones.

Both countdowns sit at the top of every screen and go red inside the last two
hours.

## How it is built

Static files on GitHub Pages, no build step. Firebase Realtime Database for
shared state, Firebase Auth for Google sign-in.

| File | What it does |
|---|---|
| `index.html` | The shell, four lines of it |
| `app.js` | Everything: views, wiring, Firebase, photos |
| `core.js` | Dates and scoring, pure functions, no DOM |
| `styles.css` | The design system, light and dark |
| `config.js` | Firebase settings and the two columns. Public, no addresses |
| `emails.local.json` | Both Google addresses. Gitignored, never served |
| `sw.js` | Service worker, so it opens with no signal |
| `tools/build-rules.mjs` | Generates the security rules from `emails.local.json` |
| `tools/selftest.mjs` | 74 assertions against `core.js` |
| `icons/make_icons.py` | Generates the app icons, no dependencies |

```bash
npm test      # run the scoring tests
npm run rules # regenerate database.rules.json after an email change
npm run icons # regenerate the app icons
```

## Security

Firebase decides who gets in, not the client. The two addresses live in the
security rules and in `emails.local.json`, which is gitignored. Nothing the
browser downloads contains anybody's email, because a static site serves its
source to whoever asks.

Each person can only write their own row, enforced in the rules rather than
just in the client, so it holds even with the console open. On first sign-in
each person claims a column; the rules only allow the right account to claim
the right one.

The Firebase web config in `config.js` is public on purpose. That is how
Firebase web apps work, and it is why the rules do the real work.

## Photos

Photos go in the database, roughly 900px and 110 KB each, not in Cloud
Storage. Firebase started requiring a billing card for Storage in February
2026 and that did not seem like a reasonable thing to need for a family
fitness tracker. 150 photos uses under 2% of the free database allowance.

Only today's two photos stay subscribed. Older ones load when you tap them.
