import { afterEach, describe, expect, it, vi } from "vitest";
import { askAboutRefusedSave } from "./docs-collab-external-write-refusal";
import type { DocsCollabSessionRefs, DocsCollabUrls } from "./docs-collab-types";

function refsWith(reread: DocsCollabSessionRefs["rereadServerRef"]["current"]) {
  return {
    authTokenRef: { current: "token" },
    externalWriteHoldRef: { current: false },
    externalWriteSeenRef: { current: null },
    rereadServerRef: { current: reread },
  } as unknown as DocsCollabSessionRefs;
}

const textFieldsUrls = {
  documentUrl: "/api/v1/tasks/items/t1/text",
  yjsUrl: "/api/v1/tasks/items/t1/text?format=yjs",
  documentShape: "text-fields",
  onExternalWrite: vi.fn(),
} as unknown as DocsCollabUrls;

describe("askAboutRefusedSave", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets the text-fields re-read decide, with no question of its own", async () => {
    // A teammate's save already holds this person's typing: the re-read
    // replaces quietly, so the refusal neither holds nor asks (#2208).
    const reread = vi.fn(async () => true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const refs = refsWith(reread);

    await expect(askAboutRefusedSave({ refs, urls: textFieldsUrls })).resolves.toBe(true);

    expect(reread).toHaveBeenCalledWith("token");
    expect(refs.externalWriteHoldRef.current).toBe(false);
    expect(textFieldsUrls.onExternalWrite).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to an ordinary failed save when the re-read cannot run", async () => {
    const refs = refsWith(async () => {
      throw new Error("offline");
    });
    await expect(askAboutRefusedSave({ refs, urls: textFieldsUrls })).resolves.toBe(false);
    expect(refs.externalWriteHoldRef.current).toBe(false);
  });
});
