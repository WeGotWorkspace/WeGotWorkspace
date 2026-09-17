import { Editor } from "@tiptap/react";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import {
  TrackChangesExtension,
  getBaseText,
  getGroupedChanges,
  getPendingChangeCount,
  type ChangeAuthor,
  type TrackedChangeInfo,
  type TrackChangesMode,
} from "tiptap-track-changes";
import { escapeCommentIdForSelector } from "@/text-editor-core/src/text-editor-comment-commands";
import {
  getTextEditorContent,
  type TextEditorContentFormat,
} from "@/text-editor-core/src/text-editor-content";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";

export type TextEditorCollabUser = {
  id?: string;
  name: string;
  color: string;
};

/** Stable author id derived from a display name (matches collab session coloring). */
export function trackChangesAuthorIdFromName(name: string): string {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `tc_${(hash >>> 0).toString(16)}`;
}

export function toTrackChangesAuthor(user: TextEditorCollabUser): ChangeAuthor {
  return {
    id: user.id ?? trackChangesAuthorIdFromName(user.name),
    name: user.name,
    color: user.color,
  };
}

export function editorHasTrackChanges(editor: Editor | null): editor is Editor {
  return Boolean(editor?.extensionManager.extensions.some((ext) => ext.name === "trackChanges"));
}

export function getTrackChangesMode(editor: Editor | null): TrackChangesMode {
  if (!editorHasTrackChanges(editor)) return "edit";
  return editor.storage.trackChanges.mode;
}

export function getTrackChangesPendingCount(editor: Editor | null): number {
  if (!editorHasTrackChanges(editor)) return 0;
  return getPendingChangeCount(editor);
}

export type DocsTrackChangeGroup = {
  changeId: string;
  authorName: string;
  authorColor: string;
  timestamp: string;
  from: number;
  to: number;
  anchorText: string;
  summary: string;
  parts: TrackedChangeInfo[];
};

const ANCHOR_CONTEXT_CHARS = 40;

export function escapeTrackChangeIdForSelector(id: string): string {
  return escapeCommentIdForSelector(id);
}

export function scrollTrackChangeIntoView(editor: Editor, changeId: string): void {
  const root = editor.view.dom;
  const el = root.querySelector(`[data-change-id="${escapeTrackChangeIdForSelector(changeId)}"]`);
  if (el && "scrollIntoView" in el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

export function getTrackChangeIdFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest("[data-change-id]");
  if (!el) return null;
  return el.getAttribute("data-change-id");
}

function summarizeTrackChangeParts(parts: TrackedChangeInfo[]): string {
  const insertion = parts.find((part) => part.type === "insertion");
  const deletion = parts.find((part) => part.type === "deletion");
  const formatChange = parts.find((part) => part.type === "formatChange");

  if (insertion && deletion) {
    const from = deletion.text || "…";
    const to = insertion.text || "…";
    return `Replace “${from}” with “${to}”`;
  }
  if (insertion) {
    return insertion.text ? `Insert “${insertion.text}”` : "Insert text";
  }
  if (deletion) {
    return deletion.text ? `Delete “${deletion.text}”` : "Delete text";
  }
  if (formatChange) {
    const text = formatChange.text;
    const added = formatChange.formatAdded;
    const removed = formatChange.formatRemoved;
    if (text) {
      if (added && removed) return `Change formatting of “${text}”: ${removed} → ${added}`;
      if (added) return `Add ${added} formatting to “${text}”`;
      if (removed) return `Remove ${removed} formatting from “${text}”`;
      return `Change formatting of “${text}”`;
    }
    if (added && removed) return `Change formatting: ${removed} → ${added}`;
    if (added) return `Add ${added} formatting`;
    if (removed) return `Remove ${removed} formatting`;
    return "Format change";
  }
  return "Suggested change";
}

/** Populate `text` on format-change parts when the track-changes API only has range + mark names. */
function enrichFormatChangePartText(
  editor: Editor,
  parts: TrackedChangeInfo[],
): TrackedChangeInfo[] {
  return parts.map((part) => {
    if (part.type !== "formatChange" || part.text) return part;
    const text = editor.state.doc.textBetween(part.from, part.to, " ");
    return text ? { ...part, text } : part;
  });
}

function trackChangeAnchorText(editor: Editor, from: number, to: number): string {
  const doc = editor.state.doc;
  const size = doc.content.size;
  const start = Math.max(0, from - ANCHOR_CONTEXT_CHARS);
  const end = Math.min(size, to + ANCHOR_CONTEXT_CHARS);
  const text = doc.textBetween(start, end, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function trackChangePartScore(part: TrackedChangeInfo): number {
  return (
    (part.authorName?.trim() ? 4 : 0) +
    (part.text ? 2 : 0) +
    (part.authorColor ? 1 : 0) +
    (part.timestamp ? 1 : 0)
  );
}

function mergeTrackChangePartMetadata(
  left: TrackedChangeInfo,
  right: TrackedChangeInfo,
): TrackedChangeInfo {
  const richer = trackChangePartScore(left) >= trackChangePartScore(right) ? left : right;
  const longer = (left.text?.length ?? 0) >= (right.text?.length ?? 0) ? left : right;
  return {
    ...richer,
    text: longer.text ?? richer.text,
    from: Math.min(left.from, right.from),
    to: Math.max(left.to, right.to),
  };
}

/** Collapse same-type fragments (e.g. one tracked node per typed character) into one part. */
function consolidateTrackChangePartsOfSameType(parts: TrackedChangeInfo[]): TrackedChangeInfo {
  const sorted = [...parts].sort((left, right) => left.from - right.from || left.to - right.to);
  let merged = sorted[0]!;
  for (let index = 1; index < sorted.length; index += 1) {
    merged = mergeTrackChangePartMetadata(merged, sorted[index]!);
  }
  const text = sorted.map((part) => part.text ?? "").join("");
  return text ? { ...merged, text } : merged;
}

/** Keep one part per change type; prefer richer metadata and the longest text. */
function mergeTrackChangePartsByType(parts: TrackedChangeInfo[]): TrackedChangeInfo[] {
  const byType = new Map<TrackedChangeInfo["type"], TrackedChangeInfo[]>();
  for (const part of parts) {
    const bucket = byType.get(part.type) ?? [];
    bucket.push(part);
    byType.set(part.type, bucket);
  }

  return [...byType.values()]
    .map((typeParts) => consolidateTrackChangePartsOfSameType(typeParts))
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

function resolvePrimaryTrackChangePart(parts: TrackedChangeInfo[]): TrackedChangeInfo {
  return (
    parts.find((part) => part.authorName?.trim()) ??
    parts.find((part) => part.authorColor) ??
    parts[0]!
  );
}

function buildDocsTrackChangeGroup(
  editor: Editor,
  changeId: string,
  rawParts: TrackedChangeInfo[],
): DocsTrackChangeGroup {
  const parts = mergeTrackChangePartsByType(enrichFormatChangePartText(editor, rawParts));
  const primary = resolvePrimaryTrackChangePart(parts);
  const from = Math.min(...parts.map((part) => part.from));
  const to = Math.max(...parts.map((part) => part.to));
  return {
    changeId,
    authorName: primary.authorName?.trim() || "Unknown",
    authorColor: primary.authorColor,
    timestamp: primary.timestamp,
    from,
    to,
    anchorText: trackChangeAnchorText(editor, from, to),
    summary: summarizeTrackChangeParts(parts),
    parts,
  };
}

/** Pending track-change groups sorted by document position. */
export function getDocsTrackChangeGroups(editor: Editor | null): DocsTrackChangeGroup[] {
  if (!editorHasTrackChanges(editor)) return [];

  const groups: DocsTrackChangeGroup[] = [];
  for (const [changeId, rawParts] of getGroupedChanges(editor)) {
    if (rawParts.length === 0) continue;
    groups.push(buildDocsTrackChangeGroup(editor, changeId, rawParts));
  }

  return groups.sort((left, right) => left.from - right.from || left.to - right.to);
}

export function editorHasPendingTrackChanges(editor: Editor): boolean {
  return editorHasTrackChanges(editor) && getPendingChangeCount(editor) > 0;
}

/** Serialize publishable content — pending suggestions excluded (see `getBaseText`). */
export function getAcceptedTextEditorContent(
  editor: Editor,
  format: TextEditorContentFormat,
): string {
  if (!editorHasPendingTrackChanges(editor)) {
    return getTextEditorContent(editor, format);
  }
  if (format === "text") {
    return getBaseText(editor);
  }

  const temp = new Editor({
    extensions: [
      ...createTextEditorExtensions({
        format,
        fetchImageContent: async () => {
          throw new Error("export does not fetch image bytes");
        },
      }),
      TrackChangesExtension.configure({
        author: toTrackChangesAuthor({ name: "export", color: "#6b7280" }),
      }),
    ],
    content: editor.getJSON(),
  });
  temp.commands.rejectAll();
  const accepted = getTextEditorContent(temp, format);
  temp.destroy();
  return accepted;
}
