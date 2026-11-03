/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import {
  collabUploadLockName,
  type PendingCollabRoom,
  uploadPendingCollabRooms,
} from "./docs-collab-pending-upload";
import { holdCrossTabLock } from "@/lib/offline/core/cross-tab-lock";
import type { DocsCollabUrls } from "./docs-collab-types";
import { EXTERNAL_WRITE_HEADER } from "./docs-collab-external-write";
import {
  isCollabRoomPendingServerSave,
  setCollabRoomPendingServerSave,
} from "./docs-collab-pending-registry";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";

let counter = 0;

/** A body typed offline in a room that is not open any more. */
async function leftRoom(markdown: string, pending = true): Promise<PendingCollabRoom> {
  counter += 1;
  const room = `left-room-${counter}`;
  const databaseName = `${room}:v2`;
  const ydoc = new Y.Doc();
  applyContentSeedToYDoc(ydoc, markdown);
  const persistence = new IndexeddbPersistence(databaseName, ydoc);
  await persistence.whenSynced;
  if (pending) await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
  ydoc.destroy();
  const urls: DocsCollabUrls = {
    room,
    signalUrl: "",
    authToken: "token",
    documentUrl: `https://wgw.test/notes/items/${room}`,
    yjsUrl: `https://wgw.test/notes/items/${room}?format=yjs`,
  };
  return { room, databaseName, urls: () => urls, format: "markdown" };
}

async function stillPending(room: PendingCollabRoom): Promise<boolean> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(room.databaseName, ydoc);
  await persistence.whenSynced;
  const pending = Boolean(await persistence.get(PENDING_SERVER_SAVE_KEY));
  await persistence.destroy();
  ydoc.destroy();
  return pending;
}

const fetchMock = vi.fn<typeof fetch>();
const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");

function server({ snapshotHeaders = {}, putStatus = 200 } = {}) {
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method === "PUT") {
      return new Response("{}", { status: putStatus, headers: { ETag: '"saved"' } });
    }
    // No sidecar yet, unless the test says the text changed outside the app.
    if (Object.keys(snapshotHeaders).length === 0) return new Response(null, { status: 204 });
    return new Response(new Uint8Array([0, 0]), { status: 200, headers: snapshotHeaders });
  });
}

/** Web Locks as a browser runs them, shared by every "tab" in this test. */
function installWebLocks(): void {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const locks = {
    async request(
      name: string,
      options: { ifAvailable?: boolean },
      callback: (lock: object | null) => Promise<unknown>,
    ) {
      if (held.has(name)) {
        if (options.ifAvailable) return callback(null);
        await new Promise<void>((resolve) =>
          waiting.set(name, [...(waiting.get(name) ?? []), resolve]),
        );
      }
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
        const next = waiting.get(name)?.shift();
        next?.();
      }
    },
  };
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
}

beforeEach(() => {
  installWebLocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("uploadPendingCollabRooms", () => {
  it("saves a body typed offline in a room that is no longer open", async () => {
    server();
    const room = await leftRoom("Typed offline");
    setCollabRoomPendingServerSave(room.room, true);

    await uploadPendingCollabRooms([room]);

    expect(isCollabRoomPendingServerSave(room.room)).toBe(false);
    expect(puts()).toHaveLength(1);
    const body = new TextDecoder().decode(puts()[0]?.[1]?.body as Uint8Array);
    expect(body).toContain("Typed offline");
    expect(await stillPending(room)).toBe(false);
  });

  it("leaves a room without unsaved text alone", async () => {
    server();
    const room = await leftRoom("Already saved", false);

    await uploadPendingCollabRooms([room]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a room an open editor holds, in this tab or another", async () => {
    server();
    const room = await leftRoom("Open elsewhere");
    const release = holdCrossTabLock(collabUploadLockName(room.databaseName));
    await Promise.resolve();

    await uploadPendingCollabRooms([room]);
    release();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await stillPending(room)).toBe(true);
  });

  it("leaves the flag when the save was skipped (a room not on the server yet)", async () => {
    server();
    const room = await leftRoom("Local only");
    const urls = await room.urls();
    const localOnly = { ...room, urls: () => ({ ...urls, roomNotPersistent: true }) };

    await uploadPendingCollabRooms([localOnly]);

    expect(puts()).toHaveLength(0);
    expect(await stillPending(room)).toBe(true);
  });

  it("keeps the text unsaved when it changed outside the app, for the editor to ask", async () => {
    server({ snapshotHeaders: { [EXTERNAL_WRITE_HEADER]: "1" } });
    const room = await leftRoom("Mine");

    await uploadPendingCollabRooms([room]);

    expect(puts()).toHaveLength(0);
    expect(await stillPending(room)).toBe(true);
  });

  it("keeps the text unsaved when the save fails, and goes on with the next room", async () => {
    server({ putStatus: 500 });
    const failing = await leftRoom("First");
    const next = await leftRoom("Second");

    await uploadPendingCollabRooms([failing, next]);

    expect(puts()).toHaveLength(2);
    expect(await stillPending(failing)).toBe(true);
  });
});
