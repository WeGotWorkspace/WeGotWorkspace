import * as Y from "yjs";
import type { BlockType, DocOp, DocView, ThreadValue } from "./docs-script";
import type { CompactableShape } from "./epoch";

/**
 * Spike 10: the Docs Y.Doc shape written with raw Yjs calls, the way
 * y-tiptap (y-prosemirror) lays it out: root `default` XmlFragment, one
 * XmlElement per block (`paragraph`, `heading` with a `level` attribute), the
 * inline text in one XmlText whose formatting attributes are the marks
 * (`bold: {}`, `link: {href}`, `comment: {id}`). Comment threads live in the
 * `comments` Y.Map as whole JSON values, rewritten on every reply (as
 * `docs-comments-map-writes.ts` does). A node type change recreates the
 * element, as y-prosemirror does when `nodeName` differs.
 *
 * The real editor run in packages/apps checks this model against y-tiptap.
 */
export const BODY = "default";
export const COMMENTS = "comments";

type Delta = { insert: string; attributes?: Record<string, unknown> }[];

const body = (doc: Y.Doc) => doc.getXmlFragment(BODY);
const comments = (doc: Y.Doc) => doc.getMap<ThreadValue>(COMMENTS);
const block = (doc: Y.Doc, i: number) => body(doc).get(i) as Y.XmlElement;

/**
 * A block's text nodes. Usually one; two writers typing into the same empty
 * block each create one, and y-prosemirror shows them one after the other, so
 * the model reads them as one text too.
 */
const textsOf = (el: Y.XmlElement): Y.XmlText[] => el.toArray().filter((x): x is Y.XmlText => x instanceof Y.XmlText);

function textOf(el: Y.XmlElement): Y.XmlText {
  const texts = textsOf(el);
  if (texts.length > 0) return texts[texts.length - 1] as Y.XmlText;
  const text = new Y.XmlText();
  el.insert(0, [text]);
  return text;
}

/** The text node and local offset for a block offset (the end of a node counts as that node). */
function locate(el: Y.XmlElement, offset: number): { text: Y.XmlText; at: number } {
  const texts = textsOf(el);
  if (texts.length === 0) return { text: textOf(el), at: 0 };
  let rest = offset;
  for (const text of texts) {
    if (rest <= text.length) return { text, at: rest };
    rest -= text.length;
  }
  const last = texts[texts.length - 1] as Y.XmlText;
  return { text: last, at: last.length };
}

/** Run `fn` over the block range [from, to) split by text node. */
function eachRange(el: Y.XmlElement, from: number, to: number, fn: (text: Y.XmlText, at: number, len: number) => void): void {
  const parts: [Y.XmlText, number, number][] = [];
  let pos = 0;
  for (const text of textsOf(el)) {
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + text.length);
    if (b > a) parts.push([text, a - pos, b - a]);
    pos += text.length;
  }
  for (const [text, at, len] of parts.reverse()) fn(text, at, len);
}

const plainLength = (el: Y.XmlElement): number => textsOf(el).reduce((n, t) => n + t.length, 0);

function newBlock(type: BlockType, level?: number): Y.XmlElement {
  const el = new Y.XmlElement(type);
  if (type === "heading") el.setAttribute("level", (level ?? 2) as unknown as string);
  return el;
}

function deltaOf(el: Y.XmlElement): Delta {
  return textsOf(el).flatMap((t) => t.toDelta() as Delta);
}

function sliceDelta(delta: Delta, from: number, to = Number.POSITIVE_INFINITY): Delta {
  const out: Delta = [];
  let pos = 0;
  for (const op of delta) {
    const end = pos + op.insert.length;
    const a = Math.max(from, pos);
    const b = Math.min(to, end);
    if (b > a) out.push({ insert: op.insert.slice(a - pos, b - pos), ...(op.attributes ? { attributes: op.attributes } : {}) });
    pos = end;
  }
  return out;
}

function insertDelta(text: Y.XmlText, at: number, delta: Delta): void {
  let pos = at;
  for (const op of delta) {
    text.insert(pos, op.insert, (op.attributes ?? {}) as Record<string, unknown>);
    pos += op.insert.length;
  }
}

export function applyDocOp(doc: Y.Doc, op: DocOp): void {
  doc.transact(() => {
    switch (op.k) {
      case "insert": {
        const { text, at } = locate(block(doc, op.block), op.offset);
        if (op.marks) text.insert(at, op.text, op.marks as Record<string, unknown>);
        else text.insert(at, op.text);
        return;
      }
      case "delete":
        eachRange(block(doc, op.block), op.offset, op.offset + op.len, (text, at, len) => text.delete(at, len));
        return;
      case "format":
        eachRange(block(doc, op.block), op.from, op.to, (text, at, len) => text.format(at, len, { [op.mark]: op.value }));
        return;
      case "setType": {
        const old = block(doc, op.block);
        const el = newBlock(op.type, op.level);
        const delta = deltaOf(old);
        body(doc).delete(op.block, 1);
        body(doc).insert(op.block, [el]);
        if (delta.length > 0) insertDelta(textOf(el), 0, delta);
        return;
      }
      case "split": {
        const el = block(doc, op.block);
        const len = plainLength(el);
        const tail = sliceDelta(deltaOf(el), op.offset);
        if (len > op.offset) eachRange(el, op.offset, len, (text, at, n) => text.delete(at, n));
        const next = newBlock("paragraph");
        body(doc).insert(op.block + 1, [next]);
        if (tail.length > 0) insertDelta(textOf(next), 0, tail);
        return;
      }
      case "join": {
        const prev = block(doc, op.block - 1);
        const delta = deltaOf(block(doc, op.block));
        if (delta.length > 0) insertDelta(textOf(prev), plainLength(prev), delta);
        body(doc).delete(op.block, 1);
        return;
      }
      case "newBlock": {
        const el = newBlock(op.type, op.type === "heading" ? 2 : undefined);
        body(doc).insert(op.at, [el]);
        if (op.text !== "") textOf(el).insert(0, op.text);
        return;
      }
      case "deleteBlocks":
        body(doc).delete(op.block, op.count);
        return;
      case "thread":
        if (op.value) comments(doc).set(op.id, op.value);
        else comments(doc).delete(op.id);
        return;
    }
  }, "local");
}

/** A block's plain text, all text nodes together. */
export function blockText(doc: Y.Doc, i: number): string {
  return deltaOf(block(doc, i))
    .map((op) => op.insert)
    .join("");
}

export function docView(doc: Y.Doc): DocView {
  const blocks: DocView["blocks"] = [];
  body(doc).forEach((el) => {
    const element = el as Y.XmlElement;
    blocks.push({ type: element.nodeName as BlockType, len: plainLength(element) });
  });
  return { blocks, threads: new Map(comments(doc).entries()) };
}

export type DocsContent = {
  blocks: { type: BlockType; level?: number; delta: Delta }[];
  comments: Record<string, ThreadValue>;
};

export function snapshotDocs(doc: Y.Doc): DocsContent {
  const blocks: DocsContent["blocks"] = [];
  body(doc).forEach((el) => {
    const element = el as Y.XmlElement;
    const level = element.getAttribute("level") as unknown as number | undefined;
    blocks.push({ type: element.nodeName as BlockType, ...(level !== undefined ? { level } : {}), delta: deltaOf(element) });
  });
  const out: Record<string, ThreadValue> = {};
  for (const key of [...comments(doc).keys()].sort()) out[key] = comments(doc).get(key) as ThreadValue;
  return { blocks, comments: out };
}

function buildDocs(target: Y.Doc, content: DocsContent): void {
  target.transact(() => {
    const els = content.blocks.map((b) => newBlock(b.type, b.level));
    body(target).insert(0, els);
    content.blocks.forEach((b, i) => {
      if (b.delta.length > 0) insertDelta(textOf(els[i] as Y.XmlElement), 0, b.delta);
    });
    for (const [key, value] of Object.entries(content.comments)) comments(target).set(key, value);
  }, "compaction");
}

const plain = (delta: Delta) => delta.map((op) => op.insert).join("");
const keyOf = (b: DocsContent["blocks"][number]) => `${b.type}|${b.level ?? ""}|${plain(b.delta)}`;

/** 0..1: how much of the base text `a` survives in `b` as a shared prefix + suffix. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0) return 0.5;
  const max = a.length;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  return (p + s) / max;
}

type AlignStep = { kind: "del" } | { kind: "ins" } | { kind: "keep"; base: number };

/**
 * In-order alignment of the unmatched blocks between two anchors, maximising
 * text similarity (pairs below 0.3 count as delete + insert). Steps are in
 * document order; `keep.base` is the index into `bs`.
 */
function alignSegment(bs: DocsContent["blocks"], ms: DocsContent["blocks"]): AlignStep[] {
  const n = bs.length;
  const m = ms.length;
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const sim = (i: number, j: number) => similarity(plain((bs[i] as DocsContent["blocks"][number]).delta), plain((ms[j] as DocsContent["blocks"][number]).delta));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const pairScore = sim(i, j);
      const pair = pairScore >= 0.3 ? pairScore + (score[i + 1] as number[])[j + 1]! : -1;
      (score[i] as number[])[j] = Math.max(pair, (score[i + 1] as number[])[j]!, (score[i] as number[])[j + 1]!);
    }
  }
  const steps: AlignStep[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m) {
      const pairScore = sim(i, j);
      if (pairScore >= 0.3 && Math.abs((score[i] as number[])[j]! - (pairScore + (score[i + 1] as number[])[j + 1]!)) < 1e-9) {
        steps.push({ kind: "keep", base: i });
        i += 1;
        j += 1;
        continue;
      }
      if ((score[i + 1] as number[])[j]! >= (score[i] as number[])[j + 1]!) {
        steps.push({ kind: "del" });
        i += 1;
      } else {
        steps.push({ kind: "ins" });
        j += 1;
      }
    } else if (i < n) {
      steps.push({ kind: "del" });
      i += 1;
    } else {
      steps.push({ kind: "ins" });
      j += 1;
    }
  }
  return steps;
}

/** LCS pairs between two key lists. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      (dp[i] as Uint16Array)[j] =
        a[i] === b[j] ? ((dp[i + 1] as Uint16Array)[j + 1] as number) + 1 : Math.max((dp[i + 1] as Uint16Array)[j] as number, (dp[i] as Uint16Array)[j + 1] as number);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (((dp[i + 1] as Uint16Array)[j] as number) >= ((dp[i] as Uint16Array)[j + 1] as number)) i += 1;
    else j += 1;
  }
  return pairs;
}

function markNames(...deltas: Delta[]): string[] {
  const names = new Set<string>();
  for (const d of deltas) for (const op of d) for (const k of Object.keys(op.attributes ?? {})) names.add(k);
  return [...names];
}

/** Make `el`'s text equal `mine` (text by common prefix/suffix, then formatting). */
function updateBlockText(el: Y.XmlElement, base: Delta, mine: Delta): void {
  const a = plain(base);
  const b = plain(mine);
  const text = textOf(el);
  if (a !== b) {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
    if (a.length - p - s > 0) text.delete(p, a.length - p - s);
    insertDelta(text, p, sliceDelta(mine, p, b.length - s));
  }
  if (canon(text.toDelta()) === canon(mine)) return;
  const names = markNames(base, mine, text.toDelta() as Delta);
  let pos = 0;
  for (const op of mine) {
    const attrs: Record<string, unknown> = {};
    for (const name of names) attrs[name] = op.attributes?.[name] ?? null;
    text.format(pos, op.insert.length, attrs);
    pos += op.insert.length;
  }
}

/**
 * `mine - base` onto `target`, where `target`'s body starts as `base` (the
 * rebuilt epoch base). Blocks are aligned by LCS on type + text; blocks
 * between two anchors are paired in order and edited in place when their type
 * matches, else replaced. That is how y-prosemirror's `updateYFragment` treats
 * a new editor state, so the real editor would replay the same way.
 */
export function replayDocsByContent(target: Y.Doc, base: DocsContent, mine: DocsContent): void {
  target.transact(() => {
    const pairs = lcsPairs(base.blocks.map(keyOf), mine.blocks.map(keyOf));
    pairs.push([base.blocks.length, mine.blocks.length]);
    const frag = body(target);
    let bi = 0;
    let mi = 0;
    let offset = 0; // target index = base index + offset
    for (const [pb, pm] of pairs) {
      let at = bi + offset;
      let m = mi;
      for (const step of alignSegment(base.blocks.slice(bi, pb), mine.blocks.slice(mi, pm))) {
        if (step.kind === "del") {
          frag.delete(at, 1);
          offset -= 1;
          continue;
        }
        const mb = mine.blocks[m] as DocsContent["blocks"][number];
        m += 1;
        if (step.kind === "ins") {
          const el = newBlock(mb.type, mb.level);
          frag.insert(at, [el]);
          if (mb.delta.length > 0) insertDelta(textOf(el), 0, mb.delta);
          offset += 1;
          at += 1;
          continue;
        }
        const bb = base.blocks[step.base + bi] as DocsContent["blocks"][number];
        if (bb.type === mb.type && (bb.level ?? null) === (mb.level ?? null)) {
          updateBlockText(frag.get(at) as Y.XmlElement, bb.delta, mb.delta);
        } else {
          // A node type change recreates the element, as y-prosemirror does.
          frag.delete(at, 1);
          const el = newBlock(mb.type, mb.level);
          frag.insert(at, [el]);
          if (mb.delta.length > 0) insertDelta(textOf(el), 0, mb.delta);
        }
        at += 1;
      }
      // The anchor itself: same type and text, maybe different marks.
      const anchorBase = base.blocks[pb];
      const anchorMine = mine.blocks[pm];
      if (anchorBase && anchorMine && canon(anchorBase.delta) !== canon(anchorMine.delta)) {
        updateBlockText(frag.get(at) as Y.XmlElement, anchorBase.delta, anchorMine.delta);
      }
      bi = pb + 1;
      mi = pm + 1;
    }
    const map = comments(target);
    for (const key of Object.keys(base.comments)) if (!(key in mine.comments)) map.delete(key);
    for (const [key, value] of Object.entries(mine.comments)) {
      if (canon(base.comments[key]) !== canon(value)) map.set(key, value);
    }
  }, "local");
}

// --- Replay by identity ------------------------------------------------------
//
// `mine` is the archived final state (`base`) plus this peer's unseen edits,
// merged by Yjs, so both hold the same items for everything `base` had. Every
// live block and character of `mine` is either one of `base`'s (same item id)
// or new, and every block or character `base` had live that `mine` has deleted
// was deleted by this peer. That is an exact diff, positioned in `base`'s
// order, which is also the order of the rebuilt epoch base the diff lands on.

type Struct = { id: Y.ID; length: number; deleted: boolean; right: Struct | null; content: unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const startOf = (type: Y.AbstractType<any>): Struct | null => (type as unknown as { _start: Struct | null })._start;
const idKey = (client: number, clock: number) => `${client}:${clock}`;

function liveChildItems(parent: Y.AbstractType<any>): Struct[] {
  const out: Struct[] = [];
  for (let item = startOf(parent); item; item = item.right) if (!item.deleted && item.content instanceof Y.ContentType) out.push(item);
  return out;
}

const typeOf = (item: Struct) => (item.content as Y.ContentType).type as Y.XmlElement;

function liveCharOffsets(texts: Y.XmlText[]): Map<string, number> {
  const map = new Map<string, number>();
  let off = 0;
  for (const text of texts) {
    for (let item = startOf(text); item; item = item.right) {
      if (item.deleted || !(item.content instanceof Y.ContentString)) continue;
      for (let k = 0; k < item.length; k += 1) map.set(idKey(item.id.client, item.id.clock + k), off + k);
      off += item.length;
    }
  }
  return map;
}

/** Inserts keyed by the base offset they follow (-1 = start), and deleted base offsets. */
function textDiff(base: Y.XmlText[], mineTexts: Y.XmlText[]): { inserts: Map<number, string>; deletes: Set<number> } {
  const offsets = liveCharOffsets(base);
  const inserts = new Map<number, string>();
  const deletes = new Set<number>();
  let anchor = -1;
  let pending = "";
  const flush = () => {
    if (pending) inserts.set(anchor, (inserts.get(anchor) ?? "") + pending);
    pending = "";
  };
  // A base char that is gone from every text node of `mine` was deleted here.
  const seen = new Set<string>();
  for (const mine of mineTexts) for (let item = startOf(mine); item; item = item.right) {
    if (item.content instanceof Y.ContentFormat) continue;
    const str = item.content instanceof Y.ContentString ? (item.content as unknown as { str: string }).str : null;
    for (let k = 0; k < item.length; k += 1) {
      const key = idKey(item.id.client, item.id.clock + k);
      const off = offsets.get(key);
      if (off !== undefined) seen.add(key);
      if (off !== undefined) {
        flush();
        anchor = off;
        if (item.deleted) deletes.add(off);
      } else if (!item.deleted && str !== null) pending += str[k];
    }
  }
  flush();
  for (const [key, off] of offsets) if (!seen.has(key)) deletes.add(off);
  return { inserts, deletes };
}

function applyTextDiff(el: Y.XmlElement, diff: { inserts: Map<number, string>; deletes: Set<number> }): void {
  if (diff.inserts.size === 0 && diff.deletes.size === 0) return;
  const text = textOf(el);
  const points = [...new Set([...diff.inserts.keys(), ...diff.deletes])].sort((a, b) => b - a);
  for (const p of points) {
    const ins = diff.inserts.get(p);
    if (ins) text.insert(p + 1, ins, {});
    if (diff.deletes.has(p)) text.delete(p, 1);
  }
}

/** Formatting: make `el`'s runs carry `mine`'s marks (the text is already equal). */
function syncFormatting(el: Y.XmlElement, mine: Delta): void {
  const current = deltaOf(el);
  if (canon(current) === canon(mine)) return;
  const names = markNames(current, mine);
  let pos = 0;
  for (const op of mine) {
    const attrs: Record<string, unknown> = {};
    for (const name of names) attrs[name] = op.attributes?.[name] ?? null;
    eachRange(el, pos, pos + op.insert.length, (text, at, len) => text.format(at, len, attrs));
    pos += op.insert.length;
  }
}

function copyBlock(source: Y.XmlElement): Y.XmlElement {
  const el = new Y.XmlElement(source.nodeName);
  for (const [k, v] of Object.entries(source.getAttributes())) el.setAttribute(k, v as string);
  return el;
}

function replayDocs(target: Y.Doc, baseDoc: Y.Doc, mineDoc: Y.Doc): void {
  target.transact(() => {
    const baseKids = liveChildItems(body(baseDoc));
    const baseIndex = new Map(baseKids.map((item, i) => [idKey(item.id.client, item.id.clock), i]));
    const kept = new Map<number, Y.XmlElement>();
    const added = new Map<number, Y.XmlElement[]>();
    let anchor = -1;
    for (const item of liveChildItems(body(mineDoc))) {
      const i = baseIndex.get(idKey(item.id.client, item.id.clock));
      if (i !== undefined) {
        kept.set(i, typeOf(item));
        anchor = i;
      } else added.set(anchor, [...(added.get(anchor) ?? []), typeOf(item)]);
    }
    const frag = body(target);
    for (let p = baseKids.length - 1; p >= -1; p -= 1) {
      const news = added.get(p);
      if (news) {
        const els = news.map(copyBlock);
        frag.insert(p + 1, els);
        news.forEach((source, k) => {
          const delta = deltaOf(source);
          if (delta.length > 0) insertDelta(textOf(els[k] as Y.XmlElement), 0, delta);
        });
      }
      if (p < 0) continue;
      const mineEl = kept.get(p);
      if (!mineEl) {
        frag.delete(p, 1);
        continue;
      }
      const el = frag.get(p) as Y.XmlElement;
      const baseEl = typeOf(baseKids[p] as Struct);
      for (const [k, v] of Object.entries(mineEl.getAttributes())) {
        if (canon(baseEl.getAttribute(k)) !== canon(v)) el.setAttribute(k, v as string);
      }
      applyTextDiff(el, textDiff(textsOf(baseEl), textsOf(mineEl)));
      syncFormatting(el, deltaOf(mineEl));
    }
    const base = snapshotDocs(baseDoc).comments;
    const mine = snapshotDocs(mineDoc).comments;
    const map = comments(target);
    for (const key of Object.keys(base)) if (!(key in mine)) map.delete(key);
    for (const [key, value] of Object.entries(mine)) if (canon(base[key]) !== canon(value)) map.set(key, value);
  }, "local");
}

/** A Markdown-like rendering, close in size to what the real serializer writes. */
export function docsText(doc: Y.Doc): string {
  const out: string[] = [];
  body(doc).forEach((el) => {
    const element = el as Y.XmlElement;
    let line = "";
    for (const op of deltaOf(element)) {
      let s = op.insert;
      const a = op.attributes ?? {};
      if (a.code) s = `\`${s}\``;
      if (a.bold) s = `**${s}**`;
      if (a.italic) s = `*${s}*`;
      if (a.link) s = `[${s}](${(a.link as { href: string }).href})`;
      if (a.comment) s = `<span data-comment-id="${(a.comment as { id: string }).id}">${s}</span>`;
      line += s;
    }
    if (element.nodeName === "heading") line = `${"#".repeat(Number(element.getAttribute("level") ?? 2))} ${line}`;
    out.push(line);
  });
  return `${out.join("\n\n")}\n`;
}

/** JSON with sorted keys: replicas may hold attributes in a different order. */
export function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export const docsShape: CompactableShape<DocsContent> = {
  id: "docs-prosemirror",
  snapshot: snapshotDocs,
  build: buildDocs,
  replay: replayDocs,
  equal: (a, b) => canon(a) === canon(b),
  text: docsText,
};

/**
 * The first attempt, kept for the comparison in the report: replay by content
 * diff (LCS on blocks, similarity pairing, prefix/suffix per block, as
 * y-prosemirror's `updateYFragment` does). It deletes and re-inserts unchanged
 * text between two edits in one block, which duplicates or resurrects text
 * that others edited after the compaction. Do not use.
 */
export const docsShapeContentDiff: CompactableShape<DocsContent> = {
  ...docsShape,
  id: "docs-prosemirror",
  replay: (target, base, mine) => replayDocsByContent(target, snapshotDocs(base), snapshotDocs(mine)),
};

export function seedDocs(doc: Y.Doc, blocks: { type: BlockType; text: string }[]): void {
  buildDocs(doc, { blocks: blocks.map((b) => ({ type: b.type, ...(b.type === "heading" ? { level: 2 } : {}), delta: b.text ? [{ insert: b.text }] : [] })), comments: {} });
}
