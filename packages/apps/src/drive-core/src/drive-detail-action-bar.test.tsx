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

function renderActionBar() {
  const actions = buildActions();

  return render(
    <TooltipProvider>
      <div className="drive-workspace">
        <div className="drive-detail-panel">
          <DriveDetailActionBar actions={actions} />
        </div>
      </div>
    </TooltipProvider>,
  );
}

describe("DriveDetailActionBar", () => {
  it("puts every file action behind a single More menu", () => {
    const actions = buildActions();
    expect(actions.length).toBeGreaterThan(1);

    const { container } = renderActionBar();
    expect(container.querySelector(".action-bar")).toBeNull();
    const group = container.querySelector(".drive-detail-panel__actions")!;
    expect(group).toBeTruthy();
    // Only the ⋯ trigger — Download/Star/Edit/… live in the menu.
    expect(within(group as HTMLElement).getAllByRole("button")).toHaveLength(1);
    expect(
      within(container as HTMLElement).getByRole("button", { name: "More actions" }),
    ).toBeTruthy();
    expect(within(container as HTMLElement).queryByRole("button", { name: "Download" })).toBeNull();
    expect(within(container as HTMLElement).queryByRole("button", { name: "Star" })).toBeNull();
  });

  it("does not own close — DocsCollabSidebarPanel titleTrailing does", () => {
    const { container } = renderActionBar();
    expect(within(container as HTMLElement).queryByRole("button", { name: "Close" })).toBeNull();
  });
});
