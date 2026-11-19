import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { collabSaveBody } from "./docs-collab-save-body";
import { TEXT_FIELDS_TITLE, seedTextFields } from "./docs-collab-text-fields";

describe("collabSaveBody, text-fields", () => {
  it("counts a title typed while the save was on its way as unsent", () => {
    const doc = new Y.Doc();
    seedTextFields(doc, { title: "Groceries", description: "Buy milk" }, null);
    const body = collabSaveBody(doc, {
      getMarkdownRef: { current: null },
      markdownOverrideRef: { current: null },
    });
    if (!body) throw new Error("expected a body");

    expect(body.editedSince("Buy milk", null)).toBe(false);
    doc.getText(TEXT_FIELDS_TITLE).insert(9, "!");
    expect(body.editedSince("Buy milk", null)).toBe(true);
  });
});
