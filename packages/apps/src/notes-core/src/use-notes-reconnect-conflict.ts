import { useCallback, useRef, useState } from "react";
import type { Note } from "@/lib/models/note";
import { noteBodyToMarkdown } from "@/lib/models/note-body-markdown";
import {
  isNotesLocalDirty,
  keepMineNotesReconnect,
  applyTheirsNotesReconnect,
} from "@/notes-core/src/notes-reconnect-actions";

type ApplyLocalBodyMarkdown = (
  id: string,
  markdown: string,
  options?: { bumpDate?: boolean },
) => void;

/**
 * Workspace-owned Decision 6 wiring: live dirty getter + Keep mine / Use theirs.
 */
export function useNotesReconnectConflict(options: {
  active: Note | null;
  applyLocalBodyMarkdown: ApplyLocalBodyMarkdown;
  onRefreshList?: () => void;
}) {
  const { active, applyLocalBodyMarkdown, onRefreshList } = options;
  const editorDirtyRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const applyBodyRef = useRef(applyLocalBodyMarkdown);
  applyBodyRef.current = applyLocalBodyMarkdown;
  const refreshRef = useRef(onRefreshList);
  refreshRef.current = onRefreshList;

  const [reconnectConflict, setReconnectConflict] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [collabEpoch, setCollabEpoch] = useState(0);

  const markEditorDirty = useCallback((dirty: boolean) => {
    editorDirtyRef.current = dirty;
  }, []);

  /** Server accepted this body — dirty means unsaved local edits, not "ever typed". */
  const markEditorSaved = useCallback((savedMarkdown: string) => {
    const note = activeRef.current;
    if (!note) return;
    if (noteBodyToMarkdown(note.body) !== savedMarkdown) return;
    editorDirtyRef.current = false;
  }, []);

  const getLocalDirty = useCallback(() => {
    return isNotesLocalDirty({
      noteId: activeRef.current?.id,
      editorDirty: editorDirtyRef.current,
    });
  }, []);

  const keepMine = useCallback(async () => {
    const note = activeRef.current;
    if (!note) {
      setReconnectConflict(false);
      return;
    }
    setResolving(true);
    try {
      await keepMineNotesReconnect({
        noteId: note.id,
        markdown: noteBodyToMarkdown(note.body),
      });
      editorDirtyRef.current = false;
    } finally {
      setResolving(false);
      setReconnectConflict(false);
    }
  }, []);

  const applyTheirs = useCallback(async () => {
    const note = activeRef.current;
    if (!note) {
      setReconnectConflict(false);
      return;
    }
    setResolving(true);
    try {
      await applyTheirsNotesReconnect({
        noteId: note.id,
        applyServerBody: (markdown) => applyBodyRef.current(note.id, markdown, { bumpDate: false }),
        refreshList: refreshRef.current,
      });
      editorDirtyRef.current = false;
      setCollabEpoch((epoch) => epoch + 1);
    } finally {
      setResolving(false);
      setReconnectConflict(false);
    }
  }, []);

  return {
    getLocalDirty,
    markEditorDirty,
    markEditorSaved,
    reconnectConflict,
    setReconnectConflict,
    keepMine,
    applyTheirs,
    resolving,
    collabEpoch,
  };
}
