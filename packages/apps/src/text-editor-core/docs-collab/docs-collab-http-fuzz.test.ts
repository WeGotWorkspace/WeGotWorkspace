import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { diffForStateVector } from "./docs-collab-http-wire";

/**
 * Three documents, random edits, delivery that is reordered, duplicated,
 * delayed, and 10% dropped. A state-vector resync recovers the drops.
 * Fixed seed, 500 iterations, no browser.
 */
describe("docs http sync fuzz", () => {
  it("converges three documents after lossy delivery", () => {
    const random = mulberry32(0x1095);
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
      const queue: Array<{ to: number; update: Uint8Array; at: number }> = [];
      let now = 0;
      for (let step = 0; step < 12; step += 1) {
        const author = Math.floor(random() * 3);
        const text = docs[author]!.getText("t");
        const at = Math.floor(random() * (text.length + 1));
        const glyph = String.fromCharCode(97 + Math.floor(random() * 26));
        let update: Uint8Array<ArrayBufferLike> = new Uint8Array();
        const onUpdate = (next: Uint8Array<ArrayBufferLike>) => {
          update = next;
        };
        docs[author]!.on("update", onUpdate);
        text.insert(at, glyph);
        docs[author]!.off("update", onUpdate);
        for (let dest = 0; dest < 3; dest += 1) {
          if (dest === author) continue;
          if (random() < 0.1) continue;
          const deliverAt = now + Math.floor(random() * 4);
          queue.push({ to: dest, update, at: deliverAt });
          if (random() < 0.25) queue.push({ to: dest, update, at: deliverAt });
        }
        now += 1;
        deliverDue(docs, queue, now, random);
      }
      deliverDue(docs, queue, now + 10, random);
      resync(docs);
      const text = docs[0]!.getText("t").toString();
      expect(docs[1]!.getText("t").toString()).toBe(text);
      expect(docs[2]!.getText("t").toString()).toBe(text);
      const vector = Y.encodeStateVector(docs[0]!);
      expect(vectorsEqual(Y.encodeStateVector(docs[1]!), vector)).toBe(true);
      expect(vectorsEqual(Y.encodeStateVector(docs[2]!), vector)).toBe(true);
    }
  });
});

function deliverDue(
  docs: Y.Doc[],
  queue: Array<{ to: number; update: Uint8Array; at: number }>,
  now: number,
  random: () => number,
): void {
  const due: typeof queue = [];
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (queue[i]!.at > now) continue;
    due.push(queue[i]!);
    queue.splice(i, 1);
  }
  for (let i = due.length - 1; i > 0; i -= 1) {
    const swap = Math.floor(random() * (i + 1));
    const current = due[i]!;
    due[i] = due[swap]!;
    due[swap] = current;
  }
  for (const message of due) Y.applyUpdate(docs[message.to]!, message.update);
}

function resync(docs: Y.Doc[]): void {
  for (let from = 0; from < docs.length; from += 1) {
    for (let to = 0; to < docs.length; to += 1) {
      if (from === to) continue;
      const diff = diffForStateVector(docs[from]!, Y.encodeStateVector(docs[to]!));
      Y.applyUpdate(docs[to]!, diff);
    }
  }
}

function vectorsEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
