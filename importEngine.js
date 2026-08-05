/**
 * importEngine.js
 * ---------------------------------------------------------------
 * Data import DIRECTLY FROM THE BROWSER, no Node, no
 * terminal. The administrator uploads the two Excel files in
 * admin.html, this file reads them with SheetJS (loaded via CDN in
 * the HTML), normalizes them the same way as before, and writes
 * everything to Firestore using the browser SDK (writeBatch) —
 * exactly like a normal query.
 *
 * Requires that the current user is a real instructor (signed in
 * with email, not a guest) — see firestore.rules, which only allows
 * writes to "instructors" and "topics" from non-anonymous users.
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

/** Reads an <input type="file"> and returns the SheetJS workbook. */
function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(XLSX.read(e.target.result, { type: "array" }));
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
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
    out[sheetName] = rows.map((r) => ({
      Week: r["Week"], "Date Range": r["Date Range"], Course: r["Course"], Type: r["Type"], Topic: r["Topic"],
      "Primary Instructor": r["Primary Instructor"], "Secondary Instructor": r["Secondary Instructor"], "Finalized Instructors": r["Finalized Instructors"],
    }));
  }
  return out;
}

async function readAccessList(file) {
  const wb = await readWorkbook(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
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

function buildInstructorRoster(masterRowsByYear, accessByName) {
  const roster = new Map();
  let counter = 1;
  function ensure(name) {
    const key = normalizeNameKey(name);
    if (roster.has(key)) return roster.get(key);
    const access = accessByName.get(key);
    const id = `I${String(counter++).padStart(3, "0")}`;
    const record = { instructorId: id, name, email: access?.email || "", accessType: access?.email ? "email" : "guest", active: access ? access.active : true };
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
  return roster;
}

function buildTopics(masterRowsByYear, roster) {
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

      function tag(names, role) {
        for (const n of names) {
          const rec = roster.get(normalizeNameKey(n));
          if (!rec) continue;
          assignedInstructorIDs.add(rec.instructorId);
          roles[rec.instructorId] = roles[rec.instructorId] || [];
          if (!roles[rec.instructorId].includes(role)) roles[rec.instructorId].push(role);
        }
      }
      tag(primary, "primary"); tag(secondary, "secondary"); tag(finalized, "finalized");

      const course = String(row.Course);
      const topicName = String(row.Topic).trim();
      const dedupeKey = `${year}-${course}-${slugify(topicName)}`;
      const n = (counters.get(dedupeKey) || 0) + 1;
      counters.set(dedupeKey, n);
      const topicId = n === 1 ? dedupeKey : `${dedupeKey}-${n}`;

      topics.push({
        topicId, academicYear: year, course, topicName,
        primaryInstructorNames: primary, secondaryInstructorNames: secondary, finalizedInstructorNames: finalized,
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
 * Single entry point: receives the two <input type="file"> elements, processes
 * everything, and uploads it to Firestore. onProgress(message) keeps the UI informed.
 */
export async function importFromExcelFiles(masterListFile, emailsListFile, onProgress = () => {}) {
  onProgress("Reading the master list...");
  const masterRowsByYear = await readAllSheets(masterListFile);

  onProgress("Reading the email list...");
  const accessByName = await readAccessList(emailsListFile);

  onProgress("Normalizing instructors...");
  const roster = buildInstructorRoster(masterRowsByYear, accessByName);
  const instructors = Array.from(roster.values());

  onProgress("Normalizing topics...");
  const { topics, excludedCount } = buildTopics(masterRowsByYear, roster);

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
