# Learning Outcomes Collection System

A system for instructors to collaborate on building the final list of
learning outcomes for each academic topic, so the administrator doesn't
have to manually consolidate them. Everything runs in the browser — no
backend, no Node, no separate scripts.

## Project structure (11 code files, no subfolders)

| File | What it contains | When to touch it |
|---|---|---|
| `firebaseConfig.js` | Connection to your Firebase project | Only once, when connecting your project |
| `app.js` | Everything about identity: email login, guest login, session, instructor lookups | If something about login breaks |
| `dataEngine.js` | Everything about data: topics, learning outcomes, progress, activity, and export | If something about outcomes or export breaks |
| `importEngine.js` | Reads your 2 Excel files directly in the browser and uploads them to Firestore | If you need to adjust which rows get excluded during import |
| `index.html` | Login (email + guest), logic included inline | Login design/flow |
| `dashboard.html` | Instructor dashboard | Instructor dashboard |
| `topic.html` | Real-time topic collaboration | How outcomes are added/edited |
| `admin.html` | Stats, data import, filters, and export | Admin dashboard |
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

## Data model (Firestore)

### `instructors/{instructorId}`
```json
{ "instructorId": "I001", "name": "Maria Smith", "email": "maria@email.com", "accessType": "email", "active": true }
```

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
  "activityHistory": [ { "instructorId": "I002", "instructorName": "John Lee", "action": "added outcome #3", "timestamp": "..." } ]
}
```

### `accessCodes/{academicYear}`
```json
{ "code": "UCVM-Y1" }
```

A single `topics/{topicId}` document is shared by all assigned
instructors: when one adds or edits an outcome, everyone sees it in real
time — no duplicated lists per instructor.

## Automatic cleanup of non-teaching rows

`importEngine.js` excludes rows whose `Type` is `LAB` or `Quiz/Midterm`,
or whose `Topic` contains "lunch", "holiday", "midterm", "final exam",
"practical exam", "review session", or rows with no course assigned. The
import result (how many rows were excluded) is shown on screen after
importing.

## Security note

Importing/managing the instructor roster and topics (bulk create/delete)
is restricted to two admin emails, checked server-side by Firestore
(`isAdminEmail()` in `firestore.rules`) — not just by hiding the
`admin.html` URL. Anyone can visit `admin.html`, but only those two
signed-in emails can actually write data; everyone else gets a
permission-denied error if they try. Regular instructors and guests can
still add/edit/delete outcomes on topics they're assigned to (that's
`allow update` on `topics`, open to any signed-in user).

To change who the admins are, edit the email list in both:
- `firestore.rules` → `isAdminEmail()`
- `app.js` → `ADMIN_EMAILS` (controls who can request a login link before any data exists)
- `admin.html` → `ADMIN_EMAILS` (controls whether the import section is shown)

Then republish `firestore.rules` in the Firebase console and re-upload the two JS/HTML files.
