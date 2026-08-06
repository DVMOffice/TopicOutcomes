/**
 * importEngine.js
 * ---------------------------------------------------------------
 * Data import DIRECTLY FROM THE BROWSER, no Node, no terminal.
 *
 * This is a TWO-STEP process on purpose, because instructor names in
 * the master list are often messy — not just "CK" instead of
 * "Cameron Knight", but compound text like:
 *   "Sessional: Garrett Oetelaar or Megan Murphy"
 * which actually contains TWO real instructors mixed with a label.
 * Nothing gets auto-matched and uploaded silently:
 *
 *   1. analyzeImport(masterFile, emailsFile) reads both files and
 *      returns ONE REVIEW ROW PER TOPIC OCCURRENCE for any raw text
 *      that isn't an exact match — with suggestions pre-filled by
 *      searching for real instructor names embedded inside the raw
 *      text (and, for short all-caps text like "CK", by initials).
 *   2. The admin reviews that list in admin.html, per topic, and
 *      adjusts the selection if needed (the same raw text can mean
 *      different people in different topics — e.g. "or" usually
 *      means only ONE of the two taught that specific session).
 *   3. finalizeImport(..., mappings) applies those confirmed choices
 *      and uploads everything to Firestore.
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

/**
 * Finds real instructor names embedded inside messy raw text, e.g.
 * "Sessional: Garrett Oetelaar or Megan Murphy" contains both
 * "Garrett Oetelaar" and "Megan Murphy" — this just checks whether
 * each known full name appears as a substring, which works
 * regardless of labels, colons, "or"/"and", etc. around it.
 */
function findEmbeddedNames(rawText, accessByName) {
  const haystack = normalizeNameKey(rawText);
  const found = [];
  for (const entry of accessByName.values()) {
    if (haystack.includes(normalizeNameKey(entry.name))) found.push(entry.name);
  }
  return found;
}

function suggestNames(rawText, accessByName, initialsIndex) {
  const embedded = findEmbeddedNames(rawText, accessByName);
  if (embedded.length > 0) return embedded;
  if (looksLikeInitials(rawText)) {
    const candidates = initialsIndex.get(rawText.trim().toUpperCase()) || [];
    return candidates.map((c) => c.name);
  }
  return [];
}

// ================================================================
// STEP 1 — Analyze: one review row per TOPIC OCCURRENCE that needs
// a human decision (not grouped globally by raw text, since the
// same raw text can mean different people in different topics).
// ================================================================

function occurrenceKey(year, course, topic, role, rawText) {
  return `${year}|${course}|${topic}|${role}|${rawText}`;
}

export async function analyzeImport(masterListFile, emailsListFile, onProgress = () => {}) {
  onProgress("Reading the master list...");
  const masterRowsByYear = await readAllSheets(masterListFile);

  onProgress("Reading the email list...");
  const accessByName = await readAccessList(emailsListFile);
  const initialsIndex = buildInitialsIndex(accessByName);

  onProgress("Comparing instructor names...");
  const allInstructorNames = Array.from(accessByName.values()).map((a) => a.name).sort();

  const reviewItems = [];
  let totalRawNameSlots = 0;

  for (const year of Object.keys(masterRowsByYear)) {
    for (const row of masterRowsByYear[year]) {
      if (!isRealTopicRow(row)) continue;
      const topic = String(row.Topic).trim();
      const course = String(row.Course);

      const roleFields = [
        ["primary", splitNames(row["Primary Instructor"])],
        ["secondary", splitNames(row["Secondary Instructor"])],
        ["finalized", splitNames(row["Finalized Instructors"])],
      ];

      for (const [role, names] of roleFields) {
        for (const rawText of names) {
          totalRawNameSlots++;
          if (accessByName.has(normalizeNameKey(rawText))) continue; // exact match, no review needed

          reviewItems.push({
            key: occurrenceKey(year, course, topic, role, rawText),
            rawText,
            year, course, topic, role,
            suggestions: suggestNames(rawText, accessByName, initialsIndex),
          });
        }
      }
    }
  }

  return {
    masterRowsByYear,
    accessByName,
    allInstructorNames,
    reviewItems,
    autoMatchedCount: totalRawNameSlots - reviewItems.length,
    totalRawNames: totalRawNameSlots,
  };
}

// ================================================================
// STEP 2 — Finalize: apply the admin's confirmed per-occurrence
// mappings and upload.
// ================================================================

function buildRosterAndTopics(masterRowsByYear, accessByName, mappings) {
  const roster = new Map();
  let counter = 1;

  function resolveOccurrence(year, course, topic, role, rawText) {
    const exact = accessByName.get(normalizeNameKey(rawText));
    if (exact) return [exact];
    const key = occurrenceKey(year, course, topic, role, rawText);
    const mapped = mappings[key];
    if (Array.isArray(mapped) && mapped.length > 0) {
      const resolved = mapped.map((n) => accessByName.get(normalizeNameKey(n))).filter(Boolean);
      if (resolved.length > 0) return resolved;
    }
    return [{ name: rawText, email: "", active: true }]; // keep as a new placeholder instructor
  }

  function ensureAll(identities) {
    return identities.map((identity) => {
      const key = normalizeNameKey(identity.name);
      if (roster.has(key)) return roster.get(key);
      const id = `I${String(counter++).padStart(3, "0")}`;
      const record = {
        instructorId: id,
        name: identity.name,
        email: identity.email || "",
        accessType: identity.email ? "email" : "guest",
        active: identity.email ? identity.active : true,
      };
      roster.set(key, record);
      return record;
    });
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
          const identities = resolveOccurrence(year, course, topicName, role, rawText);
          const records = ensureAll(identities);
          for (const rec of records) {
            resolvedNames.push(rec.name);
            assignedInstructorIDs.add(rec.instructorId);
            roles[rec.instructorId] = roles[rec.instructorId] || [];
            if (!roles[rec.instructorId].includes(role)) roles[rec.instructorId].push(role);
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

  return { roster, topics, excludedCount };
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
 * mappings: { [occurrenceKey]: string[] } — the instructor full
 * name(s) the admin chose for that SPECIFIC topic occurrence. An
 * empty array / missing entry means "keep this raw text as its own
 * new instructor" for that occurrence.
 */
export async function finalizeImport(masterRowsByYear, accessByName, mappings, onProgress = () => {}) {
  onProgress("Applying your choices...");
  const { roster, topics, excludedCount } = buildRosterAndTopics(masterRowsByYear, accessByName, mappings);
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
  };
}
