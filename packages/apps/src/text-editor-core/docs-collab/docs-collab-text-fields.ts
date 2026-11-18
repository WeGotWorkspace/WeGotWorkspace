import * as Y from "yjs";
import { adoptServerSnapshot } from "@/lib/collab/docs-collab-bootstrap";
import {
  TEXT_FIELDS_BODY,
  TEXT_FIELDS_META,
  TEXT_FIELDS_SEEDS,
  TEXT_FIELDS_TITLE,
  isTextFieldsDoc,
  isTextFieldsEmpty,
  markTextFieldsDoc,
} from "@/lib/collab/docs-collab-text-fields-shape";
import { SEED_ORIGIN, SERVER_ORIGIN } from "@/lib/collab/docs-collab-utils";
import { seedClientId } from "./docs-collab-seed";

export {
  TEXT_FIELDS_BODY,
  TEXT_FIELDS_META,
  TEXT_FIELDS_SEEDS,
  TEXT_FIELDS_TITLE,
  isTextFieldsDoc,
  isTextFieldsEmpty,
  markTextFieldsDoc,
};

export const TEXT_FIELDS_SHAPE = "text-fields";

/**
 * Origin of a quiet replacement and of every `text-fields-meta` write. It is
 * published to peers and tabs like a rebuild, but it is not this person's
 * work: it never marks the document dirty and never starts a save.
 */
export const EXTERNAL_REPLACE_ORIGIN = "external-replace";

export type TextFieldsText = { title: string; description: string };

/** What the document last took from the server. `vector` never covers a peer's unsaved typing. */
export type TextFieldsBase = TextFieldsText & {
  contentTag: string | null;
  vector: Record<string, number>;
};

export function normalizeLineEnds(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function textOf(doc: Y.Doc, key: string): string {
  return doc.share.has(key) ? doc.getText(key).toString() : "";
}

export function readTextFields(doc: Y.Doc): TextFieldsText {
  return { title: textOf(doc, TEXT_FIELDS_TITLE), description: textOf(doc, TEXT_FIELDS_BODY) };
}

export function sameTextFields(a: TextFieldsText, b: TextFieldsText): boolean {
  return (
    normalizeLineEnds(a.title) === normalizeLineEnds(b.title) &&
    normalizeLineEnds(a.description) === normalizeLineEnds(b.description)
  );
}

export function readTextFieldsBase(doc: Y.Doc): TextFieldsBase | null {
  if (!doc.share.has(TEXT_FIELDS_META)) return null;
  const value = doc.getMap(TEXT_FIELDS_META).get("base");
  return isBase(value) ? value : null;
}

export function readTextFieldsSeed(doc: Y.Doc): number | null {
  if (!doc.share.has(TEXT_FIELDS_META)) return null;
  const value = doc.getMap(TEXT_FIELDS_META).get("seed");
  return typeof value === "number" ? value : null;
}

function isBase(value: unknown): value is TextFieldsBase {
  if (typeof value !== "object" || value === null) return false;
  const base = value as Record<string, unknown>;
  return (
    typeof base.title === "string" &&
    typeof base.description === "string" &&
    (base.contentTag === null || typeof base.contentTag === "string") &&
    typeof base.vector === "object" &&
    base.vector !== null
  );
}

function seedClientIds(doc: Y.Doc): number[] {
  if (!doc.share.has(TEXT_FIELDS_SEEDS)) return [];
  return [...doc.getMap(TEXT_FIELDS_SEEDS).keys()].map(Number).filter(Number.isFinite);
}

type SeedUpdate = { update: Uint8Array; seedId: number; vector: Map<number, number> };

/**
 * The seed every client builds from the same text: a throwaway document whose
 * client id comes from the text (and, for a replacement, the `salt`), so two
 * clients produce byte-identical items. The first seed also records `seed`
 * and `base` inside the throwaway: the document it lands on is empty.
 */
function buildSeed(
  text: TextFieldsText,
  { salt, contentTag, first }: { salt?: string; contentTag: string | null; first: boolean },
): SeedUpdate {
  const title = normalizeLineEnds(text.title);
  const description = normalizeLineEnds(text.description);
  const seed = new Y.Doc();
  seed.clientID = seedClientId(TEXT_FIELDS_SHAPE, `${title}\u0000${description}`, salt);
  seed.getText(TEXT_FIELDS_TITLE).insert(0, title);
  seed.getText(TEXT_FIELDS_BODY).insert(0, description);
  seed.getMap(TEXT_FIELDS_SEEDS).set(String(seed.clientID), true);
  if (first) {
    const vector = Object.fromEntries(
      [...Y.decodeStateVector(Y.encodeStateVector(seed))].map(([c, k]) => [String(c), k]),
    );
    const meta = seed.getMap(TEXT_FIELDS_META);
    meta.set("seed", seed.clientID);
    meta.set("base", { contentTag, title, description, vector } satisfies TextFieldsBase);
  }
  const update = Y.encodeStateAsUpdate(seed);
  const vector = Y.decodeStateVector(Y.encodeStateVector(seed));
  const seedId = seed.clientID;
  seed.destroy();
  return { update, seedId, vector };
}

/** The first seed of an empty document. Two clients seeding the same text are byte-identical. */
export function seedTextFields(
  doc: Y.Doc,
  text: TextFieldsText,
  contentTag: string | null,
  origin: string = SEED_ORIGIN,
): void {
  markTextFieldsDoc(doc);
  Y.applyUpdate(doc, buildSeed(text, { contentTag, first: true }).update, origin);
}

/**
 * Per client: the larger clock of the stored state's vector and `base.vector`,
 * and every item of every seed. `dropOwnWork` adds this client's own items
 * ("use the other version"); a peer's typing after `base` is never in it.
 */
export function textFieldsDeleteLimit(
  doc: Y.Doc,
  storedState: Uint8Array | null,
  { dropOwnWork = false }: { dropOwnWork?: boolean } = {},
): Map<number, number> {
  const limit = new Map<number, number>();
  const raise = (client: number, clock: number) =>
    limit.set(client, Math.max(limit.get(client) ?? 0, clock));
  if (storedState) {
    for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVectorFromUpdate(storedState))) {
      raise(client, clock);
    }
  }
  const base = readTextFieldsBase(doc);
  if (base) for (const [client, clock] of Object.entries(base.vector)) raise(Number(client), clock);
  const local = Y.decodeStateVector(Y.encodeStateVector(doc));
  for (const client of seedClientIds(doc)) raise(client, local.get(client) ?? 0);
  if (dropOwnWork) raise(doc.clientID, local.get(doc.clientID) ?? 0);
  return limit;
}

/**
 * Replace the text with what the server holds after an outside write
 * (spec.md, The re-read, steps 3 and 4). The stored state is applied first,
 * the seed is salted with `objectEtag` so text that returns to an earlier
 * value gets new items, and `seed` and `base` are written on the live
 * document after the apply, so they win over every older value.
 */
export function replaceTextFields(
  doc: Y.Doc,
  text: TextFieldsText,
  {
    contentTag,
    objectEtag,
    storedState,
    dropOwnWork = false,
  }: {
    contentTag: string | null;
    objectEtag: string;
    storedState: Uint8Array | null;
    dropOwnWork?: boolean;
  },
): void {
  markTextFieldsDoc(doc);
  doc.transact(() => {
    if (storedState) Y.applyUpdate(doc, storedState, SERVER_ORIGIN);
    const limit = textFieldsDeleteLimit(doc, storedState, { dropOwnWork });
    const seed = buildSeed(text, { salt: objectEtag, contentTag, first: false });
    adoptServerSnapshot(doc, seed.update, EXTERNAL_REPLACE_ORIGIN, limit);
    const vector: Record<string, number> = {};
    for (const [client, clock] of limit) vector[String(client)] = clock;
    vector[String(seed.seedId)] = seed.vector.get(seed.seedId) ?? 0;
    const meta = doc.getMap(TEXT_FIELDS_META);
    meta.set("seed", seed.seedId);
    meta.set("base", {
      contentTag,
      title: normalizeLineEnds(text.title),
      description: normalizeLineEnds(text.description),
      vector,
    } satisfies TextFieldsBase);
  }, EXTERNAL_REPLACE_ORIGIN);
  cleanupTextFieldsSeeds(doc);
}

const EMPTY_UPDATE = Y.encodeStateAsUpdate(new Y.Doc());

/**
 * Delete the items of every seed other than the one `seed` names now. Two
 * rooms that replaced at the same moment both keep their own seed; after
 * sync Yjs picks one `seed` everywhere and this removes the other, once.
 * Idempotent: a seed already deleted is skipped.
 */
export function cleanupTextFieldsSeeds(doc: Y.Doc): void {
  const live = readTextFieldsSeed(doc);
  if (live === null) return;
  const local = Y.decodeStateVector(Y.encodeStateVector(doc));
  const stale = new Map<number, number>();
  for (const client of seedClientIds(doc)) {
    if (client !== live && (local.get(client) ?? 0) > 0) stale.set(client, local.get(client) ?? 0);
  }
  if (stale.size === 0) return;
  adoptServerSnapshot(doc, EMPTY_UPDATE, EXTERNAL_REPLACE_ORIGIN, stale);
}

/** Run the cleanup whenever `seed` or the seed list changes, by any origin. Returns the unsubscribe. */
export function observeTextFieldsSeeds(doc: Y.Doc): () => void {
  const meta = doc.getMap(TEXT_FIELDS_META);
  const seeds = doc.getMap(TEXT_FIELDS_SEEDS);
  const run = () => cleanupTextFieldsSeeds(doc);
  meta.observe(run);
  seeds.observe(run);
  return () => {
    meta.unobserve(run);
    seeds.unobserve(run);
  };
}

/**
 * A token that changes on every `text-fields-meta` write. A landed save
 * writes `base` only when the token is the one it saw when it encoded the
 * document (compare-and-set): a replacement or a peer's newer `base` wins.
 */
export function textFieldsMetaToken(doc: Y.Doc): string {
  if (!doc.share.has(TEXT_FIELDS_META)) return "";
  return JSON.stringify([readTextFieldsSeed(doc), readTextFieldsBase(doc)]);
}

/** Write `base` when `text-fields-meta` still holds `expectedToken`. Returns whether it wrote. */
export function writeTextFieldsBaseIfUnchanged(
  doc: Y.Doc,
  expectedToken: string,
  base: TextFieldsBase,
): boolean {
  if (textFieldsMetaToken(doc) !== expectedToken) return false;
  const current = readTextFieldsBase(doc);
  if (current && JSON.stringify(current) === JSON.stringify(base)) return false;
  doc.transact(() => {
    doc.getMap(TEXT_FIELDS_META).set("base", base);
  }, EXTERNAL_REPLACE_ORIGIN);
  return true;
}

/** `vector` for a base taken from stored bytes. */
export function vectorOfUpdate(update: Uint8Array): Record<string, number> {
  const vector: Record<string, number> = {};
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update))) {
    vector[String(client)] = clock;
  }
  return vector;
}

/** The content tag the server computes for this text: sha1 of description, NUL, title, quoted. */
export async function textFieldsContentTag(text: TextFieldsText): Promise<string> {
  const bytes = new TextEncoder().encode(`${text.description}\u0000${text.title}`);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hex}"`;
}
