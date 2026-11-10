export function createMeetPeerId(len = 10): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(len);
  crypto.getRandomValues(values);
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += alphabet[values[i]! % alphabet.length];
  }
  return out;
}

export function createMeetRoomCode(): string {
  const id = createMeetPeerId(12);
  return `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8, 12)}`.toLowerCase();
}
