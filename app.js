/**
 * app.js
 * ---------------------------------------------------------------
 * Todo lo relacionado con "quién soy" vive aquí:
 *   - Login por correo (enlace mágico, sin contraseña ni PIN)
 *   - Login de invitado (código de año académico + búsqueda de nombre)
 *   - Sesión actual / cerrar sesión
 *   - Búsquedas y lecturas de instructores
 *
 * Si necesitas corregir algo del login o de cómo se identifica a un
 * instructor, es AQUÍ, en este único archivo.
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
// LOGIN POR CORREO (enlace mágico)
// ================================================================

/** Paso 1: envía el enlace, solo si el correo existe en "instructors". */
export async function requestInstructorLoginLink(email) {
  const normalized = email.trim().toLowerCase();

  const q = query(collection(db, "instructors"), where("email", "==", normalized));
  const snap = await getDocs(q);
  if (snap.empty) {
    throw new Error("No encontramos ese correo en la lista de instructores. Contacta al administrador.");
  }

  await sendSignInLinkToEmail(auth, normalized, ACTION_CODE_SETTINGS);
  window.localStorage.setItem("loginEmail", normalized);
}

/** Paso 2: llama esto al cargar index.html para completar el login si vienen del enlace. */
export async function completeInstructorLoginIfNeeded() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return null;

  let email = window.localStorage.getItem("loginEmail");
  if (!email) {
    email = window.prompt("Confirma tu correo para completar el inicio de sesión:");
  }
  const result = await signInWithEmailLink(auth, email, window.location.href);
  window.localStorage.removeItem("loginEmail");
  return result.user;
}

// ================================================================
// LOGIN DE INVITADO (código de año académico)
// ================================================================

export async function validateGuestCode(academicYear, code) {
  const snap = await getDocs(collection(db, "accessCodes"));
  const match = snap.docs.find((d) => d.id === academicYear);
  if (!match) throw new Error("Año académico no válido.");
  if (String(match.data().code).trim() !== String(code).trim()) {
    throw new Error("Código de acceso incorrecto.");
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
// SESIÓN
// ================================================================

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function logOut() {
  window.sessionStorage.removeItem("guestInstructorId");
  await signOut(auth);
}

/** Resuelve el registro completo del instructor actual (correo o invitado). */
export async function getCurrentInstructor(user) {
  if (!user) return null;
  if (user.isAnonymous) {
    const guestId = getGuestInstructorId();
    return guestId ? getInstructorById(guestId) : null;
  }
  return getInstructorByEmail(user.email);
}

// ================================================================
// CONSULTAS DE INSTRUCTORES
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
