/**
 * Spike 10: seeded randomness for the growth simulations. Pure, no Yjs, so the
 * Docs edit script can also be imported by the real-editor run in packages/apps.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
export const chance = (rng: Rng, p: number): boolean => rng() < p;

/** Weighted choice over `[weight, value]` pairs. */
export function weighted<T>(rng: Rng, table: readonly (readonly [number, T])[]): T {
  const total = table.reduce((sum, [w]) => sum + w, 0);
  let r = rng() * total;
  for (const [w, value] of table) {
    r -= w;
    if (r < 0) return value;
  }
  return (table.at(-1) as readonly [number, T])[1];
}

/** A Yjs client id (uint32, non-zero) from the rng: a fresh browser session. */
export const sessionClientId = (rng: Rng): number => 1 + Math.floor(rng() * 0xfffffffe);

const WORDS =
  "de het een en van in is dat op te voor met zijn er niet aan ook als dan maar bij nog door om naar over the of and to budget planning offerte klant project levering factuur review notes meeting status update risk owner deadline invoice supplier quarter forecast target overview proposal draft final approved pending open closed sprint backlog roadmap design team office travel kosten uren omzet marge".split(
    " ",
  );

export function words(rng: Rng, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(pick(rng, WORDS));
  return out.join(" ");
}

export function sentence(rng: Rng, lo = 6, hi = 18): string {
  const s = words(rng, int(rng, lo, hi));
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** cyrb53-style 32-bit hash for deterministic ids. */
export function hash32(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return ((h1 >>> 0) % 0xfffffffe) + 1;
}

/** `count` different users out of `users`, in random order. */
export function distinctUsers(users: number, count: number, rng: Rng): number[] {
  const all = Array.from({ length: users }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j] as number, all[i] as number];
  }
  return all.slice(0, count);
}
