import { render, within } from "@testing-library/react";
import { Code2, Printer } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { DocsHeaderActions } from "./docs-header-actions";

function renderHeaderActions() {
  return render(
    <TooltipProvider>
      <div className="docs-workspace">
        <DocsHeaderActions
          actions={[
            {
              id: "view-source",
              label: "View source",
              icon: <Code2 />,
              onClick: vi.fn(),
            },
            {
              id: "print",
              label: "Print",
              icon: <Printer />,
              onClick: vi.fn(),
            },
          ]}
        />
      </div>
    </TooltipProvider>,
  );
}

describe("DocsHeaderActions", () => {
  it("uses outline IconButtons for header chrome, not filled subtle", () => {
    const { container } = renderHeaderActions();
    const buttons = container.querySelectorAll(
      ".docs-workspace__header-actions-row .button--variant-outline",
    );
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    expect(
      container.querySelector(".docs-workspace__header-actions-row .button--variant-subtle"),
    ).toBeNull();
  });

  it("renders overflow menu trigger for compact header actions", () => {
    const { container } = renderHeaderActions();
    expect(container.querySelector(".docs-workspace__header-actions-menu")).toBeTruthy();
    expect(
      within(container as HTMLElement).getByRole("button", { name: "More actions" }),
    ).toBeTruthy();
    expect(
      container.querySelector(
        ".docs-workspace__header-actions-menu-trigger.button--variant-outline",
      ),
    ).toBeTruthy();
  });

  it("keeps inline action buttons in the row container", () => {
    const { container } = renderHeaderActions();
    const row = container.querySelector(".docs-workspace__header-actions-row");
    expect(row?.querySelectorAll("button")).toHaveLength(2);
  });
});
