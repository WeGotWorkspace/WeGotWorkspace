import { useEffect, useRef, useState, type RefObject } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { createNotesJmapClient } from "@/lib/api/wgw/notes-jmap";
import { noteFromVjournal, type NotesVjournalNote } from "@/lib/api/wgw/notes-vjournal";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { JmapNotesAdapter, type JmapNote, type JmapNotebook } from "@/lib/jmap-client";
import type { Note } from "@/lib/models/note";
import {
  ingestRemoteNote,
  ingestRemoteNoteDestroyed,
  ingestRemoteNotebook,
  ingestRemoteNotebookDestroyed,
  reconcileNotesSnapshot,
} from "@/lib/offline/notes-jmap-inbound";
import { getNoteFromCache, listNoteIdsBlockingSyncToken } from "@/lib/offline/notes-offline-store";
import { noteBodyInRoom } from "@/notes-core/src/note-body-rooms";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";

/** Inbound poll while push is down (REST `/changes` is the mock-tier fallback). */
export const NOTES_CHANGES_POLL_MS = 10_000;
/** While push is connected the poll only backs it up. */
export const NOTES_CHANGES_PUSH_POLL_MS = 60_000;

const PUSH_TYPES = ["Note", "Notebook"] as const;
const NO_TYPES: readonly string[] = [];

function jmapNotebookToCollection(notebook: JmapNotebook): NotesNotebookCollection {
  return {
    id: notebook.id,
    name: notebook.name,
    color: notebook.color,
    isDefault: notebook.isDefault,
    isSharee: notebook.isSharee,
    role: notebook.role,
    groupSlug: notebook.groupSlug,
    scope: notebook.scope,
    myRights: notebook.myRights ?? null,
    shareWith: (notebook.shareWith ?? null) as NotesNotebookCollection["shareWith"],
  };
}

function jmapNoteToVjournal(note: JmapNote): NotesVjournalNote {
  return {
    id: note.id,
    notebookId: note.notebookId,
    title: note.title ?? null,
    body: note.body ?? "",
    categories: note.categories ?? [],
    status: note.status ?? null,
    etag: note.etag ?? "",
    starred: note.starred,
    updatedAt: note.updatedAt,
    contentUpdatedAt: note.contentUpdatedAt,
  };
}

/**
 * A note fetched without `body` keeps the body its room put in the cache.
 * Without a cache row there is nothing to keep, so it is fetched in full.
 */
async function withBody(
  username: string,
  fetched: JmapNote,
  map: (note: JmapNote) => Note,
  fetchFull: (id: string) => Promise<JmapNote | undefined>,
): Promise<Note | null> {
  if (fetched.body !== undefined) return map(fetched);
  const cached = await getNoteFromCache(username, fetched.id);
  if (cached) {
    return {
      ...map(fetched),
      body: cached.body,
      excerpt: cached.excerpt,
      wordCount: cached.wordCount,
    };
  }
  const full = await fetchFull(fetched.id);
  return full ? map(full) : null;
}

type UseNotesLiveInboundArgs = {
  /** Account of the offline cache; null until the bootstrap knows it. */
  username: string | null;
  /** Online and bootstrapped: the inbound sync may run. */
  enabled: boolean;
  notebooks: RefObject<readonly NotesNotebookCollection[]>;
  /** Re-read the cache into the list after an ingest. */
  patchFromCache: () => Promise<void>;
};

/**
 * Live inbound Notes sync over JMAP (#1533): a push for `Note` or `Notebook`
 * runs one `/changes` round right away; the poll backs it up, slower while
 * push is connected. Returns false when JMAP is unavailable, so the caller
 * runs its REST `/changes` interval instead (#1351).
 */
export function useNotesLiveInbound({
  username,
  enabled,
  notebooks,
  patchFromCache,
}: UseNotesLiveInboundArgs): boolean {
  const [adapter, setAdapter] = useState<JmapNotesAdapter | null>(null);
  const latestPatch = useRef(patchFromCache);
  useEffect(() => {
    latestPatch.current = patchFromCache;
  }, [patchFromCache]);

  useEffect(() => {
    if (!username || !enabled) return;
    if (typeof window === "undefined" || !wgwLiveApiEnabled()) return;

    const patch = () => void latestPatch.current();
    const mapNote = (note: JmapNote) =>
      noteFromVjournal(jmapNoteToVjournal(note), notebooks.current ?? []);
    const next = new JmapNotesAdapter({
      client: createNotesJmapClient(),
      bodyInRoom: noteBodyInRoom,
      onRemoteNote: (note) => {
        void withBody(username, note, mapNote, async (id) => (await next.fetchNotes([id]))[0])
          .then((mapped) => (mapped ? ingestRemoteNote(username, mapped) : null))
          .then(patch)
          .catch((error: unknown) => console.warn("[notes] live inbound sync failed", error));
      },
      onRemoteNoteDestroyed: (noteId) =>
        ingestRemoteNoteDestroyed(username, noteId).then(async (result) => {
          patch();
          if (result !== "skipped-pending") return;
          const blocking = await listNoteIdsBlockingSyncToken(username);
          if (blocking.has(noteId)) return "skipped-pending" as const;
        }),
      onRemoteNotebook: (notebook) => {
        void ingestRemoteNotebook(username, jmapNotebookToCollection(notebook)).then(patch);
      },
      onRemoteNotebookDestroyed: (notebookId) => {
        void ingestRemoteNotebookDestroyed(username, notebookId).then(patch);
      },
      onRefetchAll: ({ notebooks: books, notes }) => {
        void reconcileNotesSnapshot(
          username,
          notes.map(mapNote),
          books.map(jmapNotebookToCollection),
        ).then(patch);
      },
      onSyncError: (error: unknown) => {
        console.warn("[notes] live inbound sync failed", error);
      },
    });

    let cancelled = false;
    void next
      .initialize()
      .then(() => {
        if (!cancelled) setAdapter(next);
      })
      .catch((error: unknown) => {
        // No notes JMAP capability, or the session failed: the caller's REST
        // `/changes` interval takes over (#1351).
        if (!cancelled) console.warn("[notes] live inbound sync unavailable", error);
      });

    return () => {
      cancelled = true;
      next.stopPolling();
      setAdapter(null);
    };
  }, [enabled, notebooks, username]);

  const pushConnected = useJmapPushConnected();
  useEffect(() => {
    if (!adapter) return;
    adapter.startPolling(pushConnected ? NOTES_CHANGES_PUSH_POLL_MS : NOTES_CHANGES_POLL_MS);
    return () => adapter.stopPolling();
  }, [adapter, pushConnected]);

  useJmapStateChange(adapter ? PUSH_TYPES : NO_TYPES, (states, accountId) =>
    adapter ? adapter.syncIfStale(states, accountId) : false,
  );

  return adapter !== null;
}
