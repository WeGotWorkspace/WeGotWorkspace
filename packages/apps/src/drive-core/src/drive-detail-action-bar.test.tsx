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

function renderActionBar(options?: { mobile?: boolean; containerWidth?: string }) {
  const actions = buildActions();

  return render(
    <TooltipProvider>
      <div className="drive-workspace">
        <div style={options?.containerWidth ? { width: options.containerWidth } : undefined}>
          <DriveDetailActionBar actions={actions} onClose={vi.fn()} mobile={options?.mobile} />
        </div>
      </div>
    </TooltipProvider>,
  );
}

describe("DriveDetailActionBar", () => {
  it("relies on ActionBar container queries instead of forcing expanded desktop layout", () => {
    const { container } = renderActionBar();
    const bar = container.querySelector(".action-bar");
    expect(bar?.classList.contains("action-bar--expanded")).toBe(false);
    expect(container.querySelector(".action-bar__menu")).toBeTruthy();
  });

  it("keeps the close control outside the overflow menu on desktop aside", () => {
    const { container } = renderActionBar();
    expect(within(container as HTMLElement).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(container as HTMLElement).queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("uses stacked mobile chrome while still allowing container-query collapse", () => {
    const { container } = renderActionBar({ mobile: true });
    const bar = container.querySelector(".action-bar");
    expect(bar?.classList.contains("action-bar--expanded")).toBe(false);
    expect(container.querySelector(".action-bar__menu")).toBeTruthy();
    const back = within(container as HTMLElement).getByRole("button", { name: "Back" });
    expect(back.className).toContain("button--variant-outline");
  });

  it("renders overflow menu markup for narrow detail containers", () => {
    const { container } = renderActionBar({ containerWidth: "20rem" });
    expect(container.querySelector(".action-bar__menu")).toBeTruthy();
    expect(
      within(container as HTMLElement).getByRole("button", { name: "More actions" }),
    ).toBeTruthy();
  });
});
