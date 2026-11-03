import * as Y from "yjs";
import { NOTE_TITLE_YTEXT_KEY, noteTitleIsInDoc } from "./docs-collab-document-title";
import { colorForName } from "./docs-collab-utils";

/**
 * Awareness field for the title caret. Separate from the y-prosemirror
 * `cursor` field, which holds positions in the body fragment.
 */
export const NOTE_TITLE_SELECTION_FIELD = "noteTitleSelection";

/** Selection as indexes into the title text. */
export type TitleSelection = { anchor: number; head: number };

/** Awareness payload: Yjs relative positions, as JSON. */
export type TitleSelectionState = { anchor: unknown; head: unknown };

export type RemoteTitleCaret = TitleSelection & {
  clientId: number;
  name: string;
  color: string;
};

type AwarenessStates = ReadonlyMap<number, Record<string, unknown> | null | undefined>;

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/**
 * Relative positions for a selection in the title. Null while the document has
 * no title type: creating it here would make the next save send an empty title.
 */
export function encodeTitleSelection(
  doc: Y.Doc,
  selection: TitleSelection,
): TitleSelectionState | null {
  if (!noteTitleIsInDoc(doc)) return null;
  const text = doc.getText(NOTE_TITLE_YTEXT_KEY);
  return {
    anchor: relativeJson(text, selection.anchor),
    head: relativeJson(text, selection.head),
  };
}

/**
 * Indexes in the current title for an awareness value from another peer.
 * Null when the value is malformed or does not point into the title.
 */
export function decodeTitleSelection(doc: Y.Doc, value: unknown): TitleSelection | null {
  if (!noteTitleIsInDoc(doc) || !isRecord(value)) return null;
  const text = doc.getText(NOTE_TITLE_YTEXT_KEY);
  const anchor = absoluteIndex(doc, text, value.anchor);
  const head = absoluteIndex(doc, text, value.head);
  if (anchor === null || head === null) return null;
  return { anchor, head };
}

/**
 * Carets to draw in the title. Skips this tab, and the local account's other
 * tabs by display name (the rule the presence chrome uses).
 */
export function listRemoteTitleCarets(
  doc: Y.Doc,
  states: AwarenessStates,
  local: { clientId: number; userName: string },
): RemoteTitleCaret[] {
  const localName = normalizeName(local.userName);
  const carets: RemoteTitleCaret[] = [];
  states.forEach((state, clientId) => {
    if (clientId === local.clientId || !state) return;
    const user = readUser(state.user);
    if (!user || normalizeName(user.name) === localName) return;
    const selection = decodeTitleSelection(doc, state[NOTE_TITLE_SELECTION_FIELD]);
    if (!selection) return;
    carets.push({ clientId, ...user, ...selection });
  });
  return carets;
}

function relativeJson(text: Y.Text, index: number): unknown {
  const clamped = Math.min(Math.max(0, Math.trunc(index) || 0), text.length);
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, clamped));
}

function absoluteIndex(doc: Y.Doc, text: Y.Text, json: unknown): number | null {
  if (!isRecord(json)) return null;
  try {
    const relative = Y.createRelativePositionFromJSON(json);
    const absolute = Y.createAbsolutePositionFromRelativePosition(relative, doc);
    if (!absolute || absolute.type !== text) return null;
    return absolute.index;
  } catch {
    // A peer's value that Yjs cannot resolve is not a caret.
    return null;
  }
}

function readUser(value: unknown): { name: string; color: string } | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const name = value.name.trim();
  if (!name) return null;
  const color =
    typeof value.color === "string" && HEX_COLOR.test(value.color)
      ? value.color
      : colorForName(name);
  return { name, color };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
