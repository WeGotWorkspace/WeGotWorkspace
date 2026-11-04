import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexeddbPersistence } from "y-indexeddb";
import type { DocsCollabUrls } from "./docs-collab-types";

const closeCollabRoomStore = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./docs-collab-leave-room", () => ({ closeCollabRoomStore }));

import { leaveCollabRoom, rememberCollabRoomJoin } from "./docs-collab-joined-room";

const urlsFor = (room: string, extra: Partial<DocsCollabUrls> = {}): DocsCollabUrls => ({
  signalUrl: `/rooms/${room}/events`,
  documentUrl: `/notes/items/${room}`,
  yjsUrl: `/notes/items/${room}?format=yjs`,
  room,
  ...extra,
});
const store = () => ({ name: "docs-collab:x" }) as unknown as IndexeddbPersistence;
const armed = () => ({ current: setTimeout(() => undefined, 60_000) });

describe("leaveCollabRoom", () => {
  beforeEach(() => closeCollabRoomStore.mockClear());

  it("closes the store without a save when none was armed", () => {
    const persistence = store();
    rememberCollabRoomJoin(persistence, { room: "a", urls: urlsFor("a") });
    leaveCollabRoom(persistence, { current: null }, { room: "a", urls: urlsFor("a") });
    expect(closeCollabRoomStore).toHaveBeenCalledWith(persistence, null, { upload: true });
  });

  it("saves to the room the store joined, not the room the render now carries", () => {
    const persistence = store();
    const timer = armed();
    rememberCollabRoomJoin(persistence, { room: "a", urls: urlsFor("a") });
    leaveCollabRoom(persistence, timer, { room: "b", urls: urlsFor("b") });
    expect(timer.current).toBeNull();
    expect(closeCollabRoomStore).toHaveBeenCalledWith(
      persistence,
      { room: "a", urls: urlsFor("a") },
      { upload: true },
    );
  });

  it("marks a held room unsaved without saving it to the server", () => {
    const persistence = store();
    const urls = urlsFor("a", { roomNotPersistent: true });
    rememberCollabRoomJoin(persistence, { room: "a", urls });
    leaveCollabRoom(persistence, armed(), { room: "a", urls });
    expect(closeCollabRoomStore).toHaveBeenCalledWith(
      persistence,
      { room: "a", urls },
      { upload: false },
    );
  });

  it("still cancels the save when there is no store", () => {
    const timer = armed();
    leaveCollabRoom(null, timer, { room: "a", urls: urlsFor("a") });
    expect(timer.current).toBeNull();
    expect(closeCollabRoomStore).not.toHaveBeenCalled();
  });
});
