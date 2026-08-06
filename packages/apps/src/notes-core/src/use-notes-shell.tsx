import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useStarredMap } from "@/hooks/use-starred-map";
import type { Note } from "@/lib/models/note";
import type { WorkspaceAppHandle } from "@/workspace-app/src/workspace-app";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import { mergeNotesLabels, type NotesUILabels } from "./notes-labels";
import {
  enrichNote,
  normalizeTag,
  notesCanCreateInView,
  noteShowsTags,
  sharedNotebookLabel,
} from "./notes-note-utils";
import type { NotesAPIOperations, NotesUIData } from "./notes-types";

/** Debounce bursts of edits before showing a save toast. */
const AUTO_SAVE_TOAST_DEBOUNCE_MS = 1200;
/** At most one save toast per interval while the user keeps typing. */
const AUTO_SAVE_TOAST_THROTTLE_MS = 8000;

export type UseNotesShellArgs = {
  data: NotesUIData;
  labels?: Partial<NotesUILabels>;
  listLoading?: boolean;
  operations?: NotesAPIOperations;
  bootstrapRevision?: number;
  initialView?: string;
  onViewChange?: (view: string) => void;
};

export function useNotesShell({
  data,
  labels,
  listLoading = false,
  operations,
  bootstrapRevision = 0,
  initialView,
  onViewChange,
}: UseNotesShellArgs) {
  const L = useMemo(() => mergeNotesLabels(labels), [labels]);
  const [notes, setNotes] = useState<Note[]>(() => data.notes.map(enrichNote));
  const [view, setView] = useState<string>(() => initialView ?? "all");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceLayoutRef = useRef<WorkspaceAppHandle>(null);
  const autoSaveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSaveToastAtRef = useRef(0);

  const initialStarred = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const note of data.notes) {
      if (note.starred) map[note.id] = true;
    }
    return map;
  }, [data.notes]);
  const {
    starred,
    setStarred,
    toggleStar: applyStarToggle,
    batchToggleStarForIds,
  } = useStarredMap(initialStarred);
  const [archived, setArchived] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const note of data.notes) {
      if (note.archived) map[note.id] = true;
    }
    return map;
  });

  const { show, showError } = useAppToast();
  const showMutationError = useCallback(
    (fallback = "Could not sync this change. Please try again.") => showError(fallback),
    [showError],
  );
  const queueAutoSaveToast = useCallback(() => {
    if (autoSaveToastTimerRef.current) {
      clearTimeout(autoSaveToastTimerRef.current);
    }
    autoSaveToastTimerRef.current = setTimeout(() => {
      const now = Date.now();
      if (now - lastAutoSaveToastAtRef.current < AUTO_SAVE_TOAST_THROTTLE_MS) {
        autoSaveToastTimerRef.current = null;
        return;
      }
      lastAutoSaveToastAtRef.current = now;
      show(L.toastSaved, { icon: <Check className="size-4" /> });
      autoSaveToastTimerRef.current = null;
    }, AUTO_SAVE_TOAST_DEBOUNCE_MS);
  }, [L.toastSaved, show]);

  useEffect(
    () => () => {
      if (autoSaveToastTimerRef.current) {
        clearTimeout(autoSaveToastTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setNotes(data.notes.map(enrichNote));
  }, [bootstrapRevision, data]);

  useEffect(() => {
    if (initialView === undefined) return;
    setView(initialView);
  }, [initialView]);

  const notebooks = useMemo(() => {
    const fromData = data.notebooks ?? [];
    const fromNotes = notes
      .filter((note) => !note.sharedInbox && !note.sharedNotebookGrant && note.scope !== "group")
      .map((note) => note.notebook)
      .filter((name) => name.trim().length > 0);
    return [...new Set([...fromData, ...fromNotes])];
  }, [data.notebooks, notes]);
  const notebooksWithShares = useMemo(
    () => new Set(data.notebooksWithShares ?? []),
    [data.notebooksWithShares],
  );
  const sharedNotebooks = useMemo(() => data.sharedNotebooks ?? [], [data.sharedNotebooks]);
  const tags = useMemo(
    () => [
      ...new Set(
        notes
          .filter((note) => noteShowsTags(note))
          .flatMap((note) => note.tags.map((tag) => normalizeTag(tag)))
          .filter(Boolean),
      ),
    ],
    [notes],
  );

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const note of notes) {
      if (note.starred) next[note.id] = true;
    }
    setStarred(next);
  }, [notes, setStarred]);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const note of notes) {
      if (note.archived) next[note.id] = true;
    }
    setArchived(next);
  }, [notes, setArchived]);

  const viewLabel = useMemo(() => {
    if (view === "all") return L.sidebarAllItems;
    if (view === "starred") return L.sidebarStarred;
    if (view === "archive") return L.sidebarArchive;
    if (view === "shared-with-me") return L.sidebarSharedWithMe;
    if (view.startsWith("shared-nb:")) {
      const path = view.slice("shared-nb:".length);
      const match = sharedNotebooks.find(
        (entry) => entry.path === path || entry.path === `/${path.replace(/^\//, "")}`,
      );
      if (match) return sharedNotebookLabel(match);
      return path.split("/").pop() ?? L.sectionSharedNotebooks;
    }
    if (view.startsWith("nb:")) return view.slice(3);
    if (view.startsWith("tag:")) return L.tagViewTitle(view.slice(4));
    return L.fallbackViewTitle;
  }, [L, sharedNotebooks, view]);

  const canCreateNote = notesCanCreateInView(view);
  const selectedNotebook = view.startsWith("nb:") ? view.slice(3) : null;
  const selectedTag = view.startsWith("tag:") ? view.slice(4) : null;
  const canEditDelete = !!(selectedNotebook || selectedTag);

  const selectView = useCallback((nextView: string) => {
    setView(nextView);
    workspaceLayoutRef.current?.closeMobileDetail();
    if (isSidebarOverlayViewport()) {
      workspaceLayoutRef.current?.closeSidebar();
    }
  }, []);

  const viewSyncedRef = useRef(false);
  useEffect(() => {
    if (!viewSyncedRef.current) {
      viewSyncedRef.current = true;
      return;
    }
    onViewChange?.(view);
  }, [view, onViewChange]);

  return {
    L,
    data,
    notes,
    setNotes,
    view,
    setView,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    workspaceLayoutRef,
    starred,
    applyStarToggle,
    batchToggleStarForIds,
    archived,
    setArchived,
    notebooks,
    notebooksWithShares,
    sharedNotebooks,
    tags,
    viewLabel,
    canCreateNote,
    selectedNotebook,
    selectedTag,
    canEditDelete,
    selectView,
    listLoading,
    operations,
    show,
    showMutationError,
    queueAutoSaveToast,
  };
}

export type NotesShellState = ReturnType<typeof useNotesShell>;
