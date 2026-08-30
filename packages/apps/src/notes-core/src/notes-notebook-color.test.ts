import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTEBOOK_COLOR,
  notebookDisplayColor,
  notebookDotColor,
} from "@/notes-core/src/notes-notebook-color";

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

describe("notebookDisplayColor", () => {
  const collections = [
    { id: "notes-drafts", name: "Journal", color: "#0ea5e9" },
    { id: "notes-work", name: "Work", color: "#8b5cf6" },
    { id: "notes-plain", name: "Plain", color: null },
  ];

  it("prefers the live collection color by id over a stale notebook name", () => {
    expect(
      notebookDisplayColor({ notebook: "Drafts", notebookId: "notes-drafts" }, collections),
    ).toBe("#0ea5e9");
  });

  it("falls back to name when id is missing", () => {
    expect(notebookDisplayColor({ notebook: "Work" }, collections)).toBe("#8b5cf6");
  });

  it("uses the General teal when the matched collection has no color", () => {
    expect(
      notebookDisplayColor({ notebook: "Plain", notebookId: "notes-plain" }, collections),
    ).toBe(DEFAULT_NOTEBOOK_COLOR);
  });

  it("returns undefined when no collection matches (empty detail stays cream)", () => {
    expect(
      notebookDisplayColor({ notebook: "Gone", notebookId: "missing" }, collections),
    ).toBeUndefined();
    expect(notebookDisplayColor({ notebook: "Gone" }, [])).toBeUndefined();
  });
});
