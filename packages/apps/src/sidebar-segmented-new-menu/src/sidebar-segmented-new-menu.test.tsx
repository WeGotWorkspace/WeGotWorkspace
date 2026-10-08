import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";

describe("SidebarSegmentedNewMenu", () => {
  beforeEach(() => {
    cleanup();
  });

  it("runs the main action without opening the menu", () => {
    const onMainAction = vi.fn();
    render(
      <SidebarSegmentedNewMenu
        mainLabel="New task"
        menuLabel="More create actions"
        onMainAction={onMainAction}
        items={[{ id: "add-list", label: "Add list", onClick: vi.fn() }]}
      />,
    );

    const main = screen.getByRole("button", { name: "New task" });
    fireEvent.click(main);
    expect(onMainAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(main.className).toMatch(/button--size-md/);
    expect(main.closest(".sidebar-segmented-new-menu")?.className).not.toMatch(/--stretch/);
  });

  it("hides the chevron when there are no menu items", () => {
    render(
      <SidebarSegmentedNewMenu
        mainLabel="New event"
        menuLabel="More create actions"
        onMainAction={vi.fn()}
      />,
    );
    const main = screen.getByRole("button", { name: "New event" });
    expect(main.className).not.toMatch(/__main--solo/);
    expect(main.className).not.toMatch(/__main--stretch/);
    expect(screen.queryByRole("button", { name: "More create actions" })).toBeNull();
  });

  it("accepts a custom icon and stretch=false without dead size modifiers", () => {
    render(
      <SidebarSegmentedNewMenu
        mainLabel="Meet"
        menuLabel="More call options"
        icon={<span data-testid="custom-icon" />}
        size="md"
        stretch={false}
        onMainAction={vi.fn()}
        items={[{ id: "audio", label: "Meet (Audio Only)", onClick: vi.fn() }]}
      />,
    );
    const main = screen.getByRole("button", { name: "Meet" });
    const root = main.closest(".sidebar-segmented-new-menu");
    expect(root?.className).not.toMatch(/--sm/);
    expect(root?.className).not.toMatch(/--stretch/);
    expect(main.className).toMatch(/button--size-md/);
    expect(screen.getByTestId("custom-icon")).toBeTruthy();
  });
});
