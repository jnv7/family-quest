/**
 * Public by design (ADR 0001): this identifies the Firebase project, it does
 * not protect it. Security lives in the Firestore rules.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyA24dsNVl3h3a08Rm5KP1Ag0zfegYQUOTw',
  authDomain: 'family-quest-ff564.firebaseapp.com',
  projectId: 'family-quest-ff564',
  appId: '1:636207382788:web:3710159f20fbc2a2b1d051',
} as const;

/** Project id used with the local emulators; no real project can be touched by mistake. */
export const EMULATOR_PROJECT_ID = 'demo-family-quest';

export const EMULATOR_PORTS = { firestore: 8080, auth: 9099 } as const;
