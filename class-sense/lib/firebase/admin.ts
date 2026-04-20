import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import { DashboardPayload } from "@/lib/types/dashboard";
import { SessionHciEvent } from "@/lib/types/hci";
import {
  getSessionDashboardDocIdByCode,
  getSessionDashboardDocIds,
  SESSION_DASHBOARDS_COLLECTION,
  SESSION_HCI_EVENTS_SUBCOLLECTION,
} from "@/lib/firebase/realtime";

type ServiceAccountCredential = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function readFirebaseServiceAccount(): ServiceAccountCredential | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

function ensureFirebaseAdminAppInitialized(): void {
  if (getApps().length > 0) {
    return;
  }

  const serviceAccount = readFirebaseServiceAccount();

  if (serviceAccount) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId,
    });
    return;
  }

  initializeApp({
    credential: applicationDefault(),
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
      undefined,
  });
}

let cachedFirestore: Firestore | null = null;

export function getFirebaseAdminFirestore(): Firestore {
  if (cachedFirestore) {
    return cachedFirestore;
  }

  ensureFirebaseAdminAppInitialized();
  cachedFirestore = getFirestore();
  return cachedFirestore;
}

export async function publishSessionDashboardSnapshot(
  payload: DashboardPayload
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const updatedAt = new Date().toISOString();

  const writePayload = {
    ...payload,
    updatedAt,
  };

  const docIds = getSessionDashboardDocIds({
    sessionId: payload.session.id,
    sessionCode: payload.session.code,
  });

  await Promise.all(
    docIds.map((docId) =>
      firestore
        .collection(SESSION_DASHBOARDS_COLLECTION)
        .doc(docId)
        .set(writePayload, { merge: true })
    )
  );
}

export async function upsertSessionDashboardMeta(input: {
  sessionId: string;
  sessionCode: string;
  status?: string;
  title?: string;
  hostId?: string;
}): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const docIds = getSessionDashboardDocIds({
    sessionId: input.sessionId,
    sessionCode: input.sessionCode,
  });

  const updatePayload = {
    updatedAt: new Date().toISOString(),
    ...(input.status
      ? {
          session: {
            id: input.sessionId,
            code: input.sessionCode,
            status: input.status,
            ...(input.title ? { title: input.title } : {}),
          },
        }
      : {}),
    ...(input.hostId ? { hostId: input.hostId } : {}),
  };

  await Promise.all(
    docIds.map((docId) =>
      firestore
        .collection(SESSION_DASHBOARDS_COLLECTION)
        .doc(docId)
        .set(updatePayload, { merge: true })
    )
  );
}

export async function publishSessionHciEvent(event: SessionHciEvent): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const dashboardDocId = getSessionDashboardDocIdByCode(event.sessionCode);

  await firestore
    .collection(SESSION_DASHBOARDS_COLLECTION)
    .doc(dashboardDocId)
    .collection(SESSION_HCI_EVENTS_SUBCOLLECTION)
    .doc(event.id)
    .set(event, { merge: true });
}

export async function listRecentSessionHciEvents(input: {
  sessionCode: string;
  limit?: number;
}): Promise<SessionHciEvent[]> {
  const firestore = getFirebaseAdminFirestore();
  const dashboardDocId = getSessionDashboardDocIdByCode(input.sessionCode);
  const limitCount = Math.max(1, Math.min(input.limit ?? 20, 100));

  const snapshot = await firestore
    .collection(SESSION_DASHBOARDS_COLLECTION)
    .doc(dashboardDocId)
    .collection(SESSION_HCI_EVENTS_SUBCOLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limitCount)
    .get();

  return snapshot.docs
    .map((doc) => doc.data() as SessionHciEvent)
    .filter((event) => Boolean(event?.id && event?.createdAt && event?.type));
}
