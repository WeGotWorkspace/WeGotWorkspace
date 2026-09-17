import { describe, expect, it, vi } from "vitest";
import {
  isNotesMetadataSyncRace,
  isNotesPersistForbidden,
  isNotesPersistGone,
  NOTES_ACCESS_LOST_MESSAGE,
  persistNoteKeepingSyncRace,
  persistNoteOrDropGone,
  resolveNotesPersistAccess,
} from "@/notes-core/src/notes-persist-access";

describe("notes persist 403", () => {
  it("treats status 403 as access lost", () => {
    expect(isNotesPersistForbidden({ status: 403 })).toBe(true);
    expect(resolveNotesPersistAccess({ status: 403 })).toBe("leave-room");
  });

  it("treats a (403) message as access lost", () => {
    expect(isNotesPersistForbidden(new Error("PATCH /notes/items/uid failed (403)"))).toBe(true);
  });

  it("does not leave the room for 412 or network errors", () => {
    expect(resolveNotesPersistAccess({ status: 412 })).toBe("continue");
    expect(resolveNotesPersistAccess(new Error("network down"))).toBe("continue");
  });

  it("exposes a visible not-saved message", () => {
    expect(NOTES_ACCESS_LOST_MESSAGE).toMatch(/no longer have access/i);
    expect(NOTES_ACCESS_LOST_MESSAGE).toMatch(/not stored/i);
  });
});

describe("notes persist 404", () => {
  it("treats status 404 as gone on the server", () => {
    expect(isNotesPersistGone({ status: 404 })).toBe(true);
    expect(isNotesPersistGone(new Error("Note not found (404)"))).toBe(true);
  });

  it("does not treat 401/403/412/5xx as gone", () => {
    expect(isNotesPersistGone({ status: 401 })).toBe(false);
    expect(isNotesPersistGone({ status: 403 })).toBe(false);
    expect(isNotesPersistGone({ status: 412 })).toBe(false);
    expect(isNotesPersistGone({ status: 500 })).toBe(false);
  });

  it("drops local via persistNoteOrDropGone on 404 and does not rethrow", async () => {
    const onGone = vi.fn();
    const gone = Object.assign(new Error("not found"), { status: 404 });
    await expect(persistNoteOrDropGone(Promise.reject(gone), onGone)).resolves.toBeUndefined();
    expect(onGone).toHaveBeenCalledOnce();
  });

  it("does not treat a local-* 404 as gone", () => {
    expect(isNotesPersistGone({ status: 404 }, "local-abc123")).toBe(false);
    expect(isNotesPersistGone({ status: 404 }, "note-1")).toBe(true);
  });

  it("keeps optimistic tags on 412 or local-* 404 via persistNoteKeepingSyncRace", async () => {
    const onGone = vi.fn();
    await expect(
      persistNoteKeepingSyncRace(
        Promise.reject(Object.assign(new Error("precondition"), { status: 412 })),
        onGone,
        "note-1",
      ),
    ).resolves.toBeUndefined();
    await expect(
      persistNoteKeepingSyncRace(
        Promise.reject(Object.assign(new Error("not found"), { status: 404 })),
        onGone,
        "local-abc123",
      ),
    ).resolves.toBeUndefined();
    expect(onGone).not.toHaveBeenCalled();
    expect(isNotesMetadataSyncRace({ status: 412 }, "note-1")).toBe(true);
  });

  it("rethrows 412/403 so callers keep the local row", async () => {
    const onGone = vi.fn();
    await expect(
      persistNoteOrDropGone(
        Promise.reject(Object.assign(new Error("precondition"), { status: 412 })),
        onGone,
      ),
    ).rejects.toMatchObject({ status: 412 });
    await expect(
      persistNoteOrDropGone(
        Promise.reject(Object.assign(new Error("forbidden"), { status: 403 })),
        onGone,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(onGone).not.toHaveBeenCalled();
  });
});
