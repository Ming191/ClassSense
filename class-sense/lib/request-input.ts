export function trimOrEmpty(input?: string | null): string {
  return input?.trim() ?? "";
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidEmail(input: string): boolean {
  const atIndex = input.indexOf("@");
  return atIndex > 0 && atIndex < input.length - 1;
}

export function buildGuestEmail(): string {
  return `guest-${crypto.randomUUID()}@guest.classsense.local`;
}
