/**
 * dataEngine.js
 * ---------------------------------------------------------------
 * Everything related to "the data" lives here:
 *   - Read the topics assigned to an instructor
 *   - Listen to a topic in real time (shared collaboration)
 *   - Add / edit / delete learning outcomes
 *   - Calculate progress
 *   - Flatten and export (CSV / Excel / JSON, ready for Power Query)
 *
 * If you need to fix anything about outcomes, progress, or
 * exports, do it HERE, in this single file.
 * ---------------------------------------------------------------
 */
import { db } from "./firebaseConfig.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  runTransaction,
  writeBatch,
  deleteDoc,
  updateDoc,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MIN_OUTCOMES = 6; // used only to gauge progress %, not enforced as a hard limit

function computeStatus(outcomes) {
  if (!outcomes || outcomes.length === 0) return "not_started";
  if (outcomes.length < MIN_OUTCOMES) return "in_progress";
  return "complete";
}

function activityEntry(action, instructorId, instructorName) {
  return { instructorId, instructorName, action, timestamp: Timestamp.now() };
}

// ================================================================
// LECTURA DE TEMAS
// ================================================================

export async function getTopicsForInstructor(instructorId) {
  const q = query(collection(db, "topics"), where("assignedInstructorIDs", "array-contains", instructorId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getAllTopics() {
  const snap = await getDocs(collection(db, "topics"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getTopic(topicId) {
  const snap = await getDoc(doc(db, "topics", topicId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function listenToTopic(topicId, callback) {
  return onSnapshot(doc(db, "topics", topicId), (snap) => {
    if (snap.exists()) callback({ id: snap.id, ...snap.data() });
  });
}

// ================================================================
// ESCRITURA DE RESULTADOS DE APRENDIZAJE (colaborativo)
// ================================================================

export async function addOutcome(topicId, { text, species, organSystem, instructorId, instructorName }) {
  const ref = doc(db, "topics", topicId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Session not found");
    const data = snap.data();
    const outcomes = data.outcomes || [];
    const now = Timestamp.now();
    const newOutcome = {
      outcomeNumber: outcomes.length + 1,
      text: text.trim(),
      species: species || "",
      organSystem: organSystem || "",
      createdBy: instructorId,
      createdByName: instructorName,
      createdAt: now,
      updatedBy: instructorId,
      updatedByName: instructorName,
      updatedAt: now,
    };
    const updatedOutcomes = [...outcomes, newOutcome];
    tx.update(ref, {
      outcomes: updatedOutcomes,
      completionStatus: computeStatus(updatedOutcomes),
      activityHistory: [
        activityEntry(`added outcome #${newOutcome.outcomeNumber}`, instructorId, instructorName),
        ...(data.activityHistory || []).slice(0, 49),
      ],
    });
  });
}

/**
 * Adds several outcomes at once (e.g. pasted from a document), all in
 * a single transaction. `texts` is an array of already-split outcome
 * strings; species/organSystem apply to all of them (edit individually
 * afterward if a specific one needs something different).
 */
export async function addOutcomesBulk(topicId, texts, { species, organSystem, instructorId, instructorName }) {
  if (!texts || texts.length === 0) return;
  const ref = doc(db, "topics", topicId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Session not found");
    const data = snap.data();
    const outcomes = data.outcomes || [];
    const now = Timestamp.now();
    const newOutcomes = texts.map((text, i) => ({
      outcomeNumber: outcomes.length + i + 1,
      text: text.trim(),
      species: species || "",
      organSystem: organSystem || "",
      createdBy: instructorId,
      createdByName: instructorName,
      createdAt: now,
      updatedBy: instructorId,
      updatedByName: instructorName,
      updatedAt: now,
    }));
    const updatedOutcomes = [...outcomes, ...newOutcomes];
    tx.update(ref, {
      outcomes: updatedOutcomes,
      completionStatus: computeStatus(updatedOutcomes),
      activityHistory: [
        activityEntry(`added ${texts.length} outcomes`, instructorId, instructorName),
        ...(data.activityHistory || []).slice(0, 49),
      ],
    });
  });
}

export async function updateOutcome(topicId, outcomeNumber, { text, species, organSystem, instructorId, instructorName }) {
  const ref = doc(db, "topics", topicId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Session not found");
    const data = snap.data();
    const outcomes = [...(data.outcomes || [])];
    const idx = outcomes.findIndex((o) => o.outcomeNumber === outcomeNumber);
    if (idx === -1) throw new Error("Outcome not found");

    outcomes[idx] = {
      ...outcomes[idx],
      text: text.trim(),
      species: species !== undefined ? species : outcomes[idx].species || "",
      organSystem: organSystem !== undefined ? organSystem : outcomes[idx].organSystem || "",
      updatedBy: instructorId,
      updatedByName: instructorName,
      updatedAt: Timestamp.now(),
    };

    tx.update(ref, {
      outcomes,
      completionStatus: computeStatus(outcomes),
      activityHistory: [
        activityEntry(`updated outcome #${outcomeNumber}`, instructorId, instructorName),
        ...(data.activityHistory || []).slice(0, 49),
      ],
    });
  });
}

export async function deleteOutcome(topicId, outcomeNumber, { instructorId, instructorName }) {
  const ref = doc(db, "topics", topicId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Session not found");
    const data = snap.data();
    const outcomes = (data.outcomes || [])
      .filter((o) => o.outcomeNumber !== outcomeNumber)
      .map((o, i) => ({ ...o, outcomeNumber: i + 1 }));

    tx.update(ref, {
      outcomes,
      completionStatus: computeStatus(outcomes),
      activityHistory: [
        activityEntry(`deleted an outcome`, instructorId, instructorName),
        ...(data.activityHistory || []).slice(0, 49),
      ],
    });
  });
}

// ================================================================
// PROGRESO
// ================================================================

export function summarizeInstructorProgress(topics) {
  const total = topics.length;
  const complete = topics.filter((t) => t.completionStatus === "complete").length;
  return { total, complete, percent: total === 0 ? 0 : Math.round((complete / total) * 100) };
}

export function topicPercent(topic) {
  const n = (topic.outcomes || []).length;
  return Math.min(100, Math.round((n / MIN_OUTCOMES) * 100));
}

// ================================================================
// EXPORT (flat, ready for Power Query)
// ================================================================

const EXPORT_COLUMNS = [
  "Academic Year", "Course", "Topic",
  "Primary Instructor", "Secondary Instructor", "Finalized Instructor",
  "Completion Status", "Outcome Number", "Outcome Text", "Species", "Organ System",
  "Added By", "Added Date", "Last Updated By", "Last Updated Date",
];

function toISO(ts) {
  if (!ts) return "";
  const date = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  return isNaN(date) ? "" : date.toISOString();
}

export function applyFilters(topics, filters = {}) {
  return topics.filter((t) => {
    if (filters.academicYear && t.academicYear !== filters.academicYear) return false;
    if (filters.course && String(t.course) !== String(filters.course)) return false;
    if (filters.completionStatus && t.completionStatus !== filters.completionStatus) return false;
    if (filters.instructorId && !(t.assignedInstructorIDs || []).includes(filters.instructorId)) return false;
    return true;
  });
}

export function flattenToRows(topics) {
  const rows = [];
  for (const t of topics) {
    const primary = (t.primaryInstructorNames || []).join("; ");
    const secondary = (t.secondaryInstructorNames || []).join("; ");
    const finalized = (t.finalizedInstructorNames || []).join("; ");
    const base = {
      "Academic Year": t.academicYear,
      Course: t.course,
      Topic: t.topicName,
      "Primary Instructor": primary,
      "Secondary Instructor": secondary,
      "Finalized Instructor": finalized,
      "Completion Status": t.completionStatus,
    };

    if (!t.outcomes || t.outcomes.length === 0) {
      rows.push({ ...base, "Outcome Number": "", "Outcome Text": "", Species: "", "Organ System": "", "Added By": "", "Added Date": "", "Last Updated By": "", "Last Updated Date": "" });
      continue;
    }
    for (const o of t.outcomes) {
      rows.push({
        ...base,
        "Outcome Number": o.outcomeNumber,
        "Outcome Text": o.text,
        Species: o.species || "",
        "Organ System": o.organSystem || "",
        "Added By": o.createdByName,
        "Added Date": toISO(o.createdAt),
        "Last Updated By": o.updatedByName,
        "Last Updated Date": toISO(o.updatedAt),
      });
    }
  }
  return rows;
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(rows) {
  const header = EXPORT_COLUMNS.join(",");
  const body = rows.map((r) => EXPORT_COLUMNS.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCSV(rows, filename = "learning-outcomes.csv") {
  downloadBlob(toCSV(rows), filename, "text/csv;charset=utf-8;");
}

/** Generic CSV export for simple row objects (columns inferred from keys) — used for team rosters, etc. */
export function downloadRowsAsCSV(rows, filename = "export.csv") {
  if (!rows || rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const header = cols.join(",");
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(",")).join("\n");
  downloadBlob(`${header}\n${body}`, filename, "text/csv;charset=utf-8;");
}

export function downloadJSON(rows, filename = "learning-outcomes.json") {
  downloadBlob(JSON.stringify(rows, null, 2), filename, "application/json;charset=utf-8;");
}
export function downloadExcelCompatible(rows, filename = "learning-outcomes.xls") {
  const header = `<tr>${EXPORT_COLUMNS.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  const body = rows.map((r) => `<tr>${EXPORT_COLUMNS.map((c) => `<td>${r[c] ?? ""}</td>`).join("")}</tr>`).join("");
  downloadBlob(`<table>${header}${body}</table>`, filename, "application/vnd.ms-excel");
}

// ================================================================
// REVIEW TOPICS ONE AT A TIME (fix placeholder instructors)
// ================================================================
// Placeholder instructors are ones created during import from a raw
// name/text that couldn't be confidently matched (accessType "guest",
// no email). This section lets an admin fix them incrementally,
// topic by topic, over as many sessions as needed — nothing is lost
// between visits because it's read live from Firestore, not from
// browser memory.

/** Topics that still have at least one placeholder instructor assigned. */
export function getTopicsNeedingReview(allTopics, allInstructors) {
  const placeholderById = new Map(allInstructors.filter((i) => !i.email).map((i) => [i.instructorId, i]));
  return allTopics
    .filter((t) => (t.assignedInstructorIDs || []).some((id) => placeholderById.has(id)))
    .map((t) => ({
      ...t,
      placeholderSlots: (t.assignedInstructorIDs || [])
        .filter((id) => placeholderById.has(id))
        .map((id) => ({
          instructorId: id,
          rawName: placeholderById.get(id).name,
          roles: (t.instructorRoles || {})[id] || [],
        })),
    }));
}

function replaceInArray(arr, oldValue, newValues) {
  const list = [...(arr || [])];
  const idx = list.indexOf(oldValue);
  if (idx === -1) return list;
  list.splice(idx, 1, ...newValues);
  return list;
}

/**
 * Resolves ONE placeholder slot within ONE topic — does not touch any
 * other topic that might reference the same placeholder instructor.
 * newInstructors: array of { instructorId, name } chosen by the admin
 * (can be more than one, e.g. a co-taught session). An empty array
 * leaves that topic's slot as-is (no-op — use this if they intentionally
 * skip a topic for now).
 */
export async function resolveTopicSlot(topicId, oldInstructorId, oldRawName, newInstructors) {
  if (!newInstructors || newInstructors.length === 0) return { updated: false };

  const ref = doc(db, "topics", topicId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Session not found");
    const data = snap.data();

    const ids = new Set(data.assignedInstructorIDs || []);
    ids.delete(oldInstructorId);
    for (const ni of newInstructors) ids.add(ni.instructorId);

    const roles = { ...(data.instructorRoles || {}) };
    const oldRoles = roles[oldInstructorId] || [];
    for (const ni of newInstructors) {
      roles[ni.instructorId] = Array.from(new Set([...(roles[ni.instructorId] || []), ...oldRoles]));
    }
    delete roles[oldInstructorId];

    const newNames = newInstructors.map((ni) => ni.name);

    tx.update(ref, {
      assignedInstructorIDs: Array.from(ids),
      instructorRoles: roles,
      primaryInstructorNames: replaceInArray(data.primaryInstructorNames, oldRawName, newNames),
      secondaryInstructorNames: replaceInArray(data.secondaryInstructorNames, oldRawName, newNames),
      finalizedInstructorNames: replaceInArray(data.finalizedInstructorNames, oldRawName, newNames),
    });
  });

  // If no other topic references this placeholder anymore, clean it up.
  const stillUsed = await countTopicsForInstructor(oldInstructorId);
  if (stillUsed === 0) {
    try { await deleteDoc(doc(db, "instructors", oldInstructorId)); } catch (e) { /* noop */ }
  }

  return { updated: true };
}

export async function countTopicsForInstructor(instructorId) {
  const q = query(collection(db, "topics"), where("assignedInstructorIDs", "array-contains", instructorId));
  const snap = await getDocs(q);
  return snap.size;
}

/**
 * Bulk shortcut: merges a placeholder into a real instructor across
 * EVERY topic that references it at once (instead of one at a time).
 * Useful when you're sure the same placeholder always means the same
 * person everywhere it appears.
 */
export async function mergeInstructorEverywhere(oldInstructorId, newInstructorId) {
  if (oldInstructorId === newInstructorId) return { topicsUpdated: 0 };

  const oldSnap = await getDoc(doc(db, "instructors", oldInstructorId));
  const newSnap = await getDoc(doc(db, "instructors", newInstructorId));
  if (!oldSnap.exists() || !newSnap.exists()) throw new Error("Instructor not found.");
  const oldName = oldSnap.data().name;
  const newName = newSnap.data().name;

  const q = query(collection(db, "topics"), where("assignedInstructorIDs", "array-contains", oldInstructorId));
  const snap = await getDocs(q);

  const swapName = (arr) => (arr || []).map((n) => (n === oldName ? newName : n));

  const BATCH_SIZE = 400;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const d of docs.slice(i, i + BATCH_SIZE)) {
      const data = d.data();
      const ids = new Set(data.assignedInstructorIDs || []);
      ids.delete(oldInstructorId);
      ids.add(newInstructorId);

      const roles = { ...(data.instructorRoles || {}) };
      const oldRoles = roles[oldInstructorId] || [];
      roles[newInstructorId] = Array.from(new Set([...(roles[newInstructorId] || []), ...oldRoles]));
      delete roles[oldInstructorId];

      batch.update(d.ref, {
        assignedInstructorIDs: Array.from(ids),
        instructorRoles: roles,
        primaryInstructorNames: swapName(data.primaryInstructorNames),
        secondaryInstructorNames: swapName(data.secondaryInstructorNames),
        finalizedInstructorNames: swapName(data.finalizedInstructorNames),
      });
    }
    await batch.commit();
  }

  await deleteDoc(doc(db, "instructors", oldInstructorId));

  return { topicsUpdated: docs.length };
}

// ================================================================
// SUPPORT TEAMS (Team A/B/C/D — role-based, not tied to a person)
// ================================================================

/** Sets (or clears, with teamId = "") which team an instructor is assigned to. */
export async function assignInstructorToTeam(instructorId, teamId) {
  await updateDoc(doc(db, "instructors", instructorId), { assignedTo: teamId || "" });
}

/** Groups instructors by their assignedTo team, with topic/outcome stats per team. */
export function getTeamProgress(allInstructors, allTopics, teamIds) {
  return teamIds.map((teamId) => {
    const members = allInstructors.filter((i) => i.assignedTo === teamId);
    const memberIds = new Set(members.map((i) => i.instructorId));
    const topics = allTopics.filter((t) => (t.assignedInstructorIDs || []).some((id) => memberIds.has(id)));
    const complete = topics.filter((t) => t.completionStatus === "complete").length;
    const outcomeCount = topics.reduce((sum, t) => sum + (t.outcomes || []).length, 0);
    const pct = topics.length === 0 ? 0 : Math.round((complete / topics.length) * 100);
    return { teamId, instructors: members, topicCount: topics.length, complete, outcomeCount, pct };
  });
}

/** Flat rows (name, email, topic count, % complete) for exporting one team's roster. */
export function buildTeamRosterRows(members, allTopics) {
  return members.map((instr) => {
    const assigned = allTopics.filter((t) => (t.assignedInstructorIDs || []).includes(instr.instructorId));
    const complete = assigned.filter((t) => t.completionStatus === "complete").length;
    const pct = assigned.length === 0 ? 0 : Math.round((complete / assigned.length) * 100);
    return {
      "Instructor Name": instr.name,
      Email: instr.email || "",
      "Total Topics": assigned.length,
      "Completed Topics": complete,
      "Percent Complete": `${pct}%`,
    };
  });
}

/**
 * Computes a balanced team assignment (does NOT write anything yet):
 * sorts instructors by how many topics they have (busiest first), then
 * greedily hands each one to whichever team currently has the fewest
 * topics — the same approach used to keep the 4 teams' workload even.
 * Returns a Map<instructorId, teamId>.
 */
export function computeBalancedTeamAssignment(allInstructors, allTopics, teamIds) {
  const topicCountByInstructor = new Map();
  for (const instr of allInstructors) {
    const count = allTopics.filter((t) => (t.assignedInstructorIDs || []).includes(instr.instructorId)).length;
    topicCountByInstructor.set(instr.instructorId, count);
  }

  const sorted = [...allInstructors].sort(
    (a, b) => topicCountByInstructor.get(b.instructorId) - topicCountByInstructor.get(a.instructorId)
  );

  const teams = teamIds.map((id) => ({ id, topicCount: 0, instructorIds: [] }));
  for (const instr of sorted) {
    const target = teams.reduce((min, t) => (t.topicCount < min.topicCount ? t : min), teams[0]);
    target.topicCount += topicCountByInstructor.get(instr.instructorId) || 0;
    target.instructorIds.push(instr.instructorId);
  }

  const assignment = new Map();
  for (const t of teams) for (const id of t.instructorIds) assignment.set(id, t.id);
  return { assignment, teamSummary: teams.map((t) => ({ teamId: t.id, instructorCount: t.instructorIds.length, topicCount: t.topicCount })) };
}

/** Writes a computed assignment (from computeBalancedTeamAssignment) to Firestore in batches. */
export async function applyTeamAssignment(assignment) {
  const entries = Array.from(assignment.entries());
  const BATCH_SIZE = 400;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const [instructorId, teamId] of entries.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, "instructors", instructorId), { assignedTo: teamId });
    }
    await batch.commit();
  }
}
