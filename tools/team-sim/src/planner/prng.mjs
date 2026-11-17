import { createHash } from "node:crypto";

/** 32-bit seed from any string (the run date). */
export function seedFrom(text) {
  return createHash("sha256").update(String(text)).digest().readUInt32LE(0);
}

/** Small seeded PRNG (mulberry32) with the helpers the planner needs. */
export function createRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = (list) => {
    if (!list.length) throw new Error("rng.pick on an empty list");
    return list[Math.floor(next() * list.length)];
  };
  const chance = (p) => next() < p;
  const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const weighted = (entries) => {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = next() * total;
    for (const [value, w] of entries) {
      roll -= w;
      if (roll < 0) return value;
    }
    return entries[entries.length - 1][0];
  };
  /** A child stream keyed by a label, so adding draws in one area does not shift another. */
  const fork = (label) => createRng(seedFrom(`${seed}:${label}`));
  return { next, int, pick, chance, shuffle, weighted, fork };
}

/** Stable JSON: object keys sorted, so the hash does not depend on insertion order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
