#  Learning Outcomes Collection System

A system for instructors to collaborate on building the final list of
learning outcomes for each academic topic, so the administrator doesn't
have to manually consolidate them. Everything runs in the browser — no
backend, no Node, no separate scripts.

## Project structure (11 code files, no subfolders)

| File | What it contains | When to touch it |
|---|---|---|
| `firebaseConfig.js` | Connection to your Firebase project | Only once, when connecting your project |
| `app.js` | Everything about identity: instructor name search, admin code, session, instructor lookups | If something about login breaks |
| `dataEngine.js` | Everything about data: topics, learning outcomes, progress, activity, export, and fixing unmatched instructors | If something about outcomes, export, or the review-topics tool breaks |
| `importEngine.js` | Reads your 2 Excel files in the browser and uploads to Firestore in one step | If you need to adjust which rows get excluded, or how name-matching works |
| `index.html` | Sign-in (instructor name search + admin code), logic included inline | Login design/flow |
| `dashboard.html` | Instructor dashboard | Instructor dashboard |
| `topic.html` | Real-time topic collaboration | How outcomes are added/edited |
| `admin.html` | Import, stats, review topics, filters, export | Admin dashboard |
| `style.css` | All the design | Visual changes |
| `firestore.rules` | Security rules (paste into the Firebase console) | Who can read/write what |
| `FIREBASE_SETUP.md` | Step-by-step setup guide | — |

**Why it's organized this way:** each HTML page carries its own screen
logic inline (it's rarely reused between pages). What IS shared lives in
exactly 3 files: `app.js` (identity), `dataEngine.js` (data), and
`importEngine.js` (import). No Node, no terminal, no service account keys.

**Your Excel files are not part of the repository** — they contain
private instructor data. You upload them directly in `admin.html`
whenever you need to import or refresh data.

## Access model

- **Instructors**: search their name on the sign-in screen and click it.
  No email, no password, no code — as simple as typing into a search box.
- **Administrators** (able to import/manage data): need a separate admin
  code, entered via the small "Administrator access" link.

See the Security note below for exactly how this is enforced.

## Data model (Firestore)

### `instructors/{instructorId}`
```json
{ "instructorId": "I001", "name": "Maria Smith", "email": "maria@email.com", "accessType": "email", "active": true }
```
(`email` is optional — instructors without one just don't have it set; it's not used for login anymore, only for reference/export.)

### `topics/{topicId}`
```json
{
  "topicId": "year-1-206-cell-structure",
  "academicYear": "Year 1", "course": "206", "topicName": "Cell Structure",
  "assignedInstructorIDs": ["I001", "I002"],
  "instructorRoles": { "I001": ["primary"], "I002": ["secondary"] },
  "outcomes": [
    { "outcomeNumber": 1, "text": "Students will identify cell organelles.",
      "createdBy": "I001", "createdByName": "Maria Smith", "createdAt": "...",
      "updatedBy": "I001", "updatedByName": "Maria Smith", "updatedAt": "..." }
  ],
  "completionStatus": "in_progress",
  "activityHistory": [
    { "instructorId": "I002", "instructorName": "John Lee", "action": "added outcome #3", "timestamp": "..." }
  ]
}
```

A single `topics/{topicId}` document is shared by all assigned
instructors: when one adds or edits an outcome, everyone sees it in real
time — no duplicated lists per instructor.

## Import: one step, with incremental cleanup

`importEngine.js` reads both Excel files and uploads everything in one
click. Rows whose `Type` is `LAB` or `Quiz/Midterm`, or whose `Topic`
contains "lunch", "holiday", "midterm", "final exam", "practical exam",
"review session", or rows with no course, are excluded automatically.

For instructor names: an exact match links normally. A name that
confidently resolves to exactly one real instructor (either it's found
embedded inside messy text like "Sessional: Jane Doe", or it looks like
initials matching exactly one person) gets auto-linked too. Anything
ambiguous (0 or 2+ possible matches) imports as its own placeholder
instructor instead of guessing — nothing blocks the rest of the import.

Fix placeholders afterward, whenever you have time, from the **"Review
topics"** section in `admin.html`: it lists every topic that still has a
placeholder, one at a time, with a dropdown and an "Accept" button per
topic. Progress is saved to Firestore immediately, so you can do a few
today and the rest tomorrow — nothing is lost between sessions.

## Security note

There's no email verification, no passwords, and no PINs anywhere in this
app — access is controlled by a single admin code, checked server-side by
Firestore, never exposed to the browser:

- **Instructors** just search their name and pick it — no proof of
  identity is required. This trusts convenience over strict verification,
  since instructors can only edit outcomes on topics they're assigned to.
- **Administrators** need the admin code (`adminAccess/main` in
  Firestore). Firestore compares the code submitted against the real one
  internally (`isAdmin()` in `firestore.rules`) — the real code is never
  readable by any client, even a signed-in one.

To change the admin code, edit `adminAccess/main` directly in the
Firestore **Data** tab — no redeploy needed.
