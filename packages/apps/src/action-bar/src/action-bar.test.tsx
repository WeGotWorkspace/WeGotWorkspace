import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Archive, Reply } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { ActionBar } from "./action-bar";

afterEach(() => {
  cleanup();
});

function renderBar(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("ActionBar", () => {
  it("shows a truncated visible back label for the list name", () => {
    renderBar(<ActionBar onBack={vi.fn()} backLabel="All Items" />);

    const back = screen.getByRole("button", { name: "All Items" });
    expect(back.textContent).toContain("All Items");
    expect(back.className).toContain("action-bar__back");
  });

  it("defaults the back label to Back when none is provided", () => {
    renderBar(<ActionBar onBack={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Back" }).textContent).toContain("Back");
  });

  it("renders overflow menu markup alongside the inline action row", () => {
    const { container } = renderBar(
      <ActionBar
        onBack={vi.fn()}
        backLabel="Inbox"
        leftActions={[{ id: "reply", label: "Reply", icon: <Reply />, onClick: vi.fn() }]}
        rightActions={[{ id: "archive", label: "Archive", icon: <Archive />, onClick: vi.fn() }]}
      />,
    );

    expect(container.querySelector(".action-bar__row")).toBeTruthy();
    expect(container.querySelector(".action-bar__menu")).toBeTruthy();
  });
});
