import { describe, expect, it } from "vitest";
import { DEFAULT_NOTEBOOK_COLOR, notebookDotColor } from "@/notes-core/src/notes-notebook-color";

describe("notebookDotColor", () => {
  it("uses the notebook calendarcolor when set", () => {
    expect(notebookDotColor({ color: "#0ea5e9" })).toBe("#0ea5e9");
  });

  it("falls back to the General teal when color is missing", () => {
    expect(notebookDotColor({ color: "" })).toBe(DEFAULT_NOTEBOOK_COLOR);
    expect(notebookDotColor({ color: null })).toBe(DEFAULT_NOTEBOOK_COLOR);
    expect(notebookDotColor()).toBe(DEFAULT_NOTEBOOK_COLOR);
  });
});
