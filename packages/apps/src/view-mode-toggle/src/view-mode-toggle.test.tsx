import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/ui/tooltip";
import { ViewModeToggle } from "@/view-mode-toggle/src/view-mode-toggle";

function renderToggle(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("ViewModeToggle", () => {
  it("defaults to md so action-bar chrome matches SelectTrigger / IconButton (36px)", () => {
    const { container } = renderToggle(
      <ViewModeToggle
        value="grid"
        onChange={vi.fn()}
        gridLabel="Calendar view"
        listLabel="List view"
      />,
    );
    const root = container.querySelector(".segmented-control");
    expect(root).not.toBeNull();
    expect(root!.classList.contains("segmented-control--size-md")).toBe(true);
    expect(root!.classList.contains("segmented-control--size-sm")).toBe(false);
    expect(screen.getByRole("button", { name: "Calendar view" })).toBeTruthy();
  });

  it("forwards an explicit sm size when compact chrome is requested", () => {
    const { container } = renderToggle(
      <ViewModeToggle
        value="list"
        onChange={vi.fn()}
        gridLabel="Grid"
        listLabel="List"
        size="sm"
      />,
    );
    expect(
      container
        .querySelector(".segmented-control")!
        .classList.contains("segmented-control--size-sm"),
    ).toBe(true);
  });
});
