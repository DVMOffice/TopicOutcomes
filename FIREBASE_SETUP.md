# Step-by-step guide: connecting this app to Firebase

Everything is done from the browser — no Node, no terminal, no service
account keys. Just the Firebase web console.

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

5. **Copy that whole object** and paste it into your **`firebaseConfig.js`** file (project root), replacing the `"REPLACE_..."` placeholder values.
6. Click **"Continue to console"**.

---

## Step 3 — Enable Authentication

1. Left menu: **Build > Authentication** → **Get started**.
2. **Sign-in method** tab → enable **"Email/Password"**, and within that same card also enable **"Email link (passwordless sign-in)"**.
3. Also enable **"Anonymous"** (used for guest access).
4. **Settings > Authorized domains** tab: confirm `localhost` is listed, and add your real domain once you publish (GitHub Pages or Firebase Hosting).

---

## Step 4 — Create Firestore

1. Left menu: **Build > Firestore Database** → **Create database**.
2. Choose the location closest to your users.
3. **"Start in production mode"** → **Enable**.

### Create the guest access codes

1. **"+ Start collection"** → ID: `accessCodes`.
2. Document ID: `Year 1` → field `code` (string) → your code, e.g. `UCVM-Y1`.
3. Repeat for `Year 2` and `Year 3`.

(`instructors` and `topics` are created automatically once you import your Excel files in Step 6.)

---

## Step 5 — Publish the security rules

1. In Firestore, go to the **Rules** tab.
2. Delete the existing content and paste the **`firestore.rules`** file (project root).
3. Click **Publish**.

These rules don't require admin custom claims or a service account: they
check `request.auth.token.email` directly against a short list of admin
emails inside `isAdminEmail()`. Only those emails can import/manage the
instructor roster and topics; everyone else who's signed in can still
read everything and add/edit outcomes on their own topics. To change who
the admins are, edit the email list in `isAdminEmail()` (in this file),
and also in `ADMIN_EMAILS` inside `app.js` and `admin.html` — then
republish these rules and re-upload those two files.

---

## Step 6 — Test the app and load your data

Since the app uses ES6 modules, don't open `index.html` by double-clicking
— serve it with a simple local server. If you have Python installed:

```bash
python3 -m http.server 5500
```

Open `http://localhost:5500` in your browser.

1. **Sign in** with a real email that exists in your instructor list.
2. Go to **`admin.html`**.
3. In the **"Import data from Excel"** section, upload your two files:
   - `Topicinstructor_master_list.xlsx`
   - `Instructorsemails_list.xlsx`
4. Click **"Import and upload to Firestore"**. You'll see progress on
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
| Login screen | `index.html` |
| Instructor dashboard | `dashboard.html` |
| Topic collaboration | `topic.html` |
| Admin panel, import and export | `admin.html` |
