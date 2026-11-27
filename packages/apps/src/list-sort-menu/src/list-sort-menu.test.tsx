import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/ui/tooltip";
import { ListSortMenu } from "@/list-sort-menu/src/list-sort-menu";

const options = [
  { key: "date", label: "Date", ascendingLabel: "Oldest first", descendingLabel: "Newest first" },
  { key: "title", label: "Title", ascendingLabel: "A to Z", descendingLabel: "Z to A" },
] as const;
const first = { date: "desc", title: "asc" } as const;
const labels = { menu: "Sort", sortBy: "Sort by", order: "Order" };

function setup(sort: { key: "date" | "title"; direction: "asc" | "desc" }) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <ListSortMenu
        options={options}
        sort={sort}
        onChange={onChange}
        labels={labels}
        firstDirection={first}
      />
    </TooltipProvider>,
  );
  return onChange;
}

function openMenu() {
  const trigger = screen.getByRole("button", { name: "Sort" });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

describe("ListSortMenu", () => {
  afterEach(cleanup);

  it("picking another key starts it in its natural direction", () => {
    const onChange = setup({ key: "date", direction: "asc" });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Title" }));
    expect(onChange).toHaveBeenCalledWith({ key: "title", direction: "asc" });
  });

  it("names the directions after the chosen key", () => {
    setup({ key: "title", direction: "asc" });
    openMenu();
    expect(screen.getByText("A to Z")).toBeTruthy();
    expect(screen.getByText("Z to A")).toBeTruthy();
    expect(screen.queryByText("Newest first")).toBeNull();
  });

  it("flips the direction and keeps the key", () => {
    const onChange = setup({ key: "date", direction: "desc" });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Oldest first" }));
    expect(onChange).toHaveBeenCalledWith({ key: "date", direction: "asc" });
  });

  it("does nothing when the current choice is picked again", () => {
    const onChange = setup({ key: "date", direction: "desc" });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Newest first" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
