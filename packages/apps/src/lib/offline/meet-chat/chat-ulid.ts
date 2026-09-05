/**
 * Client-side ULID generator for chat message ids (spec: message `UID` is a
 * **client-generated ULID** — the idempotency key for send retries and the
 * tiebreak component of read markers).
 *
 * 26 Crockford-base32 chars: 10 time chars (48-bit epoch ms) + 16 random chars
 * (80-bit). Monotonic within one session: two ids minted in the same
 * millisecond increment the random block so local ordering never ties.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

function encodeTime(timestamp: number): string {
  let remaining = timestamp;
  let out = "";
  for (let i = 0; i < TIME_LENGTH; i++) {
    out = ENCODING[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function randomBlock(): number[] {
  const bytes = new Uint8Array(RANDOM_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte % 32);
}

function incrementBlock(block: number[]): number[] {
  const next = [...block];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]! < 31) {
      next[i] = next[i]! + 1;
      return next;
    }
    next[i] = 0;
  }
  return next;
}

let lastTime = 0;
let lastRandom: number[] = [];

export function createChatMessageUlid(now = Date.now()): string {
  if (now === lastTime) {
    lastRandom = incrementBlock(lastRandom);
  } else {
    lastTime = now;
    lastRandom = randomBlock();
  }
  return encodeTime(now) + lastRandom.map((value) => ENCODING[value]).join("");
}

export function isChatMessageUlid(id: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
}
