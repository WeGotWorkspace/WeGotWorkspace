import { type Rng, chance, int, mulberry32 as mulberryFrom, pick, sentence, weighted, words } from "./rng";

/**
 * Spike 10: what people do to a document, as primitive editor operations on
 * top-level blocks. Pure (no Yjs): the raw-Yjs model here and the real TipTap
 * editor run in packages/apps both execute the same script.
 *
 * Offsets are character offsets inside a block's text. Every op in one action
 * is valid against the view the action was generated from, with the earlier
 * ops of the same action applied.
 */
export type BlockType = "paragraph" | "heading";
export type MarkName = "bold" | "italic" | "code" | "link" | "comment" | "suggestion";
export type MarkValue = Record<string, string> | null;

export type DocOp =
  | { k: "insert"; block: number; offset: number; text: string; marks?: Partial<Record<MarkName, MarkValue>> }
  | { k: "delete"; block: number; offset: number; len: number }
  | { k: "format"; block: number; from: number; to: number; mark: MarkName; value: MarkValue }
  | { k: "setType"; block: number; type: BlockType; level?: number }
  | { k: "split"; block: number; offset: number }
  | { k: "join"; block: number }
  | { k: "newBlock"; at: number; type: BlockType; text: string }
  | { k: "deleteBlocks"; block: number; count: number }
  | { k: "thread"; id: string; value: ThreadValue | null };

export type ThreadValue = {
  id: string;
  createdAt: string;
  author: string;
  resolved: boolean;
  messages: { id: string; author: string; body: string; createdAt: string }[];
};

export type DocView = {
  blocks: { type: BlockType; len: number }[];
  threads: Map<string, ThreadValue>;
};

export type DocAction =
  | "type"
  | "backspace"
  | "delete-range"
  | "rewrite"
  | "format"
  | "set-type"
  | "split"
  | "join"
  | "new-block"
  | "delete-blocks"
  | "paste"
  | "comment"
  | "reply"
  | "resolve"
  | "suggest";

/** A living document: edited all over, roughly the same size month to month. */
export const DOC_MIX: readonly (readonly [number, DocAction])[] = [
  [27, "type"],
  [8, "backspace"],
  [8, "delete-range"],
  [8, "rewrite"],
  [10, "format"],
  [2, "set-type"],
  [3, "split"],
  [3, "join"],
  [6, "new-block"],
  [3, "delete-blocks"],
  [1, "paste"],
  [6, "comment"],
  [6, "reply"],
  [4, "resolve"],
  [3, "suggest"],
];

/** Meeting notes or a log: new text every day, older text rarely touched. */
export const NOTES_MIX: readonly (readonly [number, DocAction])[] = [
  [30, "type"],
  [8, "backspace"],
  [7, "delete-range"],
  [5, "rewrite"],
  [10, "format"],
  [2, "set-type"],
  [4, "split"],
  [3, "join"],
  [10, "new-block"],
  [3, "delete-blocks"],
  [2, "paste"],
  [5, "comment"],
  [5, "reply"],
  [3, "resolve"],
  [3, "suggest"],
];

const USERS = ["anna", "bram", "chris", "dewi", "eva"];

/** Typing a run of text word by word, with the odd typo fixed by backspace. */
function typing(rng: Rng, block: number, offset: number, text: string, out: DocOp[]): number {
  let at = offset;
  for (const word of text.split(/(?<= )/)) {
    if (chance(rng, 0.05)) {
      out.push({ k: "insert", block, offset: at, text: "x" });
      out.push({ k: "delete", block, offset: at, len: 1 });
    }
    out.push({ k: "insert", block, offset: at, text: word });
    at += word.length;
  }
  return at - offset;
}

const ulid = (rng: Rng) => {
  let s = "01J";
  for (let i = 0; i < 23; i += 1) s += "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Math.floor(rng() * 32)];
  return s;
};
const stamp = (day: number) => `2026-${String(1 + (Math.floor(day / 21) % 12)).padStart(2, "0")}-${String(1 + (day % 28)).padStart(2, "0")}T10:00:00Z`;

/**
 * One action against `view`. Mutates `view` to what the ops leave, so the
 * caller can generate the next action without reading the document.
 */
export function nextDocAction(rng: Rng, view: DocView, day: number, author: string, mix = DOC_MIX): DocOp[] {
  const out: DocOp[] = [];
  const blocks = view.blocks;
  if (blocks.length === 0) {
    out.push({ k: "newBlock", at: 0, type: "paragraph", text: sentence(rng) });
    blocks.push({ type: "paragraph", len: (out[0] as { text: string }).text.length });
    return out;
  }
  // Recent text is edited more: 40% of actions land in the last fifth.
  const someBlock = () =>
    chance(rng, 0.4) ? blocks.length - 1 - int(rng, 0, Math.max(0, Math.floor(blocks.length / 5) - 1)) : int(rng, 0, blocks.length - 1);
  const action = weighted(rng, mix);
  switch (action) {
    case "type": {
      const b = someBlock();
      const blk = blocks[b] as DocView["blocks"][number];
      const offset = chance(rng, 0.6) ? blk.len : int(rng, 0, blk.len);
      blk.len += typing(rng, b, offset, ` ${sentence(rng, 4, 16)}`, out);
      break;
    }
    case "backspace": {
      const b = someBlock();
      const blk = blocks[b] as DocView["blocks"][number];
      const n = Math.min(blk.len, int(rng, 1, 12));
      let at = chance(rng, 0.6) ? blk.len : int(rng, n, blk.len);
      for (let i = 0; i < n; i += 1) out.push({ k: "delete", block: b, offset: (at -= 1), len: 1 });
      blk.len -= n;
      break;
    }
    case "delete-range": {
      const b = someBlock();
      const blk = blocks[b] as DocView["blocks"][number];
      if (blk.len < 2) break;
      const from = int(rng, 0, blk.len - 1);
      const len = Math.min(blk.len - from, int(rng, 3, 60));
      out.push({ k: "delete", block: b, offset: from, len });
      blk.len -= len;
      break;
    }
    case "rewrite": {
      const b = someBlock();
      const blk = blocks[b] as DocView["blocks"][number];
      if (blk.len > 0) out.push({ k: "delete", block: b, offset: 0, len: blk.len });
      blk.len = typing(rng, b, 0, blk.type === "heading" ? words(rng, int(rng, 2, 6)) : `${sentence(rng)} ${sentence(rng)}`, out);
      break;
    }
    case "format": {
      const b = someBlock();
      const blk = blocks[b] as DocView["blocks"][number];
      if (blk.len < 2) break;
      const from = int(rng, 0, blk.len - 1);
      const to = Math.min(blk.len, from + int(rng, 3, 40));
      const mark = weighted(rng, [
        [5, "bold"],
        [3, "italic"],
        [1, "code"],
        [2, "link"],
      ] as const);
      const value: MarkValue = chance(rng, 0.3) ? null : mark === "link" ? { href: `https://example.org/${words(rng, 1)}` } : {};
      out.push({ k: "format", block: b, from, to, mark, value });
      break;
    }
    case "set-type": {
      const b = someBlock();
      const blk = blocks[b] as DocView["blocks"][number];
      const type: BlockType = blk.type === "heading" ? "paragraph" : "heading";
      out.push({ k: "setType", block: b, type, ...(type === "heading" ? { level: int(rng, 1, 3) } : {}) });
      blk.type = type;
      break;
    }
    case "split": {
      const b = someBlock();
      const blk = blocks[b] as DocView["blocks"][number];
      const offset = int(rng, 0, blk.len);
      out.push({ k: "split", block: b, offset });
      blocks.splice(b + 1, 0, { type: "paragraph", len: blk.len - offset });
      blk.len = offset;
      break;
    }
    case "join": {
      if (blocks.length < 2) break;
      const b = int(rng, 1, blocks.length - 1);
      const prev = blocks[b - 1] as DocView["blocks"][number];
      out.push({ k: "join", block: b });
      prev.len += (blocks[b] as DocView["blocks"][number]).len;
      blocks.splice(b, 1);
      break;
    }
    case "new-block": {
      const at = chance(rng, 0.5) ? blocks.length : int(rng, 0, blocks.length);
      const type: BlockType = chance(rng, 0.12) ? "heading" : "paragraph";
      out.push({ k: "newBlock", at, type, text: "" });
      blocks.splice(at, 0, { type, len: 0 });
      (blocks[at] as DocView["blocks"][number]).len = typing(rng, at, 0, type === "heading" ? words(rng, int(rng, 2, 6)) : `${sentence(rng)} ${sentence(rng)}`, out);
      break;
    }
    case "delete-blocks": {
      if (blocks.length < 4) break;
      const b = int(rng, 0, blocks.length - 2);
      const count = Math.min(blocks.length - 1 - b, int(rng, 1, 3));
      out.push({ k: "deleteBlocks", block: b, count });
      blocks.splice(b, count);
      break;
    }
    case "paste": {
      let at = int(rng, 0, blocks.length);
      for (let i = int(rng, 2, 8); i > 0; i -= 1) {
        const text = `${sentence(rng)} ${sentence(rng)} ${sentence(rng)}`;
        out.push({ k: "newBlock", at, type: "paragraph", text });
        blocks.splice(at, 0, { type: "paragraph", len: text.length });
        at += 1;
      }
      break;
    }
    case "comment": {
      const b = someBlock();
      const blk = blocks[b] as DocView["blocks"][number];
      if (blk.len < 4) break;
      const id = ulid(rng);
      const from = int(rng, 0, blk.len - 2);
      const to = Math.min(blk.len, from + int(rng, 3, 50));
      const thread: ThreadValue = {
        id,
        createdAt: stamp(day),
        author,
        resolved: false,
        messages: [{ id: ulid(rng), author, body: sentence(rng, 5, 25), createdAt: stamp(day) }],
      };
      out.push({ k: "format", block: b, from, to, mark: "comment", value: { id } });
      out.push({ k: "thread", id, value: thread });
      view.threads.set(id, thread);
      break;
    }
    case "reply":
    case "resolve": {
      const open = [...view.threads.values()].filter((t) => !t.resolved);
      if (open.length === 0) break;
      const t = pick(rng, open);
      const next: ThreadValue =
        action === "reply"
          ? { ...t, messages: [...t.messages, { id: ulid(rng), author, body: sentence(rng, 3, 20), createdAt: stamp(day) }] }
          : { ...t, resolved: true };
      out.push({ k: "thread", id: t.id, value: next });
      view.threads.set(t.id, next);
      break;
    }
    case "suggest": {
      // Track changes: an insertion carries a suggestion mark, then is accepted
      // (mark removed) or rejected (text removed), usually the same week.
      const b = someBlock();
      const blk = blocks[b] as DocView["blocks"][number];
      const offset = int(rng, 0, blk.len);
      const text = ` ${sentence(rng, 3, 10)}`;
      const id = ulid(rng);
      out.push({ k: "insert", block: b, offset, text, marks: { suggestion: { id, author } } });
      if (chance(rng, 0.7)) {
        out.push({ k: "format", block: b, from: offset, to: offset + text.length, mark: "suggestion", value: null });
        blk.len += text.length;
      } else {
        out.push({ k: "delete", block: b, offset, len: text.length });
      }
      break;
    }
  }
  return out;
}

export function initialDocBlocks(rng: Rng, count: number): { type: BlockType; text: string }[] {
  return Array.from({ length: count }, (_, i) =>
    i % 7 === 0
      ? { type: "heading" as const, text: words(rng, int(rng, 2, 6)) }
      : { type: "paragraph" as const, text: Array.from({ length: int(rng, 2, 6) }, () => sentence(rng)).join(" ") },
  );
}

export { USERS };

/**
 * One person's replica over `days` workdays, as a pure loop: the raw-Yjs model
 * and the real editor run in packages/apps call it with their own `apply` and
 * get the same ops, so their sidecar sizes can be compared one to one.
 */
export function runSoloScript(
  options: { seed: number; blocks: number; days: number; actionsPerDay: number; checkpointEvery: number; mix?: readonly (readonly [number, DocAction])[] },
  io: {
    seed(blocks: { type: BlockType; text: string }[]): void;
    newSession(clientID: number): void;
    view(): DocView;
    apply(op: DocOp): void;
    checkpoint(day: number, actions: number): void;
  },
): void {
  const rng = mulberryFrom(options.seed);
  io.seed(initialDocBlocks(rng, options.blocks));
  let actions = 0;
  io.checkpoint(0, 0);
  for (let day = 1; day <= options.days; day += 1) {
    const sessions = int(rng, 1, 3);
    for (let s = 0; s < sessions; s += 1) {
      io.newSession(1 + Math.floor(rng() * 0xfffffffe));
      const view = io.view();
      const author = pick(rng, USERS);
      for (let a = 0; a < Math.round(options.actionsPerDay / sessions); a += 1) {
        for (const op of nextDocAction(rng, view, day, author, options.mix)) io.apply(op);
        actions += 1;
      }
    }
    if (day % options.checkpointEvery === 0) io.checkpoint(day, actions);
  }
}
