import { render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CheckCircle2, Star, Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { FloatingActionBar } from "@/floating-action-bar/src/floating-action-bar";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "floating-action-bar.css"), "utf8");

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
                icon: <CheckCircle2 />,
                onClick: vi.fn(),
                separatorBefore: true,
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
    expect(outlineButtons.length).toBe(3);
    expect(
      container.querySelector(".floating-action-bar__actions .button--variant-ghost"),
    ).toBeNull();
    expect(
      container.querySelector(".floating-action-bar__actions .button--severity-danger"),
    ).toBeTruthy();
    expect(container.querySelector(".floating-action-bar__spacer")).toBeTruthy();

    expect(within(container as HTMLElement).getByText("2 Items")).toBeTruthy();
  });

  it("uses singular Item copy for one selection", () => {
    const { container } = render(
      <TooltipProvider>
        <FloatingActionBar items={1} buttons={[{ label: "Star", icon: <Star /> }]} />
      </TooltipProvider>,
    );
    expect(within(container as HTMLElement).getByText("1 Item")).toBeTruthy();
  });

  it("keeps bar chrome neutral (cream bg, ink border) with slide presence", () => {
    expect(css).toMatch(/background-color:\s*var\(--color-cream,\s*#ffffff\)/);
    expect(css).toMatch(
      /border:\s*1px solid color-mix\(in oklab,\s*var\(--color-ink\)\s*12%,\s*transparent\)/,
    );
    expect(css).not.toMatch(/floating-action-bar-accent.*14%/);
    expect(css).toMatch(/font-semibold/);
    expect(css).toMatch(/\[data-state="closed"\]/);
    expect(css).toMatch(/@starting-style/);
  });
});
