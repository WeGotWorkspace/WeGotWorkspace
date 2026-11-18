import * as Y from "yjs";
import { adoptServerSnapshot } from "@/lib/collab/docs-collab-bootstrap";
import { SERVER_ORIGIN } from "@/lib/collab/docs-collab-utils";
import { isReadableYjsUpdate } from "./docs-collab-external-write";
import { isSameSave } from "./docs-collab-snapshot-check";
import {
  isTextFieldsEmpty,
  normalizeLineEnds,
  readTextFields,
  readTextFieldsBase,
  replaceTextFields,
  sameTextFields,
  seedTextFields,
  textFieldsMetaToken,
  textFieldsSeedClientIds,
  textFieldsSeedClocks,
  vectorOfUpdate,
  writeTextFieldsBaseIfUnchanged,
  type TextFieldsBase,
  type TextFieldsText,
} from "./docs-collab-text-fields";

/** What the server answered: `?format=yjs` (`null` on `204`) and `GET …/text`. */
export type TextFieldsServerRead = {
  storedState: Uint8Array | null;
  externalWrite: boolean;
  /** `X-Wgw-Content-Tag`: the content tag of the text the state was written from. */
  stateContentTag?: string | null;
  text: TextFieldsText;
  contentTag: string | null;
  objectEtag: string;
};

/**
 * - `seeded`: an empty document took the server text (first seed).
 * - `adopted`: case 1, a peer's save applied with `SERVER_ORIGIN`.
 * - `unchanged`: case 2, the document already holds the server text.
 * - `replaced`: case 3, a quiet replacement; nothing to save.
 * - `prompt`: case 4, the person has unsaved work; the caller asks.
 */
export type TextFieldsRereadResult = "seeded" | "adopted" | "unchanged" | "replaced" | "prompt";

function storedStateText(update: Uint8Array): TextFieldsText | null {
  if (!isReadableYjsUpdate(update)) return null;
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, update);
    return readTextFields(scratch);
  } finally {
    scratch.destroy();
  }
}

function servedMatchesBase(
  base: TextFieldsBase,
  text: TextFieldsText,
  contentTag: string | null,
): boolean {
  if (base.contentTag && contentTag && base.contentTag !== contentTag) return false;
  return (
    normalizeLineEnds(base.title) === normalizeLineEnds(text.title) &&
    normalizeLineEnds(base.description) === normalizeLineEnds(text.description)
  );
}

/**
 * Every item this client wrote is in the stored state: a peer's save carried
 * this person's typing (two people in one room), so a later outside write
 * replaces it quietly instead of asking (#2208, live e2e). A reload gives the
 * document a new client id, so the clients the local copy held at load count
 * too; seeds do not (the stored state may hold a different one). Without that
 * load vector the pending flag stands.
 */
function storedHoldsOwnWork(
  doc: Y.Doc,
  stored: Uint8Array,
  loadedStateVector: ReadonlyMap<number, number> | undefined,
): boolean {
  if (!loadedStateVector) return false;
  try {
    const vector = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(stored));
    const seeds = new Set(textFieldsSeedClientIds(doc));
    const clients = new Set([doc.clientID, ...loadedStateVector.keys()]);
    for (const client of clients) {
      if (seeds.has(client)) continue;
      if ((vector.get(client) ?? 0) < Y.getState(doc.store, client)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The text-fields re-read (spec.md, The re-read): the first matching case
 * runs, the others do not. Pending local work is the caller's: this client's
 * own edits since its last landed save.
 */
export function rereadTextFields(
  doc: Y.Doc,
  read: TextFieldsServerRead,
  {
    pendingLocalWork: pendingFlag,
    loadedStateVector,
  }: { pendingLocalWork: boolean; loadedStateVector?: ReadonlyMap<number, number> },
): TextFieldsRereadResult {
  const { storedState, text, contentTag, objectEtag } = read;
  const stored = storedState && storedState.byteLength > 0 ? storedState : null;
  // Typing a peer already saved is not this person's unsaved work any more.
  const pendingLocalWork =
    pendingFlag && !(stored && storedHoldsOwnWork(doc, stored, loadedStateVector));
  // A state that does not hold the served text, or cannot be read, is an
  // outside write too (#2208, security review). The text is compared only
  // when both reads are one save; a save between them adopts.
  const storedText = stored ? storedStateText(stored) : null;
  const otherText =
    storedText !== null &&
    isSameSave(read.stateContentTag, contentTag) &&
    !sameTextFields(storedText, text);
  // With no stored state (204), the served text is an outside write only when
  // it differs from what this document last took from the server.
  const base = readTextFieldsBase(doc);
  const noStateOutside = !stored && !!base && !servedMatchesBase(base, text, contentTag);
  const outside =
    read.externalWrite || (stored ? !storedText || otherText : !base || noStateOutside);

  if (!outside && stored) {
    // Case 1: adopt. The snapshot carries `base` and `seed` when this code wrote it.
    // Drops a seed built offline from an older text, keeps typing on top of it:
    // only seed clients are candidates (the offline seed is made after the load,
    // so the load vector would not do).
    adoptServerSnapshot(doc, stored, SERVER_ORIGIN, textFieldsSeedClocks(doc), {
      keepUnsavedEdits: true,
    });
    if (!readTextFieldsBase(doc)) {
      writeTextFieldsBaseIfUnchanged(doc, textFieldsMetaToken(doc), {
        contentTag,
        ...readTextFields(doc),
        vector: vectorOfUpdate(stored),
      });
    }
    return "adopted";
  }

  if (!stored && isTextFieldsEmpty(doc)) {
    seedTextFields(doc, text, contentTag);
    return "seeded";
  }

  if (sameTextFields(readTextFields(doc), text)) {
    // Case 2: only a stale content tag moves on.
    if (base && base.contentTag !== contentTag) {
      writeTextFieldsBaseIfUnchanged(doc, textFieldsMetaToken(doc), {
        ...base,
        contentTag,
        title: normalizeLineEnds(text.title),
        description: normalizeLineEnds(text.description),
      });
    }
    return "unchanged";
  }

  // The served text is still the one this document last took (directly, or
  // from a peer's quiet replacement over the mesh). What differs is typing on
  // top of it, this person's or a peer's: it stands, and its typist saves it.
  // Replacing would only move that typing in front of a fresh seed.
  if (base && servedMatchesBase(base, text, contentTag)) return "unchanged";

  if (pendingLocalWork) return "prompt";

  // Case 3: replace quietly, publish with the replace origin, send nothing.
  replaceTextFields(doc, text, {
    contentTag,
    objectEtag,
    storedState: storedText ? stored : null,
  });
  return "replaced";
}
