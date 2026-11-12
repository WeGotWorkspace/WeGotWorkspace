/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DropdownMenu, type DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";

beforeAll(() => {
  // Radix positions the menu with these; jsdom has none of them.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

afterEach(() => {
  cleanup();
});

function renderMenu(onA4 = vi.fn()) {
  const items: DropdownMenuEntry[] = [
    { label: "Print", onClick: vi.fn() },
    {
      type: "submenu",
      id: "page-setup",
      label: "Page setup",
      hint: "Letter",
      items: [
        { label: "A4", onClick: onA4 },
        { type: "separator" },
        { label: "Landscape", onClick: vi.fn() },
      ],
    },
  ];
  render(<DropdownMenu trigger={<button type="button">More</button>} items={items} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
  return onA4;
}

const row = (name: RegExp) => screen.getByRole("menuitem", { name });

describe("DropdownMenu submenu", () => {
  it("shows the row with its current value and no popup claim", () => {
    renderMenu();
    const pageSetup = row(/Page setup/);
    expect(pageSetup.textContent).toContain("Letter");
    expect(pageSetup.hasAttribute("aria-haspopup")).toBe(false);
  });

  it("swaps the list in place, with a back row that has focus", () => {
    renderMenu();
    fireEvent.click(row(/Page setup/));
    expect(screen.queryByRole("menuitem", { name: /Print/ })).toBeNull();
    expect(row(/A4/)).toBeTruthy();
    expect(row(/Landscape/)).toBeTruthy();
    expect(document.activeElement).toBe(row(/Page setup/));
  });

  it("goes back to the list and returns focus to the row that opened it", () => {
    renderMenu();
    fireEvent.click(row(/Page setup/));
    fireEvent.click(row(/Page setup/));
    expect(row(/Print/)).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /A4/ })).toBeNull();
    expect(document.activeElement).toBe(row(/Page setup/));
  });

  it("chooses an entry and closes", () => {
    const onA4 = renderMenu();
    fireEvent.click(row(/Page setup/));
    fireEvent.click(row(/A4/));
    expect(onA4).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and opens on the main list next time", () => {
    renderMenu();
    fireEvent.click(row(/Page setup/));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
    expect(row(/Print/)).toBeTruthy();
  });

  it("reports the menu closed when it unmounts while open", () => {
    const onOpenChange = vi.fn();
    const { unmount } = render(
      <DropdownMenu
        trigger={<button type="button">More</button>}
        items={[{ label: "Print", onClick: vi.fn() }]}
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("reports nothing on unmount when the menu was closed", () => {
    const onOpenChange = vi.fn();
    const { unmount } = render(
      <DropdownMenu
        trigger={<button type="button">More</button>}
        items={[{ label: "Print", onClick: vi.fn() }]}
        onOpenChange={onOpenChange}
      />,
    );
    unmount();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
