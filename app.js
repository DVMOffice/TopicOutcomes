/**
 * app.js
 * ---------------------------------------------------------------
 * Everything related to "who am I" lives here:
 *   - Email login (magic link, no password, no PIN)
 *   - Guest login (academic-year code + name search)
 *   - Current session / sign out
 *   - Instructor searches and lookups
 *
 * If you need to fix anything about login or how an
 * instructor is identified, do it HERE, in this single file.
 * ---------------------------------------------------------------
 */
import { auth, db } from "./firebaseConfig.js";
import {
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ACTION_CODE_SETTINGS = {
  url: window.location.origin + "/index.html",
  handleCodeInApp: true,
};

// ================================================================
// EMAIL LOGIN (magic link)
// ================================================================

/** Step 1: sends the link, only if the email exists in "instructors". */
export async function requestInstructorLoginLink(email) {
  const normalized = email.trim().toLowerCase();

  const q = query(collection(db, "instructors"), where("email", "==", normalized));
  const snap = await getDocs(q);
  if (snap.empty) {
    throw new Error("We could not find that email in the instructor list. Contact your administrator.");
  }

  await sendSignInLinkToEmail(auth, normalized, ACTION_CODE_SETTINGS);
  window.localStorage.setItem("loginEmail", normalized);
}

/** Step 2: call this when loading index.html to complete login if arriving from the link. */
export async function completeInstructorLoginIfNeeded() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return null;

  let email = window.localStorage.getItem("loginEmail");
  if (!email) {
    email = window.prompt("Confirm your email to complete sign-in:");
  }
  const result = await signInWithEmailLink(auth, email, window.location.href);
  window.localStorage.removeItem("loginEmail");
  return result.user;
}

// ================================================================
// GUEST LOGIN (academic-year code)
// ================================================================

export async function validateGuestCode(academicYear, code) {
  const snap = await getDocs(collection(db, "accessCodes"));
  const match = snap.docs.find((d) => d.id === academicYear);
  if (!match) throw new Error("Invalid academic year.");
  if (String(match.data().code).trim() !== String(code).trim()) {
    throw new Error("Incorrect access code.");
  }
  return true;
}

export async function startGuestSession(academicYear) {
  const cred = await signInAnonymously(auth);
  await setDoc(doc(db, "guestSessions", cred.user.uid), {
    academicYear,
    startedAt: serverTimestamp(),
  });
  return cred.user;
}

export function setGuestInstructorId(instructorId) {
  window.sessionStorage.setItem("guestInstructorId", instructorId);
}
export function getGuestInstructorId() {
  return window.sessionStorage.getItem("guestInstructorId");
}

// ================================================================
// SESSION
// ================================================================

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function logOut() {
  window.sessionStorage.removeItem("guestInstructorId");
  await signOut(auth);
}

/** Resolves the full record of the current instructor (email or guest). */
export async function getCurrentInstructor(user) {
  if (!user) return null;
  if (user.isAnonymous) {
    const guestId = getGuestInstructorId();
    return guestId ? getInstructorById(guestId) : null;
  }
  return getInstructorByEmail(user.email);
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
