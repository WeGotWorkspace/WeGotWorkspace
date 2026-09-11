import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Archive, Forward, Reply, Star, Trash2 } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { ActionBar, ACTION_BAR_MAX_INLINE_ACTIONS } from "./action-bar";

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
    expect(back.className).toContain("button--variant-outline");
  });

  it("defaults the back label to Back when none is provided", () => {
    renderBar(<ActionBar onBack={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Back" }).textContent).toContain("Back");
  });

  it("keeps all actions inline when count is at most three (no More menu)", () => {
    const { container } = renderBar(
      <ActionBar
        onBack={vi.fn()}
        backLabel="Inbox"
        rightActions={[
          { id: "reply", label: "Reply", icon: <Reply />, onClick: vi.fn() },
          { id: "forward", label: "Forward", icon: <Forward />, onClick: vi.fn() },
          { id: "star", label: "Star", icon: <Star />, onClick: vi.fn() },
        ]}
      />,
    );

    expect(ACTION_BAR_MAX_INLINE_ACTIONS).toBe(3);
    expect(container.querySelector(".action-bar__row")).toBeTruthy();
    expect(container.querySelector(".action-bar__menu")).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(
      within(container.querySelector(".action-bar__row")!).getAllByRole("button"),
    ).toHaveLength(3);
  });

  it("shows first three inline and overflow menu when count exceeds three", () => {
    const { container } = renderBar(
      <ActionBar
        onBack={vi.fn()}
        backLabel="Inbox"
        rightActions={[
          { id: "reply", label: "Reply", icon: <Reply />, onClick: vi.fn() },
          { id: "forward", label: "Forward", icon: <Forward />, onClick: vi.fn() },
          { id: "star", label: "Star", icon: <Star />, onClick: vi.fn() },
          { id: "archive", label: "Archive", icon: <Archive />, onClick: vi.fn() },
          { id: "trash", label: "Trash", icon: <Trash2 />, onClick: vi.fn() },
        ]}
      />,
    );

    const row = container.querySelector(".action-bar__row");
    expect(row).toBeTruthy();
    expect(within(row!).getAllByRole("button")).toHaveLength(3);
    expect(within(row!).getByRole("button", { name: "Reply" })).toBeTruthy();
    expect(within(row!).getByRole("button", { name: "Forward" })).toBeTruthy();
    expect(within(row!).getByRole("button", { name: "Star" })).toBeTruthy();
    expect(within(row!).queryByRole("button", { name: "Archive" })).toBeNull();

    expect(container.querySelector(".action-bar__menu")).toBeTruthy();
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
  });

  it("never renders a More menu when collapseActions is false", () => {
    const { container } = renderBar(
      <ActionBar
        collapseActions={false}
        rightActions={[
          { id: "a", label: "A", icon: <Reply />, onClick: vi.fn() },
          { id: "b", label: "B", icon: <Forward />, onClick: vi.fn() },
          { id: "c", label: "C", icon: <Star />, onClick: vi.fn() },
          { id: "d", label: "D", icon: <Archive />, onClick: vi.fn() },
        ]}
      />,
    );

    expect(container.querySelector(".action-bar__menu")).toBeNull();
    expect(
      within(container.querySelector(".action-bar__row")!).getAllByRole("button"),
    ).toHaveLength(4);
  });

  it("applies severity-danger wash to inline destructive IconButtons", () => {
    const { container } = renderBar(
      <ActionBar
        rightActions={[
          { id: "reply", label: "Reply", icon: <Reply />, onClick: vi.fn() },
          {
            id: "trash",
            label: "Delete",
            icon: <Trash2 />,
            onClick: vi.fn(),
            severity: "danger",
          },
        ]}
      />,
    );

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(deleteButton.className).toContain("button--severity-danger");
    expect(container.querySelector(".action-bar__row .button--severity-danger")).toBe(deleteButton);
  });

  it("pins the first right action before rightLeading when placement is after-first", () => {
    const { container } = renderBar(
      <ActionBar
        rightLeading={<span data-testid="leading-slot">Book</span>}
        rightLeadingPlacement="after-first"
        rightActions={[
          { id: "edit", label: "Edit", icon: <Reply />, onClick: vi.fn(), showLabel: true },
          { id: "download", label: "Download", icon: <Forward />, onClick: vi.fn() },
          { id: "delete", label: "Delete", icon: <Trash2 />, onClick: vi.fn() },
        ]}
      />,
    );

    const right = container.querySelector(".action-bar__right");
    expect(right).toBeTruthy();
    const children = Array.from(right!.children).map((child) => child.className);
    expect(children[0]).toContain("action-bar__row");
    expect(children[1]).toContain("action-bar__right-leading");
    expect(children[2]).toContain("action-bar__row");
    expect(
      within(right as HTMLElement)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Edit", "Download", "Delete"]);
    expect(screen.getByTestId("leading-slot")).toBeTruthy();
  });
});
