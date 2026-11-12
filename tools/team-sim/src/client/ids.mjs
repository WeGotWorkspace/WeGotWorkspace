import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 26-char Crockford ULID (chat message ids, Docs thread ids). */
export function ulid(time = Date.now()) {
  let t = time;
  let head = "";
  for (let i = 0; i < 10; i += 1) {
    head = CROCKFORD[t % 32] + head;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let tail = "";
  for (let i = 0; i < 16; i += 1) tail += CROCKFORD[bytes[i] % 32];
  return head + tail;
}

/** Meet room code xxxx-xxxx-xxxx from the app's alphabet. */
export function roomCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export const slugify = (s) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export const uuid = () => crypto.randomUUID();
