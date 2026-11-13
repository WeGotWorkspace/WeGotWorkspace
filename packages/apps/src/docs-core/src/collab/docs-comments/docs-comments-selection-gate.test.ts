import { describe, expect, it } from "vitest";
import { shouldOfferCommentCompose } from "./docs-comments-selection-gate";

describe("shouldOfferCommentCompose", () => {
  it("returns false while the pointer is actively selecting", () => {
    expect(
      shouldOfferCommentCompose({
        isSelecting: true,
        anchorText: "selected text",
      }),
    ).toBe(false);
  });

  it("returns true after selection settles with anchor text", () => {
    expect(
      shouldOfferCommentCompose({
        isSelecting: false,
        anchorText: "selected text",
      }),
    ).toBe(true);
  });

  it("returns false for collapsed or whitespace-only selection", () => {
    expect(
      shouldOfferCommentCompose({
        isSelecting: false,
        anchorText: null,
      }),
    ).toBe(false);
  });
});
