/**
 * Receive-side filter for remote Yjs updates.
 *
 * `CollabJoinAuthorizer` only ever decided who may *read* a document, so until
 * now any peer that could reach the mesh could also rewrite the body. The
 * right the server resolved travels with the peer — on the roster for a direct
 * data channel, in the signed ticket for a reused principal link — and every
 * inbound update is weighed against it here before it touches the live Y.Doc.
 *
 * Two rules, both of which hold for every role:
 *
 * - A reader never changes anything.
 * - A commenter changes only the comments map and the suggestion-threads map.
 *   A suggestion is a body edit, so accepting one is not a comment right.
 * - Nobody writes an entry attributed to someone else, and a commenter does
 *   not touch entries other people wrote. Reactions carry only the sender's
 *   own id. Resolving and deleting stay editor rights.
 */

import * as Y from "yjs";
import { rtcLog } from "@/lib/rtc/log";
import type { DocsCollabAccess } from "./docs-collab-access";
import { DOCS_COMMENTS_MAP_KEY } from "./docs-comments-types";
import { DOCS_SUGGESTION_THREADS_MAP_KEY } from "./docs-suggestions-types";

/** Root type holding the document body. A suggestion lives in here too. */
export const DOCS_COLLAB_BODY_ROOT = "default";

/** The only roots a `comment` peer may change. */
export const DOCS_COLLAB_COMMENT_ROOTS: readonly string[] = [
  DOCS_COMMENTS_MAP_KEY,
  DOCS_SUGGESTION_THREADS_MAP_KEY,
];

export type DocsCollabUpdateDropReason =
  | "reader"
  | "body-edit-by-commenter"
  | "foreign-authorship"
  | "foreign-entry-change"
  | "resolve-by-commenter"
  | "malformed-update";

export type DocsCollabUpdateVerdict =
  { applied: true } | { applied: false; reason: DocsCollabUpdateDropReason };

export type DocsCollabGuardedUpdate = {
  doc: Y.Doc;
  update: Uint8Array;
  /** Right the server resolved for the sender. Never a client claim. */
  access: DocsCollabAccess;
  /** Username the roster or the verified ticket names for the sender. */
  senderUser: string;
  /** Transaction origin, so local listeners still see this as remote. */
  origin: unknown;
  /** Peer id, for the `?rtcDebug=1` line on a drop. */
  from?: string;
};

/**
 * Apply a remote update if the sender's right allows it. A `false` verdict
 * means nothing reached the document.
 */
export function applyGuardedRemoteUpdate(input: DocsCollabGuardedUpdate): DocsCollabUpdateVerdict {
  const verdict = runGuard(input);
  if (!verdict.applied) {
    rtcLog({ channel: "collab" }, "update-dropped", {
      remoteId: input.from,
      username: input.senderUser,
      access: input.access,
      reason: verdict.reason,
    });
  }
  return verdict;
}

function runGuard(input: DocsCollabGuardedUpdate): DocsCollabUpdateVerdict {
  if (input.access === "read") return { applied: false, reason: "reader" };

  if (input.access === "write") return applyAsEditor(input);

  return applyAsCommenter(input);
}

/**
 * Editors take the fast path: no clone of the document, only a snapshot of the
 * two small threads maps. Those are the sole place authorship is recorded, so
 * a forged attribution is caught by comparing them afterwards and restoring
 * the snapshot — cheap whatever the body weighs.
 */
function applyAsEditor(input: DocsCollabGuardedUpdate): DocsCollabUpdateVerdict {
  const before = snapshotThreadRoots(input.doc);
  try {
    Y.applyUpdate(input.doc, input.update, input.origin);
  } catch {
    return { applied: false, reason: "malformed-update" };
  }

  const breach = findAuthorshipBreach(before, snapshotThreadRoots(input.doc), input, "write");
  if (!breach) return { applied: true };

  restoreThreadRoots(input.doc, before, input.origin);
  return { applied: false, reason: breach };
}

/**
 * Commenters are judged on a scratch clone, so an update that reaches past the
 * comment roots never touches the live document at all.
 */
function applyAsCommenter(input: DocsCollabGuardedUpdate): DocsCollabUpdateVerdict {
  const scratch = new Y.Doc();
  let touched: Set<string>;
  let before: ThreadRootSnapshots;
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(input.doc));
    ensureKnownRoots(scratch);
    before = snapshotThreadRoots(scratch);
    touched = applyAndCollectTouchedRoots(scratch, input.update);
  } catch {
    scratch.destroy();
    return { applied: false, reason: "malformed-update" };
  }

  for (const root of touched) {
    if (!DOCS_COLLAB_COMMENT_ROOTS.includes(root)) {
      scratch.destroy();
      return { applied: false, reason: "body-edit-by-commenter" };
    }
  }

  const breach = findAuthorshipBreach(before, snapshotThreadRoots(scratch), input, "comment");
  scratch.destroy();
  if (breach) return { applied: false, reason: breach };

  try {
    Y.applyUpdate(input.doc, input.update, input.origin);
  } catch {
    return { applied: false, reason: "malformed-update" };
  }
  return { applied: true };
}

/** Create the roots the guard reasons about so they can be observed. */
function ensureKnownRoots(doc: Y.Doc): void {
  doc.getXmlFragment(DOCS_COLLAB_BODY_ROOT);
  doc.getMap(DOCS_COMMENTS_MAP_KEY);
  doc.getMap(DOCS_SUGGESTION_THREADS_MAP_KEY);
}

/**
 * Root type names the update changes. Every existing root is observed, and a
 * root the update invents is counted too — otherwise a new root would read as
 * "nothing changed".
 */
function applyAndCollectTouchedRoots(doc: Y.Doc, update: Uint8Array): Set<string> {
  const touched = new Set<string>();
  const before = new Set(doc.share.keys());
  const unobserve: Array<() => void> = [];
  for (const [name, type] of doc.share) {
    const handler = (): void => {
      touched.add(name);
    };
    type.observeDeep(handler);
    unobserve.push(() => type.unobserveDeep(handler));
  }

  try {
    Y.applyUpdate(doc, update);
  } finally {
    for (const off of unobserve) off();
  }

  for (const name of doc.share.keys()) {
    if (!before.has(name)) touched.add(name);
  }
  return touched;
}

type MessageFacts = {
  author: string;
  fingerprint: string;
};

type EntryFacts = {
  owner: string;
  resolved: boolean;
  /** Everything but the messages and reactions, so an anchor rewrite shows up. */
  shellFingerprint: string;
  messages: Map<string, MessageFacts>;
  reactions: Map<string, Set<string>>;
  /** Detached copy of the stored value, to put back a refused editor change. */
  value: unknown;
};

type ThreadRootSnapshots = Map<string, Map<string, EntryFacts>>;

function snapshotThreadRoots(doc: Y.Doc): ThreadRootSnapshots {
  const snapshots: ThreadRootSnapshots = new Map();
  for (const root of DOCS_COLLAB_COMMENT_ROOTS) {
    snapshots.set(root, snapshotEntries(doc.getMap(root)));
  }
  return snapshots;
}

function snapshotEntries(map: Y.Map<unknown>): Map<string, EntryFacts> {
  const entries = new Map<string, EntryFacts>();
  map.forEach((value, key) => {
    entries.set(key, readEntryFacts(value));
  });
  return entries;
}

function readEntryFacts(value: unknown): EntryFacts {
  const entry = toPlainRecord(value);
  const messages = new Map<string, MessageFacts>();
  const rawMessages = Array.isArray(entry.messages) ? entry.messages : [];
  for (const raw of rawMessages) {
    const message = toPlainRecord(raw);
    const id = typeof message.id === "string" ? message.id : "";
    if (id === "") continue;
    messages.set(id, {
      author: readAuthorId(message.author),
      fingerprint: JSON.stringify([
        message.body ?? null,
        message.createdAt ?? null,
        readAuthorId(message.author),
      ]),
    });
  }

  const reactions = new Map<string, Set<string>>();
  const rawReactions = Array.isArray(entry.reactions) ? entry.reactions : [];
  for (const raw of rawReactions) {
    const reaction = toPlainRecord(raw);
    const emoji = typeof reaction.emoji === "string" ? reaction.emoji : "";
    if (emoji === "") continue;
    const userIds = Array.isArray(reaction.userIds) ? reaction.userIds : [];
    reactions.set(emoji, new Set(userIds.filter((id): id is string => typeof id === "string")));
  }

  const shell: Record<string, unknown> = {};
  for (const key of Object.keys(entry).sort()) {
    if (key === "messages" || key === "reactions") continue;
    shell[key] = entry[key];
  }

  return {
    owner: readAuthorId(entry.createdBy),
    resolved: entry.resolved === true,
    shellFingerprint: JSON.stringify(shell),
    messages,
    reactions,
    value: entry,
  };
}

function toPlainRecord(value: unknown): Record<string, unknown> {
  if (value instanceof Y.Map || value instanceof Y.Array) {
    return toPlainRecord(value.toJSON());
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readAuthorId(value: unknown): string {
  const author = toPlainRecord(value);
  return typeof author.id === "string" ? author.id : "";
}

/**
 * Compare the threads maps before and after the update. Returns the reason the
 * update has to be refused, or null when every change is one the sender was
 * entitled to make.
 */
function findAuthorshipBreach(
  before: ThreadRootSnapshots,
  after: ThreadRootSnapshots,
  input: DocsCollabGuardedUpdate,
  access: "comment" | "write",
): DocsCollabUpdateDropReason | null {
  const sender = input.senderUser;
  if (sender === "") return "foreign-authorship";

  for (const root of DOCS_COLLAB_COMMENT_ROOTS) {
    const was = before.get(root) ?? new Map<string, EntryFacts>();
    const now = after.get(root) ?? new Map<string, EntryFacts>();

    for (const [key, entry] of now) {
      const previous = was.get(key);
      const breach = previous
        ? inspectChangedEntry(previous, entry, sender, access)
        : inspectAddedEntry(entry, sender);
      if (breach) return breach;
    }

    if (access === "comment") {
      for (const [key, entry] of was) {
        if (now.has(key)) continue;
        if (entry.owner !== "" && entry.owner !== sender) return "foreign-entry-change";
        if (entry.owner === "") return "foreign-entry-change";
      }
    }
  }

  return null;
}

function inspectAddedEntry(entry: EntryFacts, sender: string): DocsCollabUpdateDropReason | null {
  if (entry.owner !== "" && entry.owner !== sender) return "foreign-authorship";
  for (const message of entry.messages.values()) {
    if (message.author !== sender) return "foreign-authorship";
  }
  for (const userIds of entry.reactions.values()) {
    for (const userId of userIds) {
      if (userId !== sender) return "foreign-authorship";
    }
  }
  return null;
}

function inspectChangedEntry(
  before: EntryFacts,
  after: EntryFacts,
  sender: string,
  access: "comment" | "write",
): DocsCollabUpdateDropReason | null {
  if (after.owner !== before.owner) return "foreign-authorship";

  for (const [id, message] of after.messages) {
    const previous = before.messages.get(id);
    if (!previous) {
      if (message.author !== sender) return "foreign-authorship";
      continue;
    }
    if (message.author !== previous.author) return "foreign-authorship";
    if (message.fingerprint === previous.fingerprint) continue;
    if (access === "comment" && previous.author !== sender) return "foreign-entry-change";
  }

  if (access === "comment") {
    for (const [id, message] of before.messages) {
      if (after.messages.has(id)) continue;
      if (message.author !== sender) return "foreign-entry-change";
    }
    if (after.resolved !== before.resolved) return "resolve-by-commenter";
    if (after.shellFingerprint !== before.shellFingerprint && before.owner !== sender) {
      return "foreign-entry-change";
    }
  }

  for (const emoji of new Set([...before.reactions.keys(), ...after.reactions.keys()])) {
    const was = before.reactions.get(emoji) ?? new Set<string>();
    const now = after.reactions.get(emoji) ?? new Set<string>();
    for (const userId of now) {
      if (!was.has(userId) && userId !== sender) return "foreign-authorship";
    }
    for (const userId of was) {
      if (!now.has(userId) && userId !== sender) return "foreign-entry-change";
    }
  }

  return null;
}

/** Put the threads maps back the way they were before a refused editor update. */
function restoreThreadRoots(doc: Y.Doc, before: ThreadRootSnapshots, origin: unknown): void {
  doc.transact(() => {
    for (const root of DOCS_COLLAB_COMMENT_ROOTS) {
      const map = doc.getMap(root);
      const keep = before.get(root) ?? new Map<string, EntryFacts>();
      for (const key of [...map.keys()]) {
        if (!keep.has(key)) map.delete(key);
      }
      for (const [key, entry] of keep) {
        map.set(key, entry.value);
      }
    }
  }, origin);
}
