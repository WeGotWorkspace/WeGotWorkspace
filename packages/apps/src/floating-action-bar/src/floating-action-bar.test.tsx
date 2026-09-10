import { render, within } from "@testing-library/react";
import { CheckCircle2, Star, Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { FloatingActionBar } from "@/floating-action-bar/src/floating-action-bar";

describe("FloatingActionBar", () => {
  it("uses light BEM chrome and outline IconButtons, not dark pill glyphs", () => {
    const { container } = render(
      <TooltipProvider>
        <div style={{ ["--workspace-accent" as string]: "#10b981" }}>
          <FloatingActionBar
            items={2}
            buttons={[
              { label: "Star", icon: <Star />, onClick: vi.fn() },
              { label: "Delete", icon: <Trash2 />, onClick: vi.fn() },
              { label: "Done", icon: <CheckCircle2 />, onClick: vi.fn() },
            ]}
          />
        </div>
      </TooltipProvider>,
    );

    const bar = container.querySelector(".floating-action-bar");
    expect(bar).toBeTruthy();
    expect(bar?.className).not.toMatch(/rounded-full/);
    expect(bar?.getAttribute("style")).toBeNull();

    const outlineButtons = container.querySelectorAll(
      ".floating-action-bar__actions .button--variant-outline",
    );
    expect(outlineButtons.length).toBe(3);
    expect(
      container.querySelector(".floating-action-bar__actions .button--variant-ghost"),
    ).toBeNull();

    expect(within(container as HTMLElement).getByText("2 selected")).toBeTruthy();
  });
});
