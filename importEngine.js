/**
 * importEngine.js
 * ---------------------------------------------------------------
 * Data import DIRECTLY FROM THE BROWSER, no Node, no terminal.
 *
 * This is a TWO-STEP process on purpose, because instructor names in
 * the master list don't always match the email list exactly (e.g.
 * "CK" instead of "Cameron Knight"). Nothing gets auto-matched and
 * uploaded silently:
 *
 *   1. analyzeImport(masterFile, emailsFile) reads both files and
 *      returns every raw instructor name that could NOT be matched
 *      with certainty, plus suggestions where possible (e.g. if the
 *      text looks like initials and matches exactly one instructor).
 *   2. The admin reviews that list in admin.html and picks the right
 *      instructor (or "keep as a new instructor") for each one.
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
    // Some spreadsheets report a huge used-range (thousands of blank
    // formatted columns/rows) even though the real data is a small
    // corner of the sheet. Without bounding the range, parsing that
    // full reported range can freeze the browser tab. Our real data
    // never goes past column P or row 3000, so we cap it there.
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

function collectRawNames(masterRowsByYear) {
  const raw = new Set();
  for (const year of Object.keys(masterRowsByYear)) {
    for (const row of masterRowsByYear[year]) {
      if (!isRealTopicRow(row)) continue;
      for (const n of [...splitNames(row["Primary Instructor"]), ...splitNames(row["Secondary Instructor"]), ...splitNames(row["Finalized Instructors"])]) {
        raw.add(n);
      }
    }
  }
  return Array.from(raw);
}

// ================================================================
// STEP 1 — Analyze: find every name that needs a human decision
// ================================================================

/**
 * Reads both files and returns everything needed to review + finalize.
 * Nothing is uploaded yet.
 */
export async function analyzeImport(masterListFile, emailsListFile, onProgress = () => {}) {
  onProgress("Reading the master list...");
  const masterRowsByYear = await readAllSheets(masterListFile);

  onProgress("Reading the email list...");
  const accessByName = await readAccessList(emailsListFile);
  const initialsIndex = buildInitialsIndex(accessByName);

  onProgress("Comparing instructor names...");
  const rawNames = collectRawNames(masterRowsByYear);
  const allInstructorNames = Array.from(accessByName.values()).map((a) => a.name).sort();

  const reviewItems = [];
  for (const raw of rawNames) {
    if (accessByName.has(normalizeNameKey(raw))) continue; // exact match, no review needed

    let suggestions = [];
    if (looksLikeInitials(raw)) {
      const candidates = initialsIndex.get(raw.trim().toUpperCase()) || [];
      suggestions = candidates.map((c) => c.name);
    }
    reviewItems.push({ rawText: raw, suggestions });
  }

  return {
    masterRowsByYear,
    accessByName,
    allInstructorNames,
    reviewItems,           // [{ rawText: "CK", suggestions: ["Cameron Knight"] }, ...]
    autoMatchedCount: rawNames.length - reviewItems.length,
    totalRawNames: rawNames.length,
  };
}

// ================================================================
// STEP 2 — Finalize: apply the admin's confirmed mappings and upload
// ================================================================

function buildRoster(masterRowsByYear, accessByName, mappings) {
  const roster = new Map();
  let counter = 1;

  function resolve(rawName) {
    const exact = accessByName.get(normalizeNameKey(rawName));
    if (exact) return exact;
    const mapped = mappings[rawName]; // full instructor name chosen by the admin, or "" / undefined = keep as new
    if (mapped && accessByName.has(normalizeNameKey(mapped))) return accessByName.get(normalizeNameKey(mapped));
    return { name: rawName, email: "", active: true };
  }

  function ensure(rawName) {
    const identity = resolve(rawName);
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
  }

  for (const year of Object.keys(masterRowsByYear)) {
    for (const row of masterRowsByYear[year]) {
      if (!isRealTopicRow(row)) continue;
      const names = new Set([...splitNames(row["Primary Instructor"]), ...splitNames(row["Secondary Instructor"]), ...splitNames(row["Finalized Instructors"])]);
      for (const n of names) ensure(n);
    }
  }
  return { roster, resolve };
}

function buildTopics(masterRowsByYear, roster, resolve) {
  const topics = [];
  let excludedCount = 0;
  const counters = new Map();

  for (const year of Object.keys(masterRowsByYear)) {
    for (const row of masterRowsByYear[year]) {
      if (!isRealTopicRow(row)) { excludedCount++; continue; }

      const primary = splitNames(row["Primary Instructor"]);
      const secondary = splitNames(row["Secondary Instructor"]);
      const finalized = splitNames(row["Finalized Instructors"]);
      const roles = {};
      const assignedInstructorIDs = new Set();

      const primaryResolved = primary.map((n) => resolve(n).name);
      const secondaryResolved = secondary.map((n) => resolve(n).name);
      const finalizedResolved = finalized.map((n) => resolve(n).name);

      function tag(resolvedNames, role) {
        for (const n of resolvedNames) {
          const rec = roster.get(normalizeNameKey(n));
          if (!rec) continue;
          assignedInstructorIDs.add(rec.instructorId);
          roles[rec.instructorId] = roles[rec.instructorId] || [];
          if (!roles[rec.instructorId].includes(role)) roles[rec.instructorId].push(role);
        }
      }
      tag(primaryResolved, "primary"); tag(secondaryResolved, "secondary"); tag(finalizedResolved, "finalized");

      const course = String(row.Course);
      const topicName = String(row.Topic).trim();
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
  return { topics, excludedCount };
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
 * mappings: { [rawText]: chosenFullInstructorName_or_empty_string }
 * An empty string / missing entry means "keep this raw name as its
 * own new instructor" (created with no email).
 */
export async function finalizeImport(masterRowsByYear, accessByName, mappings, onProgress = () => {}) {
  onProgress("Applying your name mappings...");
  const { roster, resolve } = buildRoster(masterRowsByYear, accessByName, mappings);
  const instructors = Array.from(roster.values());

  onProgress("Building topics...");
  const { topics, excludedCount } = buildTopics(masterRowsByYear, roster, resolve);

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
