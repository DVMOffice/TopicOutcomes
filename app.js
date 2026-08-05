/**
 * app.js
 * ---------------------------------------------------------------
 * Everything related to "who am I" lives here:
 *   - Instructor access by email (no password, instant — only works
 *     if that email already exists in the "instructors" list)
 *   - Instructor access by academic-year code + name search (for
 *     instructors who don't have an email on file)
 *   - Administrator access by a separate admin code
 *   - Current session / sign out
 *   - Instructor searches and lookups
 *
 * If you need to fix anything about login or how an
 * instructor is identified, do it HERE, in this single file.
 * ---------------------------------------------------------------
 */
import { auth, db } from "./firebaseConfig.js";
import {
  signInAnonymously,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Makes sure there is an active (anonymous) Firebase Auth session.
// Every access path — email, year code, or admin code — relies on
// this same underlying session; what differs is which identity gets
// attached to it afterwards (an instructor ID, or an admin flag).
async function ensureSignedIn() {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth.currentUser;
}

// ================================================================
// INSTRUCTOR ACCESS BY EMAIL (no password, instant)
// ================================================================

/** Only works if this exact email already exists in "instructors". */
export async function signInWithInstructorEmail(email) {
  const normalized = email.trim().toLowerCase();
  await ensureSignedIn(); // must be signed in before reading "instructors" (see firestore.rules)
  const instructor = await getInstructorByEmail(normalized);
  if (!instructor) {
    throw new Error("We could not find that email in the instructor list. Contact your administrator.");
  }
  setGuestInstructorId(instructor.instructorId);
  return instructor;
}

// ================================================================
// INSTRUCTOR ACCESS BY YEAR CODE (for instructors with no email)
// ================================================================

export async function validateGuestCode(academicYear, code) {
  await ensureSignedIn(); // must be signed in before reading "accessCodes" (see firestore.rules)
  const snap = await getDocs(collection(db, "accessCodes"));
  const match = snap.docs.find((d) => d.id === academicYear);
  if (!match) throw new Error("Invalid academic year.");
  if (String(match.data().code).trim() !== String(code).trim()) {
    throw new Error("Incorrect access code.");
  }
  return true;
}

export async function startGuestSession(academicYear) {
  const user = await ensureSignedIn();
  await setDoc(doc(db, "guestSessions", user.uid), {
    academicYear,
    startedAt: serverTimestamp(),
  });
  return user;
}

export function setGuestInstructorId(instructorId) {
  window.sessionStorage.setItem("guestInstructorId", instructorId);
}
export function getGuestInstructorId() {
  return window.sessionStorage.getItem("guestInstructorId");
}

// ================================================================
// ADMINISTRATOR ACCESS BY ADMIN CODE
// ================================================================

/**
 * Submits the admin code. Firestore itself checks whether it's
 * correct (see firestore.rules) — the real value is never readable
 * by the client, so this either succeeds or throws a permission
 * error, never leaking the real code.
 */
export async function signInAsAdmin(code) {
  const user = await ensureSignedIn();
  try {
    await setDoc(doc(db, "adminSessions", user.uid), {
      codeProvided: code.trim(),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    throw new Error("Incorrect admin code.");
  }
  window.sessionStorage.setItem("isAdmin", "true");
  return true;
}

export async function isCurrentUserAdmin() {
  if (window.sessionStorage.getItem("isAdmin") !== "true") return false;
  if (!auth.currentUser) return false;
  const snap = await getDoc(doc(db, "adminSessions", auth.currentUser.uid));
  return snap.exists();
}

// ================================================================
// SESSION
// ================================================================

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function logOut() {
  const uid = auth.currentUser?.uid;
  window.sessionStorage.removeItem("guestInstructorId");
  window.sessionStorage.removeItem("isAdmin");
  if (uid) {
    // Best-effort cleanup; ignore failures (e.g. doc never existed).
    try { await deleteDoc(doc(db, "adminSessions", uid)); } catch (e) { /* noop */ }
  }
  await signOut(auth);
}

/** Resolves the full record of the current instructor (email or year-code access). */
export async function getCurrentInstructor(user) {
  if (!user) return null;
  const guestId = getGuestInstructorId();
  return guestId ? getInstructorById(guestId) : null;
}

// ================================================================
// INSTRUCTOR LOOKUPS
// ================================================================

export async function getInstructorByEmail(email) {
  const q = query(collection(db, "instructors"), where("email", "==", email.toLowerCase().trim()));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function getInstructorById(instructorId) {
  const snap = await getDoc(doc(db, "instructors", instructorId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function searchInstructorsByName(nameFragment) {
  const snap = await getDocs(collection(db, "instructors"));
  const frag = nameFragment.toLowerCase();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((i) => i.name.toLowerCase().includes(frag) && i.active !== false);
}

export async function getAllInstructors() {
  const snap = await getDocs(collection(db, "instructors"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
