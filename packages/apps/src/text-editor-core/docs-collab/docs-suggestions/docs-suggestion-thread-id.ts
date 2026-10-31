/**
 * Suggestion thread root id derived from the document path and change id.
 *
 * The thread create endpoint is idempotent per thread id, so two tabs (or a
 * retry) that create the root for one change get the same thread instead of
 * two. The path is part of the key so a copied document (same change ids)
 * gets its own threads. The result is a valid ULID: the time part comes from
 * the `ch_<ms>_…` change id when it has one.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const MAX_ULID_TIME = 2 ** 48 - 1;

function encodeTime(timestamp: number): string {
  let remaining = timestamp;
  let out = "";
  for (let i = 0; i < TIME_LENGTH; i += 1) {
    out = ENCODING[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

/** FNV-1a 32-bit. */
function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function changeIdTime(changeId: string): number {
  const match = /^ch_(\d{1,15})_/.exec(changeId);
  const ms = match ? Number(match[1]) : 0;
  return Number.isFinite(ms) && ms >= 0 && ms <= MAX_ULID_TIME ? ms : 0;
}

export function suggestionThreadIdForChange(path: string, changeId: string): string {
  const key = `${path}\u0000${changeId}`;
  let random = "";
  for (let i = 0; i < RANDOM_LENGTH; i += 1) {
    random += ENCODING[hash32(`${i}:${key}`) % 32];
  }
  return encodeTime(changeIdTime(changeId)) + random;
}
