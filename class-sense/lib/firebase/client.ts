import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { Firestore, getFirestore } from "firebase/firestore";

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

function readRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing Firebase client env var: ${name}`);
  }

  return value;
}

function readFirebaseWebConfig(): FirebaseWebConfig {
  const apiKey = readRequiredEnv("NEXT_PUBLIC_FIREBASE_API_KEY");
  const authDomain = readRequiredEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  const projectId = readRequiredEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  const storageBucket = readRequiredEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  const messagingSenderId = readRequiredEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
  const appId = readRequiredEnv("NEXT_PUBLIC_FIREBASE_APP_ID");

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  };
}

let cachedApp: FirebaseApp | null = null;
let cachedFirestore: Firestore | null = null;

export function getFirebaseClientApp(): FirebaseApp {
  if (cachedApp) {
    return cachedApp;
  }

  const config = readFirebaseWebConfig();
  cachedApp = getApps().length > 0 ? getApp() : initializeApp(config);
  return cachedApp;
}

export function getFirebaseClientFirestore(): Firestore {
  if (cachedFirestore) {
    return cachedFirestore;
  }

  cachedFirestore = getFirestore(getFirebaseClientApp());
  return cachedFirestore;
}
