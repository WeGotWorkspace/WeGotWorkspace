import { useEffect, useMemo, useState } from "react";
import { wgwApiBaseUrl, wgwEnsureFreshAccessToken, wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { fetchTaskTextRoom, taskTextPath } from "@/lib/api/wgw/tasks-text";
import { encodeFileRoomId } from "@/lib/rtc/room-id";
import type { Task } from "@/lib/models/tasks-types";
import type { DocsCollabUrls } from "@/text-editor-core/docs-collab";
import type { DocsCollabWireOperations } from "@/text-editor-core/docs-collab/docs-collab-wire";
import { createWgwCollabWire } from "@/text-editor-core/docs-collab/docs-collab-wgw-wire";

/** The live text of the open task: who types, the room, and the wire. */
export type TaskTextCollabConfig = {
  userName: string;
  urls: DocsCollabUrls;
  wire: DocsCollabWireOperations;
};

/** A task whose create is still queued has a local id and no server text yet. */
function isQueuedCreate(taskId: string): boolean {
  return taskId.startsWith("local-");
}

/**
 * The room for a task's title and description (#2208): the text-fields shape
 * of the shared collab session, saved by `PUT /tasks/items/{id}/text`. The
 * key comes from `GET …/text`, so two lists holding the same file name never
 * share a room. Only against the live API: mock and Storybook keep the
 * autosave.
 */
export async function buildTaskTextUrls(
  taskId: string,
  room: string,
  seedTitle: string,
  hooks: { onPersistForbidden: () => void; onDocumentGone: () => void },
): Promise<DocsCollabUrls> {
  const baseUrl = wgwApiBaseUrl();
  const roomId = encodeFileRoomId(room);
  const authToken = (await wgwEnsureFreshAccessToken()) ?? undefined;
  const textUrl = `${baseUrl}${taskTextPath(taskId)}`;
  return {
    signalUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/events`,
    collabApiBaseUrl: `${baseUrl}/rooms`,
    collabRtcUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/configuration`,
    authToken,
    documentUrl: textUrl,
    yjsUrl: `${textUrl}?format=yjs`,
    room,
    documentFormat: "text",
    documentShape: "text-fields",
    seedTitle,
    onPersistForbidden: hooks.onPersistForbidden,
    onDocumentGone: hooks.onDocumentGone,
  };
}

/**
 * Opens one room per open task with a server id. `accessLost` is set when the
 * save is refused (`403`) or the task is gone (`404`): the room closes and the
 * detail shows the fields read-only.
 */
export function useTaskTextCollab({
  task,
  username,
  displayName,
}: {
  task: Task | undefined;
  username: string | undefined;
  displayName: string | undefined;
}): { collab: TaskTextCollabConfig | undefined; accessLost: boolean } {
  const [urls, setUrls] = useState<{ taskId: string; urls: DocsCollabUrls } | undefined>();
  const [accessLost, setAccessLost] = useState<string | null>(null);
  const taskId = task?.id;
  // The list is part of the key: a move drops the old state, and the room
  // the server names for the moved task is a new one (spec.md, Move).
  const listId = task?.taskListId;
  const seedTitle = task?.title ?? "";
  const seedTitleRef = useLatest(seedTitle);

  useEffect(() => {
    setUrls(undefined);
    if (!wgwLiveApiEnabled() || !taskId || !username || isQueuedCreate(taskId)) return;
    let cancelled = false;
    const lose = () => {
      if (cancelled) return;
      setAccessLost(taskId);
      setUrls(undefined);
    };
    void fetchTaskTextRoom(taskId)
      .then((room) =>
        buildTaskTextUrls(taskId, room, seedTitleRef.current, {
          onPersistForbidden: lose,
          onDocumentGone: lose,
        }),
      )
      .then((built) => {
        if (!cancelled) setUrls({ taskId, urls: built });
      })
      .catch(() => {
        // No room: the fields keep the autosave, as without the live API.
        if (!cancelled) setUrls(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [listId, seedTitleRef, taskId, username]);

  const lost = accessLost !== null && accessLost === taskId;
  const wire = useMemo(() => createWgwCollabWire(), []);
  const collab = useMemo<TaskTextCollabConfig | undefined>(() => {
    if (!urls || urls.taskId !== taskId || !username || lost) return undefined;
    return { userName: displayName || username, urls: urls.urls, wire };
  }, [displayName, lost, taskId, urls, username, wire]);

  return { collab, accessLost: lost };
}

/** A ref that always holds the latest value, read by an effect without re-running it. */
function useLatest<T>(value: T): { readonly current: T } {
  const [ref] = useState(() => ({ current: value }));
  ref.current = value;
  return ref;
}
