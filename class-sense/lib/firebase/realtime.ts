export const SESSION_DASHBOARDS_COLLECTION = "session_dashboards";
export const SESSION_HCI_EVENTS_SUBCOLLECTION = "hci_events";

const SESSION_CODE_PATTERN = /^[A-Z0-9]{8}$/i;

export function normalizeSessionDashboardDocId(identifier: string): string {
  const normalized = identifier.trim();

  if (SESSION_CODE_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }

  return normalized;
}

export function getSessionDashboardDocIds(input: {
  sessionId: string;
  sessionCode: string;
}): string[] {
  const ids = [
    normalizeSessionDashboardDocId(input.sessionId),
    normalizeSessionDashboardDocId(input.sessionCode),
  ].filter((value) => value.length > 0);

  return [...new Set(ids)];
}

export function getSessionDashboardDocIdByCode(sessionCode: string): string {
  return normalizeSessionDashboardDocId(sessionCode);
}
