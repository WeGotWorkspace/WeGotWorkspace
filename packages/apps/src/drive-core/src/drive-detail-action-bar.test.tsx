import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { DriveDetailActionBar } from "./drive-detail-action-bar";
import { buildDriveFileActions } from "./drive-file-action-builders";
import { driveLabels } from "./drive-labels";

function buildActions() {
  return buildDriveFileActions(
    driveLabels,
    { isStarred: false, inTrash: false, canDownload: true },
    {
      onDownload: vi.fn(),
      onStar: vi.fn(),
      onRename: vi.fn(),
      onMove: vi.fn(),
      onDelete: vi.fn(),
    },
  );
}

function renderActionBar(options?: { mobile?: boolean }) {
  const actions = buildActions();

  return render(
    <TooltipProvider>
      <div className="drive-workspace">
        <DriveDetailActionBar actions={actions} onClose={vi.fn()} mobile={options?.mobile} />
      </div>
    </TooltipProvider>,
  );
}

describe("DriveDetailActionBar", () => {
  it("overflows into More when there are more than three file actions", () => {
    const actions = buildActions();
    expect(actions.length).toBeGreaterThan(3);

    const { container } = renderActionBar();
    const bar = container.querySelector(".action-bar");
    expect(bar?.classList.contains("action-bar--expanded")).toBe(false);
    expect(container.querySelector(".action-bar__menu")).toBeTruthy();
    expect(
      within(container as HTMLElement).getByRole("button", { name: "More actions" }),
    ).toBeTruthy();
    expect(
      within(container.querySelector(".action-bar__row")!).getAllByRole("button"),
    ).toHaveLength(3);
  });

  it("keeps the close control outside the overflow menu on desktop aside", () => {
    const { container } = renderActionBar();
    expect(within(container as HTMLElement).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(container as HTMLElement).queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("uses stacked mobile chrome while still counting overflow by action count", () => {
    const { container } = renderActionBar({ mobile: true });
    const bar = container.querySelector(".action-bar");
    expect(bar?.classList.contains("action-bar--expanded")).toBe(false);
    expect(container.querySelector(".action-bar__menu")).toBeTruthy();
    const back = within(container as HTMLElement).getByRole("button", { name: "Back" });
    expect(back.className).toContain("button--variant-outline");
  });
});
