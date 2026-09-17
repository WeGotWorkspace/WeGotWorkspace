import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotesNotebookColorIcon } from "@/notes-core/src/notes-notebook-color-icon";

describe("NotesNotebookColorIcon", () => {
  it("renders a decorative notebook glyph, not a rounded swatch", () => {
    const { container } = render(<NotesNotebookColorIcon />);
    const icon = container.querySelector(".notes-notebook-color-icon");
    expect(icon).toBeTruthy();
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(icon?.getAttribute("class") ?? "").not.toMatch(/rounded-full/);
    expect(container.querySelector(".collection-sidebar-row__dot")).toBeNull();
  });
});
