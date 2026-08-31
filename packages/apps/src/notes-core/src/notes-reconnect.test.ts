import { describe, expect, it } from "vitest";
import { resolveNotesReconnect } from "@/notes-core/src/notes-reconnect";

describe("resolveNotesReconnect", () => {
  it("continues when local is clean and etag is unchanged", () => {
    expect(resolveNotesReconnect({ localDirty: false, etagChanged: false })).toBe("continue");
  });

  it("silent-reseeds when local is clean and etag moved", () => {
    expect(resolveNotesReconnect({ localDirty: false, etagChanged: true })).toBe("reseed");
  });

  it("persists with If-Match when local is dirty and etag is unchanged", () => {
    expect(resolveNotesReconnect({ localDirty: true, etagChanged: false })).toBe("persist");
  });

  it("opens a conflict dialog when dirty and etag moved — never silent-reseeds", () => {
    expect(resolveNotesReconnect({ localDirty: true, etagChanged: true })).toBe("conflict");
  });
});
