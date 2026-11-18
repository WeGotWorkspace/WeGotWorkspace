/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { checkSnapshotText } from "./docs-collab-snapshot-check";

function stateOf(markdown: string): Uint8Array {
  const doc = new Y.Doc();
  applyContentSeedToYDoc(doc, markdown, "markdown");
  return Y.encodeStateAsUpdate(doc);
}

describe("checkSnapshotText", () => {
  it("does not check a Drive document (no title field)", () => {
    expect(checkSnapshotText(stateOf("Other"), { markdown: "Real", title: null }, "markdown")).toBe(
      "match",
    );
  });

  it("still compares the body of a note whose title is null", () => {
    const update = stateOf("Other");
    expect(
      checkSnapshotText(update, { markdown: "Real", title: null, titled: true }, "markdown"),
    ).toBe("mismatch");
    expect(
      checkSnapshotText(update, { markdown: "Other", title: null, titled: true }, "markdown"),
    ).toBe("match");
  });

  it("does not read a missing title type as a different title on an untitled note", () => {
    expect(
      checkSnapshotText(
        stateOf("Same"),
        { markdown: "Same", title: null, titled: true },
        "markdown",
      ),
    ).toBe("match");
  });
});
