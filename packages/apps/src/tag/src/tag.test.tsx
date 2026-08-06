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

  it("defaults to compact md density without size modifier classes", () => {
    const { container } = renderTagGroup(<TagGroup tags={["ideas"]} readonly />);

    expect(container.querySelector(".tag-group--size-lg")).toBeNull();
    expect(container.querySelector(".tag--size-lg")).toBeNull();
  });
});
