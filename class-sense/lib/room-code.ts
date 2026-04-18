const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function createRoomCode(): string {
  let code = "";

  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const randomIndex = Math.floor(Math.random() * CODE_ALPHABET.length);
    code += CODE_ALPHABET[randomIndex];
  }

  return code;
}

export function toLivekitRoomName(roomCode: string): string {
  return `classsense-${roomCode.toLowerCase()}`;
}
