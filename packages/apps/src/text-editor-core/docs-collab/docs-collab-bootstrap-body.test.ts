import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { ensureBootstrapEditorBody } from "./docs-collab-bootstrap-body";

vi.mock("./docs-collab-editor-surface", () => ({
  readContentFromYDoc: vi.fn(),
  applyContentSeedToYDoc: vi.fn(),
}));

import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";

describe("ensureBootstrapEditorBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds markdown when readContentFromYDoc is blank", () => {
    vi.mocked(readContentFromYDoc).mockReturnValue("");
    const ydoc = new Y.Doc();
    expect(ensureBootstrapEditorBody(ydoc, "Hello from disk", "groups/x/note.md")).toBe(
      "seeded-markdown",
    );
    expect(applyContentSeedToYDoc).toHaveBeenCalledWith(ydoc, "Hello from disk", "markdown");
  });

  it("does not seed when the Y.Doc matches the server markdown", () => {
    vi.mocked(readContentFromYDoc).mockReturnValue("Already here\n\nMore");
    const ydoc = new Y.Doc();
    expect(ensureBootstrapEditorBody(ydoc, "Already here\n\nMore", "groups/x/note.md")).toBe(
      "sidecar",
    );
    expect(applyContentSeedToYDoc).not.toHaveBeenCalled();
  });

  it("reseeds when local Yjs text diverges from server markdown", () => {
    vi.mocked(readContentFromYDoc).mockReturnValue("Admin");
    const ydoc = new Y.Doc();
    const markdown = "Ik denk van wel maar we moeten nog maar zien of dat gaat.";
    expect(ensureBootstrapEditorBody(ydoc, markdown, "groups/x/Jo!.md")).toBe("seeded-markdown");
    expect(applyContentSeedToYDoc).toHaveBeenCalledWith(ydoc, markdown, "markdown");
  });
});
