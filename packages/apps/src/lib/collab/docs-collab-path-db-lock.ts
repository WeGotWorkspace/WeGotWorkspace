import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";

/** Same key as `docsCollabRoomKey`, kept here so persistence can import this file. */
const docsCollabRoomKey = normalizeOfflinePath;

/**
 * Who may move a Doc's path-keyed copy (`<room>:v2`) onto its id (#1933).
 *
 * An editor opened by path, before the id was known, keeps writing to that
 * copy. Moving it clears the source, which closes the editor's connection:
 * everything typed after that stayed in memory only. So an editor holds this
 * lock shared for as long as it has the path-keyed copy open, in any tab, and
 * a move needs it exclusive. A move that cannot get it skips the copy; the
 * next open by id moves it once every editor has let go.
 *
 * Without Web Locks (an `http://` install), an in-tab count still keeps the
 * move away from an editor in this tab.
 */
export function docsCollabPathDbLockName(roomKey: string): string {
  return `wgw-docs-path-db:${docsCollabRoomKey(roomKey)}`;
}

type LockRequest = (
  name: string,
  options: { mode: "shared" | "exclusive"; ifAvailable?: boolean },
  callback: (lock: unknown) => unknown,
) => Promise<unknown>;

function webLocks(): { request: LockRequest } | null {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks && typeof locks.request === "function"
    ? (locks as unknown as { request: LockRequest })
    : null;
}

/** Editors in this tab with the room's path-keyed copy open. */
const openInThisTab = new Map<string, number>();
/** Shared locks this tab let go of that the browser has not released yet. */
const lettingGo = new Map<string, Set<Promise<unknown>>>();

function countOpen(room: string, delta: number): void {
  const next = (openInThisTab.get(room) ?? 0) + delta;
  if (next > 0) openInThisTab.set(room, next);
  else openInThisTab.delete(room);
}

function track(room: string, released: Promise<unknown>): void {
  const pending = lettingGo.get(room) ?? new Set();
  pending.add(released);
  lettingGo.set(room, pending);
  void released.finally(() => {
    pending.delete(released);
    if (pending.size === 0 && lettingGo.get(room) === pending) lettingGo.delete(room);
  });
}

/**
 * Hold the room's path-keyed copy for an editor that opens it. Resolves once
 * no move of that copy is running; the returned release is safe to call twice.
 */
export async function holdDocsCollabPathDatabase(roomKey: string): Promise<() => void> {
  const room = docsCollabRoomKey(roomKey);
  countOpen(room, 1);
  let letGo: () => void = () => undefined;
  const locks = webLocks();
  if (locks) {
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    await new Promise<void>((granted) => {
      const released = locks
        .request(docsCollabPathDbLockName(room), { mode: "shared" }, () => {
          granted();
          return held;
        })
        .catch(() => granted());
      track(room, released);
    });
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    countOpen(room, -1);
    letGo();
  };
}

/**
 * Run `task` only when no editor, in this tab or another, has the room's
 * path-keyed copy open. Resolves to `undefined` without running it otherwise.
 */
export async function withDocsCollabPathDatabaseFree<T>(
  roomKey: string,
  task: () => Promise<T>,
): Promise<T | undefined> {
  const room = docsCollabRoomKey(roomKey);
  if (openInThisTab.has(room)) return undefined;
  // An editor in this tab that just let go: wait for the browser to release it.
  await Promise.all(lettingGo.get(room) ?? []);
  if (openInThisTab.has(room)) return undefined;
  const locks = webLocks();
  if (!locks) return task();
  let ran = false;
  const result = (await locks.request(
    docsCollabPathDbLockName(room),
    { mode: "exclusive", ifAvailable: true },
    (lock) => {
      if (!lock) return undefined;
      ran = true;
      return task();
    },
  )) as T | undefined;
  return ran ? result : undefined;
}
