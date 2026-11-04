import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexeddbPersistence } from "y-indexeddb";
import type { DocsCollabUrls } from "./docs-collab-types";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";

const uploadPendingCollabRooms = vi.hoisted(() => vi.fn(async () => undefined));
const setCollabRoomPendingServerSave = vi.hoisted(() => vi.fn());
const online = vi.hoisted(() => ({ value: true }));

vi.mock("./docs-collab-pending-upload", () => ({ uploadPendingCollabRooms }));
vi.mock("./docs-collab-pending-registry", () => ({ setCollabRoomPendingServerSave }));
vi.mock("@/lib/offline/browser-online", () => ({ getConnectivitySnapshot: () => online.value }));

import { closeCollabRoomStore } from "./docs-collab-leave-room";

const URLS: DocsCollabUrls = {
  signalUrl: "/rooms/n1/events",
  documentUrl: "/notes/items/n1",
  yjsUrl: "/notes/items/n1?format=yjs",
  room: "n1",
  authToken: "old-token",
};

function store() {
  const calls: string[] = [];
  const persistence = {
    name: "docs-collab:n1",
    set: vi.fn(async (key: string) => {
      calls.push(`set ${key}`);
    }),
    destroy: vi.fn(async () => {
      calls.push("destroy");
    }),
  };
  return { persistence: persistence as unknown as IndexeddbPersistence, raw: persistence, calls };
}

describe("closeCollabRoomStore", () => {
  beforeEach(() => {
    online.value = true;
    uploadPendingCollabRooms.mockClear();
    setCollabRoomPendingServerSave.mockClear();
  });

  it("only closes the store when no save was due", async () => {
    const { persistence, raw, calls } = store();
    await closeCollabRoomStore(persistence, null);
    expect(calls).toEqual(["destroy"]);
    expect(raw.set).not.toHaveBeenCalled();
    expect(uploadPendingCollabRooms).not.toHaveBeenCalled();
  });

  it("marks a room left with a save due as unsaved, closes it, then saves it in the background", async () => {
    const { persistence, calls } = store();
    await closeCollabRoomStore(persistence, { room: "n1", urls: URLS });

    expect(calls).toEqual([`set ${PENDING_SERVER_SAVE_KEY}`, "destroy"]);
    expect(setCollabRoomPendingServerSave).toHaveBeenCalledWith("n1", true);
    expect(uploadPendingCollabRooms).toHaveBeenCalledTimes(1);
    const [[rooms]] = uploadPendingCollabRooms.mock.calls as unknown as [
      [{ room: string; databaseName: string; urls: () => DocsCollabUrls; format: string }[]],
    ];
    const room = rooms[0]!;
    expect(room).toMatchObject({ room: "n1", databaseName: "docs-collab:n1" });
    // The save fetches a fresh token instead of the one the room opened with.
    expect(room.urls()).toMatchObject({ yjsUrl: URLS.yjsUrl, authToken: undefined });
  });

  it("only marks a held room, without saving it to the server", async () => {
    const { persistence, calls } = store();
    await closeCollabRoomStore(persistence, { room: "n1", urls: URLS }, { upload: false });
    expect(calls).toEqual([`set ${PENDING_SERVER_SAVE_KEY}`, "destroy"]);
    expect(setCollabRoomPendingServerSave).toHaveBeenCalledWith("n1", true);
    expect(uploadPendingCollabRooms).not.toHaveBeenCalled();
  });

  it("keeps the mark for the reconnect sweep while offline", async () => {
    online.value = false;
    const { persistence, raw } = store();
    await closeCollabRoomStore(persistence, { room: "n1", urls: URLS });
    expect(raw.set).toHaveBeenCalledWith(PENDING_SERVER_SAVE_KEY, 1);
    expect(uploadPendingCollabRooms).not.toHaveBeenCalled();
  });
});
