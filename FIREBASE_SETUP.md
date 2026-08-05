# Step-by-step guide: connecting this app to Firebase

Everything is done from the browser — no Node, no terminal, no service
account keys, no emails to configure. Just the Firebase web console.

---

## Step 1 — Create the Firebase project

1. Go to https://console.firebase.google.com/
2. Sign in with your Google account.
3. Click **"Add project"**.
4. Give it a name, e.g. `learning-outcomes-ucvm`.
5. You can turn off Google Analytics. Click **Create project** and wait.

---

## Step 2 — Register the web app

1. In the project panel, click the **`</>`** icon (Web).
2. Nickname, e.g. `learning-outcomes-web`.
3. **Do NOT check** "Set up Firebase Hosting" yet.
4. Click **Register app**. You'll see a block like this:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "learning-outcomes-ucvm.firebaseapp.com",
  projectId: "learning-outcomes-ucvm",
  storageBucket: "learning-outcomes-ucvm.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

5. **Copy that whole object** and paste it into your **`firebaseConfig.js`** file (project root), replacing the placeholder values.
6. Click **"Continue to console"**.

---

## Step 3 — Enable Authentication

1. Left menu: **Build > Authentication** → **Get started**.
2. **Sign-in method** tab → enable **only "Anonymous"**. That's the only
   provider this app uses — access is controlled by codes and by matching
   emails against the instructor list, not by Firebase's own
   email/password or magic-link systems.
3. **Settings > Authorized domains** tab: confirm `localhost` is listed, and add your real domain once you publish (GitHub Pages or Firebase Hosting).

---

## Step 4 — Create Firestore

1. Left menu: **Build > Firestore Database** → **Create database**.
2. Choose the location closest to your users.
3. **"Start in production mode"** → **Enable**.

### Create the academic-year access codes (for instructors without an email on file)

1. **"+ Start collection"** → ID: `accessCodes`.
2. Document ID: `Year 1` → field `code` (string) → your code, e.g. `UCVM-Y1`.
3. Repeat for `Year 2` and `Year 3`.

### Create the administrator code

1. **"+ Start collection"** → ID: `adminAccess`.
2. Document ID: `main` → field `code` (string) → a code only the two of
   you know, e.g. `UCVM-ADMIN-2026`.
3. Save.

(`instructors` and `topics` are created automatically once you import your Excel files in Step 6.)

---

## Step 5 — Publish the security rules

1. In Firestore, go to the **Rules** tab.
2. Delete the existing content and paste the **`firestore.rules`** file (project root), wrapped like this:

```
rules_version = '2';

service cloud.firestore {
  // ... paste the content of firestore.rules here ...
}
```

3. Click **Publish**.

These rules don't use email, passwords, or admin custom claims. Instead:
- Any instructor whose email is already in the imported list can sign in
  instantly by typing it (no proof required — this app trusts convenience
  over strict identity verification for regular instructors, since they
  can only edit their own assigned topics).
- Instructors without an email use the academic-year code.
- Only whoever knows the **admin code** (Step 4) can import/manage data —
  Firestore checks the code server-side; the real value is never exposed
  to the browser.

To change the admin code later, just edit `adminAccess/main` directly in
the Firestore **Data** tab — no redeploy needed.

---

## Step 6 — Test the app and load your data

Since the app uses ES6 modules, don't open `index.html` by double-clicking
— serve it with a simple local server. If you have Python installed:

```bash
python3 -m http.server 5500
```

Open `http://localhost:5500` in your browser.

1. On the login screen, click **"Administrator access"** (small link near the bottom) and enter the admin code from Step 4.
2. You'll land on **`admin.html`**.
3. In the **"Import data from Excel"** section, upload your two files:
   - `Topicinstructor_master_list.xlsx`
   - `Instructorsemails_list.xlsx`
4. Click **"Analyze files"**. Nothing uploads yet — you'll see a list of
   any instructor names that couldn't be matched automatically (e.g. an
   initials-only entry like "CK"), each with a dropdown. Pick the right
   instructor for each one (or leave it as "keep as a new instructor" if
   that's correct).
5. Click **"Confirm and import"**. You'll see progress on
   screen (how many instructors, how many topics, how many rows were
   excluded for being labs/exams/lunch/holidays).

That's it — there's no separate script to run.

---

## Step 7 — Publish (optional)

### Option A: Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # choose "." as the public directory
firebase deploy
```

### Option B: GitHub Pages
1. Enable GitHub Pages on your repository, pointing to the `main` branch / root.
2. In Firebase, add `your-username.github.io` to **Authorized domains**.

---

## Summary — where everything lives

| You need | File |
|---|---|
| Firebase config | `firebaseConfig.js` |
| Security rules | `firestore.rules` |
| Login / identity (shared logic) | `app.js` |
| Topics, outcomes, and export (shared logic) | `dataEngine.js` |
| Import your Excel files (shared logic) | `importEngine.js` |
| Login screen (email / year code / admin code) | `index.html` |
| Instructor dashboard | `dashboard.html` |
| Topic collaboration | `topic.html` |
| Admin panel, import and export | `admin.html` |
