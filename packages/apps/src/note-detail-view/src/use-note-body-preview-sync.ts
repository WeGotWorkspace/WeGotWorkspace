import { useCallback, useEffect, useRef } from "react";
import type * as Y from "yjs";
import { readContentFromYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";

export type NoteBodyPreviewSource = "local-edit" | "hydrate";
export type NoteBodyPreviewListener = (markdown: string, source?: NoteBodyPreviewSource) => void;

/** Push the list preview this long after the last keystroke. */
export const LOCAL_EDIT_PREVIEW_DEBOUNCE_MS = 400;
/** While typing without a pause, still push the preview at least this often. */
export const LOCAL_EDIT_PREVIEW_MAX_WAIT_MS = 2000;
/** Debounce Yjs hydrate/remote bursts before pushing the list preview. */
const HYDRATE_PREVIEW_DEBOUNCE_MS = 50;

/**
 * Keeps the Notes list preview (body, excerpt, date) in step with the open
 * collab body without doing list work on every keystroke (#1714).
 *
 * The editor owns the text. Local edits are batched: the markdown is read and
 * reported once per pause in typing (or every
 * {@link LOCAL_EDIT_PREVIEW_MAX_WAIT_MS}), and once more when the session
 * unmounts or the page hides, so the last edit always reaches the list.
 * Hydrate and remote updates keep their short debounce.
 */
export function useNoteBodyPreviewSync(
  ydoc: Y.Doc | null | undefined,
  onBodyMarkdownChange: NoteBodyPreviewListener | undefined,
) {
  const listenerRef = useRef(onBodyMarkdownChange);
  listenerRef.current = onBodyMarkdownChange;
  const ydocRef = useRef(ydoc);
  if (ydoc) ydocRef.current = ydoc;
  const getMarkdownRef = useRef<(() => string) | null>(null);
  const lastNotifiedRef = useRef<string | null>(null);
  const localTimerRef = useRef<number | undefined>(undefined);
  const localFirstEditAtRef = useRef<number | null>(null);

  const notifyIfChanged = useCallback((source: NoteBodyPreviewSource) => {
    const getMarkdown = getMarkdownRef.current;
    const notify = listenerRef.current;
    if (!getMarkdown || !notify) return;
    let markdown: string;
    try {
      markdown = getMarkdown();
    } catch {
      // The editor is gone during unmount; the Y.Doc still holds the text.
      const doc = ydocRef.current;
      if (!doc) return;
      try {
        markdown = readContentFromYDoc(doc, "markdown");
      } catch {
        return;
      }
    }
    // TipTap/Yjs can emit many updates for the same document; skip duplicates so
    // list setState does not loop (Maximum update depth exceeded).
    if (lastNotifiedRef.current === markdown) return;
    lastNotifiedRef.current = markdown;
    notify(markdown, source);
  }, []);

  const flushLocalEdit = useCallback(() => {
    if (localFirstEditAtRef.current === null) return;
    window.clearTimeout(localTimerRef.current);
    localTimerRef.current = undefined;
    localFirstEditAtRef.current = null;
    notifyIfChanged("local-edit");
  }, [notifyIfChanged]);

  /** A local keystroke changed the body. Does not read the markdown. */
  const noteLocalEdit = useCallback(
    (getMarkdown: () => string) => {
      getMarkdownRef.current = getMarkdown;
      if (!listenerRef.current) return;
      const now = Date.now();
      localFirstEditAtRef.current ??= now;
      const waited = now - localFirstEditAtRef.current;
      const delay = Math.min(
        LOCAL_EDIT_PREVIEW_DEBOUNCE_MS,
        Math.max(0, LOCAL_EDIT_PREVIEW_MAX_WAIT_MS - waited),
      );
      window.clearTimeout(localTimerRef.current);
      localTimerRef.current = window.setTimeout(flushLocalEdit, delay);
    },
    [flushLocalEdit],
  );

  /** The editor just bound to the loaded Yjs doc: push the preview right away. */
  const registerMarkdownGetter = useCallback(
    (getMarkdown: () => string) => {
      getMarkdownRef.current = getMarkdown;
      notifyIfChanged("hydrate");
    },
    [notifyIfChanged],
  );

  useEffect(() => {
    // New collab session → allow one hydrate notify for the freshly loaded doc.
    lastNotifiedRef.current = null;
    if (!ydoc) return;
    let timer: number | undefined;
    const onUpdate = () => {
      if (!listenerRef.current) return;
      // A pending local flush reads the whole body anyway, remote edits included.
      if (localFirstEditAtRef.current !== null) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (localFirstEditAtRef.current !== null) return;
        notifyIfChanged("hydrate");
      }, HYDRATE_PREVIEW_DEBOUNCE_MS);
    };
    ydoc.on("update", onUpdate);
    return () => {
      ydoc.off("update", onUpdate);
      window.clearTimeout(timer);
    };
  }, [ydoc, notifyIfChanged]);

  useEffect(() => {
    // Closing or hiding the tab mid-pause still writes the latest preview.
    window.addEventListener("pagehide", flushLocalEdit);
    return () => {
      window.removeEventListener("pagehide", flushLocalEdit);
      // Switching notes unmounts the session: report the last edit first.
      flushLocalEdit();
    };
  }, [flushLocalEdit]);

  return { noteLocalEdit, registerMarkdownGetter, notifyIfChanged, flushLocalEdit };
}
