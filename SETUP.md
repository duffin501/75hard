# Setup

About ten minutes, once. Everything here is free and no card is required.

Do **not** upgrade to the Blaze plan and do **not** turn on Storage. This app
keeps photos in the database precisely so you can stay on the free tier.

---

## 1. Create the Firebase project

Go to [console.firebase.google.com](https://console.firebase.google.com) and sign
in with the Google account that should own this.

- **Create a project**
- Name it whatever you like, `75hard` is fine
- Turn **Google Analytics off**, you do not need it
- Stay on the **Spark** (free) plan

## 2. Add a web app

- On the project overview page, click the **`</>`** (web) icon
- Nickname: `75hard`
- **Leave "Also set up Firebase Hosting" unchecked.** The app lives on GitHub Pages.
- Register the app

Firebase shows a `firebaseConfig = { ... }` block. Keep that tab open, you need
those values in step 6.

## 3. Create the Realtime Database

This is **Realtime Database**, not Firestore. They are different products and
only one of them is wired up here.

- Left sidebar: **Build → Realtime Database → Create Database**
- Location: **United States (us-central1)**
- Start in **locked mode**. The real rules go in at step 7.

Copy the URL at the top. It looks like:

```
https://something-default-rtdb.firebaseio.com
```

> **The thing people get wrong here:** if you registered the web app in step 2
> *before* creating the database, the config block from step 2 has no
> `databaseURL` line at all. Paste this URL into `config.js` by hand.

## 4. Turn on Google sign-in

- **Build → Authentication → Get started**
- **Sign-in method** tab → **Google** → toggle **Enable**
- Pick a support email from the dropdown
- **Save**

## 5. Authorize the web address

Still in Authentication:

- **Settings** tab → **Authorized domains** → **Add domain**
- Add: `duffin501.github.io`

Skip this and sign-in fails with "unauthorized domain". The app says so in
plain language if it happens.

## 6. Fill in the two config files

**`config.js`** takes the seven Firebase values from step 2, plus the database
URL from step 3. No email addresses go in this file. Every visitor to the site
downloads it, so anything in it is public.

**`emails.local.json`** takes both Google addresses. Create it by running the
rules tool once:

```bash
node tools/build-rules.mjs
```

It writes an empty template and stops. Fill it in:

```json
{
  "mary": "your.address@gmail.com",
  "jon": "his.address@gmail.com"
}
```

That file is gitignored and never reaches the browser. The addresses exist
only there and in the Firebase rules.

Get Jon's address from him now rather than debugging it at 11pm. It has to be
the account he actually signs in with, and people often have more than one.

## 7. Generate and publish the security rules

```bash
node tools/build-rules.mjs
```

That writes `database.rules.json` from `emails.local.json`, so the rules and
the addresses can never disagree. It refuses to run if either is missing.

Then in the Firebase console:

- **Realtime Database → Rules** tab
- Replace everything in the box with the contents of `database.rules.json`
- **Publish**

The rules say: those two addresses can read everything, each can only write
their own row, and nobody else can touch anything. `database.rules.json` is
also gitignored, since it contains both addresses. Regenerate it whenever you
need it.

## 8. Deploy

```bash
git add -A && git commit -m "Wire up Firebase" && git push
```

GitHub Pages redeploys in under a minute.

## 9. Claim your columns

Open the site and sign in with Google. The first time, you pick which column
is yours. The rules only let the right account claim the right column, so if
you tap the wrong one it just bounces and tells you.

Jon does the same on his phone. After that neither of you sees that screen
again.

## 10. Put it on your phones

Open the site in Safari (iPhone) or Chrome (Android):

- **iPhone**: Share → **Add to Home Screen**
- **Android**: menu → **Install app**

It gets its own icon, opens full screen with no browser chrome, and still
opens with no signal, though it needs a connection to sync.

---

## If something goes wrong

| What you see | What it means |
|---|---|
| "Almost there" | `config.js` still has empty values |
| "unauthorized domain" | Step 5 was skipped |
| "Google sign-in is not switched on" | Step 4 was skipped |
| "Not on the list" | Step 7 was skipped, or you signed in with an address that is not in the rules |
| "That column is not yours" | You tapped the other person's column on the claim screen |
| Changes do not save | Check the indicator by your name. "offline" means no connection |

## Checking the scoring

```bash
node tools/selftest.mjs
```

46 assertions covering the penalty, the floor at zero, the moving finish date,
two timezones at one instant, and date arithmetic across a daylight saving
change. Run it after touching `core.js`.

## Regenerating the icons

```bash
python icons/make_icons.py
```

Pure Python, no dependencies.

## Deploying a change

Bump `CACHE` in `sw.js` (`75hard-v2` becomes `75hard-v3`) so installed phones
pick the new build up promptly, then commit and push.
