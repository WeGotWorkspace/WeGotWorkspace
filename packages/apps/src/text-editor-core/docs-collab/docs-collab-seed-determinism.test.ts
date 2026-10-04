/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";

const SHARED_MARKDOWN = "# Together\n\nOne paragraph that must survive exactly once.\n";

const MARKER = "must survive exactly once";

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** A client that opens the document with no sidecar and seeds the markdown itself. */
function seedingClient(markdown: string): Y.Doc {
  const ydoc = new Y.Doc();
  applyContentSeedToYDoc(ydoc, markdown, "markdown");
  return ydoc;
}

function mergeInto(target: Y.Doc, sources: Y.Doc[]): Y.Doc {
  for (const source of sources) {
    Y.applyUpdate(target, Y.encodeStateAsUpdate(source));
  }
  return target;
}

describe("deterministic markdown seeding", () => {
  it("produces byte-identical updates for identical markdown", () => {
    const first = seedingClient(SHARED_MARKDOWN);
    const second = seedingClient(SHARED_MARKDOWN);

    expect(Array.from(Y.encodeStateAsUpdate(first))).toEqual(
      Array.from(Y.encodeStateAsUpdate(second)),
    );
  });

  it("converges two clients that bootstrap the same markdown with no sidecar", () => {
    const first = seedingClient(SHARED_MARKDOWN);
    const second = seedingClient(SHARED_MARKDOWN);

    const merged = mergeInto(first, [second]);

    expect(occurrences(readContentFromYDoc(merged, "markdown"), MARKER)).toBe(1);
  });

  it("converges three clients regardless of merge order", () => {
    const docs = [
      seedingClient(SHARED_MARKDOWN),
      seedingClient(SHARED_MARKDOWN),
      seedingClient(SHARED_MARKDOWN),
    ];
    const updates = docs.map((doc) => Y.encodeStateAsUpdate(doc));
    const orders = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
    ];

    for (const order of orders) {
      const merged = new Y.Doc();
      for (const index of order) Y.applyUpdate(merged, updates[index]!);
      expect(occurrences(readContentFromYDoc(merged, "markdown"), MARKER)).toBe(1);
    }
  });

  it("keeps distinct markdown distinct", () => {
    const first = seedingClient("# One\n");
    const second = seedingClient("# Two\n");

    const merged = mergeInto(new Y.Doc(), [first, second]);
    const content = readContentFromYDoc(merged, "markdown");

    expect(content).toContain("One");
    expect(content).toContain("Two");
  });

  it("separates the same text seeded as markdown and as plain text", () => {
    const asMarkdown = seedingClient(SHARED_MARKDOWN);
    const asText = new Y.Doc();
    applyContentSeedToYDoc(asText, SHARED_MARKDOWN, "text");

    expect(Array.from(Y.encodeStateAsUpdate(asMarkdown))).not.toEqual(
      Array.from(Y.encodeStateAsUpdate(asText)),
    );
  });
});
