import { useCallback, useRef, useState } from "react";
import type { Note } from "@/lib/models/note";
import { noteBodyToMarkdown } from "@/lib/models/note-body-markdown";
import {
  isNotesLocalDirty,
  keepMineNotesReconnect,
  useTheirsNotesReconnect,
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
  pendingNoteIds: ReadonlySet<string>;
  applyLocalBodyMarkdown: ApplyLocalBodyMarkdown;
  onRefreshList?: () => void;
}) {
  const { active, pendingNoteIds, applyLocalBodyMarkdown, onRefreshList } = options;
  const editorDirtyRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const pendingRef = useRef(pendingNoteIds);
  pendingRef.current = pendingNoteIds;
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

  const getLocalDirty = useCallback(() => {
    return isNotesLocalDirty({
      noteId: activeRef.current?.id,
      pendingNoteIds: pendingRef.current,
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

  const useTheirs = useCallback(async () => {
    const note = activeRef.current;
    if (!note) {
      setReconnectConflict(false);
      return;
    }
    setResolving(true);
    try {
      await useTheirsNotesReconnect({
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
    reconnectConflict,
    setReconnectConflict,
    keepMine,
    useTheirs,
    resolving,
    collabEpoch,
  };
}
