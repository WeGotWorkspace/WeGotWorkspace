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

    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(onMainAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("hides the chevron when there are no menu items", () => {
    render(
      <SidebarSegmentedNewMenu
        mainLabel="New event"
        menuLabel="More create actions"
        onMainAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "New event" }).className).toMatch(/__main--solo/);
    expect(screen.queryByRole("button", { name: "More create actions" })).toBeNull();
  });
});
