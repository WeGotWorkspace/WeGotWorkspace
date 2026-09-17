import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTEBOOK_COLOR,
  notebookContrastFg,
  notebookDisplayColor,
  notebookDotColor,
  notesDetailTintStyle,
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

  it("uses the group collection color when the note stores the collection id as the name", () => {
    const group = [{ id: "group-administrators", name: "Administratorss", color: "#ea8c72" }];
    expect(
      notebookDisplayColor(
        { notebook: "group-administrators", notebookId: "group-administrators" },
        group,
      ),
    ).toBe("#ea8c72");
    expect(notebookDisplayColor({ notebook: "group-administrators" }, group)).toBe("#ea8c72");
  });
});

describe("notebookContrastFg", () => {
  it("uses ink on a light notebook fill", () => {
    expect(notebookContrastFg("#fde68a")).toBe("var(--color-ink)");
    expect(notebookContrastFg("#d4bc72")).toBe("var(--color-ink)");
  });

  it("uses cream on a dark notebook fill", () => {
    expect(notebookContrastFg("#1e3a5f")).toBe("var(--color-cream)");
    expect(notebookContrastFg("#042a22")).toBe("var(--color-cream)");
  });

  it("falls back to ink when the hex is missing", () => {
    expect(notebookContrastFg("")).toBe("var(--color-ink)");
  });
});

describe("notesDetailTintStyle", () => {
  it("binds the notebook hex and check-mark contrast, not full-ink sheet text", () => {
    expect(notesDetailTintStyle(undefined)).toBeUndefined();
    expect(notesDetailTintStyle("#fde68a")).toEqual({
      ["--notes-detail-tint"]: "#fde68a",
      ["--notes-detail-check-fg"]: "var(--color-ink)",
    });
    expect(notesDetailTintStyle("#1e3a5f")).toEqual({
      ["--notes-detail-tint"]: "#1e3a5f",
      ["--notes-detail-check-fg"]: "var(--color-cream)",
    });
    expect(notesDetailTintStyle("#fde68a")).not.toHaveProperty("--notes-detail-contrast-fg");
  });
});
