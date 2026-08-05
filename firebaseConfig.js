// firebaseConfig.js
// ---------------------------------------------------------------
// Paste the config object from Firebase Console > Project settings
// > General > "Your apps" > SDK setup and configuration > Config.
// This is safe to expose publicly (it is not a secret) — access is
// controlled by Firestore Security Rules and Authentication, not by
// hiding this object.
// ---------------------------------------------------------------
export const firebaseConfig = {
  apiKey: "AIzaSyAPRo0UeMCKb-8oGC98V2lvNZe5_bOS2o4",
  authDomain: "topic-outcomes.firebaseapp.com",
  projectId: "topic-outcomes",
  storageBucket: "topic-outcomes.firebasestorage.app",
  messagingSenderId: "661438470693",
  appId: "1:661438470693:web:28111e50b909ed863a3dcc",
};

// Central place to import the Firebase SDK modules so every file in
// /js references the same versions.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Toggle this to true while developing locally against the Firebase
// Emulator Suite (firebase emulators:start). Leave false in production.
const USE_EMULATORS = false;
if (USE_EMULATORS) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
