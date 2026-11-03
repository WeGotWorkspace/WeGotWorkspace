import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { noteBodyInRoom } from "./note-body-rooms";
import { useNoteBodyCollab } from "./use-note-body-collab";

const mocks = vi.hoisted(() => ({
  resolvers: new Map<string, (urls: unknown) => void>(),
}));

vi.mock("@/lib/api/wgw/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/http")>("@/lib/api/wgw/http");
  return { ...actual, wgwLiveApiEnabled: () => true };
});
vi.mock("@/notes-core/src/note-collab-path", () => ({
  buildNoteCollabUrls: (noteId: string) =>
    new Promise((resolve) => mocks.resolvers.set(noteId, resolve)),
}));
vi.mock("@/notes-core/src/notes-collab-wgw-wire", () => ({ createWgwNotesCollabWire: () => ({}) }));
vi.mock("@/lib/offline/notes/notes-archived-elsewhere", () => ({
  settleNoteArchivedElsewhere: vi.fn(),
}));

const note = (id: string) => ({ id }) as Note;

function render(initial: { active: Note | undefined; archived: boolean }) {
  return renderHook(
    ({ active, archived }) =>
      useNoteBodyCollab({
        active,
        archived,
        username: "admin",
        displayName: "Admin",
        offlineUsername: "admin",
      }),
    { initialProps: initial },
  );
}

async function openRoom(noteId: string) {
  await act(async () => {
    mocks.resolvers.get(noteId)?.({ ws: `room-${noteId}` });
  });
}

describe("useNoteBodyCollab room hold", () => {
  beforeEach(() => mocks.resolvers.clear());

  it("holds the note's body once its room is built, and releases it on unmount", async () => {
    const { unmount } = render({ active: note("a"), archived: false });
    expect(noteBodyInRoom("a")).toBe(false);

    await openRoom("a");
    expect(noteBodyInRoom("a")).toBe(true);

    unmount();
    expect(noteBodyInRoom("a")).toBe(false);
  });

  it("does not hold the next note while the previous note's room is still set", async () => {
    const { rerender } = render({ active: note("a"), archived: false });
    await openRoom("a");

    rerender({ active: note("b"), archived: false });
    expect(noteBodyInRoom("a")).toBe(false);
    expect(noteBodyInRoom("b")).toBe(false);

    await openRoom("b");
    expect(noteBodyInRoom("b")).toBe(true);
  });

  it("releases the hold when the note is archived", async () => {
    const { rerender } = render({ active: note("c"), archived: false });
    await openRoom("c");
    expect(noteBodyInRoom("c")).toBe(true);

    rerender({ active: note("c"), archived: true });
    expect(noteBodyInRoom("c")).toBe(false);
  });
});
