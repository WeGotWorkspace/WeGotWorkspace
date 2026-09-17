import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/ui/tooltip";
import { TagGroup } from "./tag";

function renderTagGroup(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("TagGroup inline add", () => {
  beforeEach(() => {
    cleanup();
  });

  it("opens an inline combobox and confirms a suggestion with Enter", () => {
    const onAddTag = vi.fn();
    renderTagGroup(
      <TagGroup
        tags={["ideas"]}
        readonly={false}
        suggestions={["ideas", "focus", "shipping"]}
        onAddTag={onAddTag}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const input = screen.getByRole("combobox", { name: "Add tag" });
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "fo" } });
    expect(screen.getByRole("option", { name: "focus" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAddTag).toHaveBeenCalledWith("focus");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("commits an existing suggestion by item id, not label", () => {
    const onAddTag = vi.fn();
    renderTagGroup(
      <TagGroup
        tags={[]}
        readonly={false}
        suggestions={[{ id: "group-friends", label: "Friends" }]}
        allowCreate={false}
        onAddTag={onAddTag}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Add tag" }), {
      target: { value: "Fri" },
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: "Friends" }));

    expect(onAddTag).toHaveBeenCalledWith("group-friends");
  });

  it("omits create-on-type when allowCreate is false", () => {
    const onAddTag = vi.fn();
    renderTagGroup(
      <TagGroup
        tags={[]}
        readonly={false}
        suggestions={["ideas"]}
        allowCreate={false}
        onAddTag={onAddTag}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const input = screen.getByRole("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: "brand-new" } });

    expect(screen.queryByRole("option", { name: "Create “brand-new”" })).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("creates a new tag from the typed string", () => {
    const onAddTag = vi.fn();
    renderTagGroup(
      <TagGroup tags={[]} readonly={false} suggestions={["ideas"]} onAddTag={onAddTag} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const input = screen.getByRole("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: "brand-new" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: "Create “brand-new”" }));

    expect(onAddTag).toHaveBeenCalledWith("brand-new");
  });

  it("closes on Escape without confirming", () => {
    const onAddTag = vi.fn();
    renderTagGroup(
      <TagGroup tags={[]} readonly={false} suggestions={["ideas"]} onAddTag={onAddTag} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Add tag" }), { key: "Escape" });

    expect(onAddTag).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("applies size=lg class on the group for larger tap targets", () => {
    const { container } = renderTagGroup(<TagGroup tags={["ideas"]} readonly size="lg" />);

    expect(container.querySelector(".tag-group--size-lg")).toBeTruthy();
    expect(container.querySelector(".tag--size-lg")).toBeTruthy();
  });

  it("computes the same typeface on the add-tag button and add-tag input", () => {
    const sheet = document.createElement("style");
    sheet.textContent = `
      .tag-group__add-button,
      .tag-group__input {
        font-family: "JetBrains Mono", monospace;
        font-size: 13px;
        font-weight: 500;
        line-height: 1;
        letter-spacing: normal;
      }
      input:not([type="button"]):not([type="submit"]):not([type="reset"]):not(.note-detail-view__title):not(.tag-group__input) {
        font-size: 16px !important;
        font-family: ui-sans-serif !important;
        font-weight: 400 !important;
      }
    `;
    document.head.appendChild(sheet);

    try {
      renderTagGroup(<TagGroup tags={[]} readonly={false} onAddTag={() => {}} size="lg" />);
      const button = screen.getByRole("button", { name: "Add tag" });
      const buttonStyle = getComputedStyle(button);

      fireEvent.click(button);
      const input = screen.getByRole("combobox", { name: "Add tag" });
      const inputStyle = getComputedStyle(input);

      expect(input.className).toContain("tag-group__input");
      expect(inputStyle.fontSize).toBe(buttonStyle.fontSize);
      expect(inputStyle.fontFamily).toBe(buttonStyle.fontFamily);
      expect(inputStyle.fontWeight).toBe(buttonStyle.fontWeight);
      expect(inputStyle.lineHeight).toBe(buttonStyle.lineHeight);
      expect(inputStyle.letterSpacing).toBe(buttonStyle.letterSpacing);
      expect(inputStyle.fontSize).toBe("13px");
      expect(inputStyle.fontWeight).toBe("500");
    } finally {
      sheet.remove();
    }
  });

  it("defaults to compact md density without size modifier classes", () => {
    const { container } = renderTagGroup(<TagGroup tags={["ideas"]} readonly />);

    expect(container.querySelector(".tag-group--size-lg")).toBeNull();
    expect(container.querySelector(".tag--size-lg")).toBeNull();
  });

  it("calls onRemoveTag when the remove control is clicked", () => {
    const onRemoveTag = vi.fn();
    renderTagGroup(
      <TagGroup tags={["ideas", "draft"]} readonly={false} onRemoveTag={onRemoveTag} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove tag ideas" }));

    expect(onRemoveTag).toHaveBeenCalledTimes(1);
    expect(onRemoveTag).toHaveBeenCalledWith("ideas");
  });

  it("activates the remove control with the keyboard", () => {
    const onRemoveTag = vi.fn();
    renderTagGroup(<TagGroup tags={["ideas"]} readonly={false} onRemoveTag={onRemoveTag} />);

    const remove = screen.getByRole("button", { name: "Remove tag ideas" });
    remove.focus();
    expect(document.activeElement).toBe(remove);
    fireEvent.keyDown(remove, { key: "Enter" });
    fireEvent.click(remove);

    expect(onRemoveTag).toHaveBeenCalledWith("ideas");
  });

  it("removes by item id and tints from --collection-row-color", () => {
    const onRemoveTag = vi.fn();
    const { container } = renderTagGroup(
      <TagGroup
        tags={[{ id: "group-friends", label: "Friends", collectionTint: "#6366f1" }]}
        readonly={false}
        onRemoveTag={onRemoveTag}
        removeAriaLabelFor={(label) => `Remove group ${label}`}
      />,
    );

    const chip = container.querySelector(".tag--collection-tint") as HTMLElement | null;
    expect(chip).toBeTruthy();
    expect(chip?.style.getPropertyValue("--collection-row-color")).toBe("#6366f1");
    fireEvent.click(screen.getByRole("button", { name: "Remove group Friends" }));
    expect(onRemoveTag).toHaveBeenCalledWith("group-friends");
  });
});
