import { describe, expect, it, vi } from "vitest";
import {
  reportNotesSyncConflicts,
  setNotesSyncConflictListener,
} from "@/lib/offline/notes/notes-sync-conflicts";

describe("notes sync conflicts", () => {
  it("reports note ids to the active listener", () => {
    const listener = vi.fn();
    setNotesSyncConflictListener(listener);
    reportNotesSyncConflicts(["note-1", "note-2"]);
    expect(listener).toHaveBeenCalledWith(["note-1", "note-2"]);
    setNotesSyncConflictListener(undefined);
  });
});
