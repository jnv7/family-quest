/**
 * Public by design (ADR 0001): security lives in the Firestore rules, not in
 * this object. The values below are placeholders until the product owner
 * provides the real ones from the Firebase console.
 */
export const firebaseConfig = {
  apiKey: 'REPLACE_WITH_WEB_API_KEY',
  authDomain: 'REPLACE_WITH_PROJECT_ID.firebaseapp.com',
  projectId: 'REPLACE_WITH_PROJECT_ID',
  appId: 'REPLACE_WITH_APP_ID',
} as const;

/** Project id used with the local emulators; no real project can be touched by mistake. */
export const EMULATOR_PROJECT_ID = 'demo-family-quest';

export const EMULATOR_PORTS = { firestore: 8080, auth: 9099 } as const;
