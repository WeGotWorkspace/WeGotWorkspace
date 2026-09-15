/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Check } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { UserChip } from "./user-chip";

const here = dirname(fileURLToPath(import.meta.url));
const chipCss = readFileSync(join(here, "user-chip.css"), "utf8");

afterEach(() => {
  cleanup();
});

function renderChip(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("UserChip", () => {
  it("renders avatar mark, name, and optional status in the accessible name", () => {
    const { container } = renderChip(
      <UserChip
        label="Carol"
        statusLabel="Accepted"
        markIcon={<Check aria-hidden />}
        className="calendar-invitees-rsvp-tag--accepted"
      />,
    );
    expect(screen.getByText("Carol")).toBeTruthy();
    expect(screen.getByLabelText("Carol, Accepted")).toBeTruthy();
    expect(container.querySelector(".user-chip__mark")).toBeTruthy();
    expect(container.querySelector(".user-chip__remove")).toBeNull();
  });

  it("calls onRemove from the dismiss control", () => {
    const onRemove = vi.fn();
    renderChip(
      <UserChip label="Carol" removable onRemove={onRemove} removeAriaLabel="Remove participant" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove participant" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("applies shared ControlSize height modifiers", () => {
    const { container } = renderChip(<UserChip label="Carol" size="sm" />);
    expect(container.querySelector(".user-chip--size-sm")).toBeTruthy();
  });

  it("wires statusLabel into a tooltip on the chip body", async () => {
    const { container } = renderChip(
      <UserChip
        label="Carol"
        statusLabel="Accepted"
        className="calendar-invitees-rsvp-tag--accepted"
      />,
    );
    const chip = container.querySelector(".user-chip");
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("tabindex")).toBe("0");
    fireEvent.pointerMove(chip!);
    expect(await screen.findByRole("tooltip", { name: "Accepted" })).toBeTruthy();
  });

  it("uses input-style focus-visible border on the outer chip", () => {
    expect(chipCss).toMatch(
      /\.user-chip:focus-visible\s*\{[\s\S]*border-color:\s*var\(--input-border-focus/,
    );
  });
});
