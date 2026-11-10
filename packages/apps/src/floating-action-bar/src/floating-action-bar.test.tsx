import { render, within } from "@testing-library/react";
import { Star, Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { FloatingActionBar } from "@/floating-action-bar/src/floating-action-bar";

describe("FloatingActionBar", () => {
  it("uses cream surface, neutral ink hairline, and outline IconButtons", () => {
    const { container } = render(
      <TooltipProvider>
        <div style={{ ["--workspace-accent" as string]: "#10b981" }}>
          <FloatingActionBar
            items={2}
            buttons={[
              { label: "Star", icon: <Star />, onClick: vi.fn() },
              { label: "Delete", icon: <Trash2 />, onClick: vi.fn(), severity: "danger" },
              {
                label: "Done",
                icon: null,
                onClick: vi.fn(),
                separatorBefore: true,
                showLabel: true,
              },
            ]}
          />
        </div>
      </TooltipProvider>,
    );

    const bar = container.querySelector(".floating-action-bar");
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute("data-state")).toBe("open");
    expect(bar?.className).not.toMatch(/rounded-full/);
    expect(bar?.getAttribute("style")).toBeNull();

    const outlineButtons = container.querySelectorAll(
      ".floating-action-bar__actions .button--variant-outline",
    );
    // Done is outline too: its label spelled out, no icon.
    expect(outlineButtons.length).toBe(3);
    expect(
      container.querySelector(".floating-action-bar__actions .button--variant-selection"),
    ).toBeNull();
    const done = within(container as HTMLElement).getByRole("button", { name: "Done" });
    expect(done.querySelector(".button__label")?.textContent).toBe("Done");
    expect(done.querySelector("svg")).toBeNull();
    expect(
      container.querySelector(".floating-action-bar__actions .button--variant-ghost"),
    ).toBeNull();
    expect(
      container.querySelector(".floating-action-bar__actions .button--severity-danger"),
    ).toBeTruthy();
    expect(container.querySelector(".floating-action-bar__spacer")).toBeTruthy();

    // Compact count: check + number, with a separator before the actions.
    const count = container.querySelector(".floating-action-bar__count");
    expect(count?.querySelector("svg")).toBeTruthy();
    expect(within(count as HTMLElement).getByText("2 Items").className).toBe("sr-only");
    expect(count?.nextElementSibling?.className).toBe("floating-action-bar__spacer");
  });

  it("uses singular Item copy for one selection", () => {
    const { container } = render(
      <TooltipProvider>
        <FloatingActionBar items={1} buttons={[{ label: "Star", icon: <Star /> }]} />
      </TooltipProvider>,
    );
    expect(within(container as HTMLElement).getByText("1 Item").className).toBe("sr-only");
  });
});
