/**
 * importEngine.js
 * ---------------------------------------------------------------
 * Data import DIRECTLY FROM THE BROWSER, no Node, no terminal, and
 * ONE STEP — nothing blocks the upload waiting for a full manual
 * review. Instead:
 *
 *   - An exact name match uploads normally.
 *   - A raw name/text that confidently resolves to exactly ONE real
 *     instructor (either it contains that instructor's full name, or
 *     it looks like initials that match exactly one person) gets
 *     auto-linked.
 *   - Anything ambiguous (0 or 2+ possible matches — e.g. "Sessional:
 *     Garrett Oetelaar or Megan Murphy", which could be either
 *     person) is NOT guessed. It's imported as its own placeholder
 *     instructor (no email) so nothing blocks the rest of the data.
 *
 * The admin then fixes placeholders whenever they have time, one
 * topic at a time, from the persistent "Review topics" section in
 * admin.html (backed by dataEngine.js) — no need to redo the import.
 *
 * Requires an admin session (validated via the admin code — see
 * app.js signInAsAdmin) — enforced by firestore.rules, which only
 * allows writes to "instructors" and "topics" from admin sessions.
 * ---------------------------------------------------------------
 */
import { db } from "./firebaseConfig.js";
import { collection, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Requires admin.html to include:
// <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
// (this creates the global XLSX variable used below)

const EXCLUDED_TYPES = new Set(["LAB", "QUIZ/MIDTERM", "MIDTERM", "EXAM", "FINAL EXAM", "PRACTICAL EXAM", "PRACTICAL", "REVIEW", "REVIEW SESSION", "0"]);
const EXCLUDED_TOPIC_KEYWORDS = ["lunch", "holiday", "orientation camp", "labour day", "midterm", "final exam", "practical exam", "review session", "study day", "reading week"];

function isRealTopicRow(row) {
  const type = String(row.Type ?? "").trim().toUpperCase();
  const topic = String(row.Topic ?? "").trim();
  if (!topic) return false;
  if (EXCLUDED_TYPES.has(type)) return false;
  const topicLower = topic.toLowerCase();
  if (EXCLUDED_TOPIC_KEYWORDS.some((kw) => topicLower.includes(kw))) return false;
  const course = row.Course;
  const hasCourse = course !== 0 && course !== "0" && course !== undefined && course !== null && course !== "";
  return hasCourse;
}

function splitNames(value) {
  if (value === undefined || value === null || typeof value === "number") return [];
  return String(value).split(",").map((n) => n.trim()).filter((n) => n && n !== "0");
}

function normalizeNameKey(name) {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

function looksLikeInitials(text) {
  return /^[A-Z]{2,4}$/.test(text.trim());
}

function computeInitials(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0]?.[0]?.toUpperCase() || "";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(XLSX.read(e.target.result, { type: "array", sheetRows: 5000 }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function readAllSheets(file) {
  const wb = await readWorkbook(file);
  const out = {};
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", range: "A1:P3000" });
    out[sheetName] = rows.map((r) => ({
      Week: r["Week"], "Date Range": r["Date Range"], Course: r["Course"], Type: r["Type"], Topic: r["Topic"],
      "Primary Instructor": r["Primary Instructor"], "Secondary Instructor": r["Secondary Instructor"], "Finalized Instructors": r["Finalized Instructors"],
    }));
  }
  return out;
}

async function readAccessList(file) {
  const wb = await readWorkbook(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", range: "A1:F2000" });
  const byName = new Map();
  for (const r of rows) {
    const displayName = `${r.name} ${r["last name"]}`.trim();
    byName.set(normalizeNameKey(displayName), {
      name: displayName,
      email: String(r.email || "").trim(),
      active: String(r.active || "").toLowerCase() === "yes",
    });
  }
  return byName;
}

function buildInitialsIndex(accessByName) {
  const index = new Map();
  for (const entry of accessByName.values()) {
    const initials = computeInitials(entry.name);
    if (!index.has(initials)) index.set(initials, []);
    index.get(initials).push(entry);
  }
  return index;
}

function findEmbeddedNames(rawText, accessByName) {
  const haystack = normalizeNameKey(rawText);
  const found = [];
  for (const entry of accessByName.values()) {
    if (haystack.includes(normalizeNameKey(entry.name))) found.push(entry);
  }
  return found;
}

/**
 * Pulls plausible person-name candidates out of messy text as a last
 * resort, e.g. "Sessional: Adriana Pastor" -> ["Adriana Pastor"].
 * Looks for runs of 2+ consecutive capitalized words — label text
 * like "Sessional:" naturally breaks the run at the colon, so it
 * doesn't get swept in with the real name.
 */
function extractNameCandidates(text) {
  return text.match(/[A-Z][a-zA-Z''-]+(?:\s+[A-Z][a-zA-Z''-]+)+/g) || [];
}

/**
 * Resolves a chunk of text (no "or" in it) to one or more identities.
 * Always returns at least one — nothing is left as raw, unparsed
 * compound text:
 *   1. Exact match against the email list.
 *   2. Any real instructor names found embedded inside it (handles
 *      chains like "Bovine: Timothy Olchowy Avian: Douglas Whiteside").
 *   3. Initials matching exactly one person.
 *   4. A clean name pulled out via extractNameCandidates(), added as
 *      a brand-new instructor even though they have no email on file.
 *   5. Absolute last resort: the raw text itself.
 */
function resolveChunk(text, accessByName, initialsIndex) {
  const exact = accessByName.get(normalizeNameKey(text));
  if (exact) return [exact];

  const embedded = findEmbeddedNames(text, accessByName);
  if (embedded.length > 0) return embedded;

  if (looksLikeInitials(text)) {
    const candidates = initialsIndex.get(text.trim().toUpperCase()) || [];
    if (candidates.length === 1) return candidates;
  }

  const extracted = extractNameCandidates(text);
  if (extracted.length > 0) {
    return extracted.map((name) => accessByName.get(normalizeNameKey(name)) || { name: name.trim(), email: "", active: true });
  }

  return [{ name: text.trim(), email: "", active: true }];
}

/**
 * Top-level resolver for one raw name/text as it appears in the
 * spreadsheet. If it contains "or" (e.g. "Garrett Oetelaar or Megan
 * Murphy"), we don't know which one taught that specific session —
 * so BOTH get added and BOTH get access to that topic, rather than
 * leaving it unresolved.
 */
function resolveMulti(rawText, accessByName, initialsIndex) {
  if (/\bor\b/i.test(rawText)) {
    const segments = rawText.split(/\s+or\s+/i).map((s) => s.trim()).filter(Boolean);
    return segments.flatMap((seg) => resolveChunk(seg, accessByName, initialsIndex));
  }
  return resolveChunk(rawText, accessByName, initialsIndex);
}

function buildRosterAndTopics(masterRowsByYear, accessByName, initialsIndex) {
  const roster = new Map();
  let newInstructorsWithoutEmail = 0;

  // Stable, deterministic IDs (not a sequential counter): re-importing
  // the same person or the same unmatched raw text always produces the
  // SAME instructor ID, so it correctly updates the existing record
  // instead of creating a duplicate/orphan every time you re-import.
  function ensure(identity) {
    const key = normalizeNameKey(identity.name);
    if (roster.has(key)) return roster.get(key);
    if (!identity.email) newInstructorsWithoutEmail++;
    const prefix = identity.email ? "r-" : "p-"; // "r" = real/matched, "p" = added from a topic name, no email on file
    const id = `${prefix}${slugify(identity.name)}`;
    const record = {
      instructorId: id,
      name: identity.name,
      email: identity.email || "",
      accessType: identity.email ? "email" : "guest",
      active: identity.email ? identity.active : true,
    };
    roster.set(key, record);
    return record;
  }

  const topics = [];
  let excludedCount = 0;
  const counters = new Map();

  for (const year of Object.keys(masterRowsByYear)) {
    for (const row of masterRowsByYear[year]) {
      if (!isRealTopicRow(row)) { excludedCount++; continue; }

      const topicName = String(row.Topic).trim();
      const course = String(row.Course);

      const primary = splitNames(row["Primary Instructor"]);
      const secondary = splitNames(row["Secondary Instructor"]);
      const finalized = splitNames(row["Finalized Instructors"]);
      const roles = {};
      const assignedInstructorIDs = new Set();

      function resolveField(names, role) {
        const resolvedNames = [];
        for (const rawText of names) {
          for (const identity of resolveMulti(rawText, accessByName, initialsIndex)) {
            const rec = ensure(identity);
            assignedInstructorIDs.add(rec.instructorId);
            roles[rec.instructorId] = roles[rec.instructorId] || [];
            if (!roles[rec.instructorId].includes(role)) roles[rec.instructorId].push(role);
            resolvedNames.push(rec.name);
          }
        }
        return resolvedNames;
      }

      const primaryResolved = resolveField(primary, "primary");
      const secondaryResolved = resolveField(secondary, "secondary");
      const finalizedResolved = resolveField(finalized, "finalized");

      const dedupeKey = `${year}-${course}-${slugify(topicName)}`;
      const n = (counters.get(dedupeKey) || 0) + 1;
      counters.set(dedupeKey, n);
      const topicId = n === 1 ? dedupeKey : `${dedupeKey}-${n}`;

      topics.push({
        topicId, academicYear: year, course, topicName,
        primaryInstructorNames: primaryResolved, secondaryInstructorNames: secondaryResolved, finalizedInstructorNames: finalizedResolved,
        assignedInstructorIDs: Array.from(assignedInstructorIDs), instructorRoles: roles,
        outcomes: [], completionStatus: "not_started", activityHistory: [],
      });
    }
  }

  return { roster, topics, excludedCount, newInstructorsWithoutEmail };
}

async function uploadInBatches(collectionName, docs, idField, onProgress) {
  const BATCH_SIZE = 400;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const d of chunk) batch.set(doc(db, collectionName, String(d[idField])), d, { merge: true });
    await batch.commit();
    onProgress?.(Math.min(i + chunk.length, docs.length), docs.length);
  }
}

/**
 * Single entry point: reads both files, resolves what it confidently
 * can, uploads everything (confident matches + placeholders for the
 * rest) in one go. Nothing blocks on manual review — fix placeholders
 * later, incrementally, from the "Review topics" section in admin.html.
 */
export async function importNow(masterListFile, emailsListFile, onProgress = () => {}) {
  onProgress("Reading the master list...");
  const masterRowsByYear = await readAllSheets(masterListFile);

  onProgress("Reading the email list...");
  const accessByName = await readAccessList(emailsListFile);
  const initialsIndex = buildInitialsIndex(accessByName);

  onProgress("Matching instructor names...");
  const { roster, topics, excludedCount, newInstructorsWithoutEmail } = buildRosterAndTopics(masterRowsByYear, accessByName, initialsIndex);
  const instructors = Array.from(roster.values());

  onProgress(`Uploading ${instructors.length} instructors...`);
  await uploadInBatches("instructors", instructors, "instructorId", (done, total) => onProgress(`Instructors: ${done}/${total}`));

  onProgress(`Uploading ${topics.length} topics...`);
  await uploadInBatches("topics", topics, "topicId", (done, total) => onProgress(`Topics: ${done}/${total}`));

  return {
    totalInstructors: instructors.length,
    instructorsWithoutEmail: instructors.filter((i) => !i.email).length,
    totalTopics: topics.length,
    excludedRows: excludedCount,
    newInstructorsWithoutEmail,
  };
}
