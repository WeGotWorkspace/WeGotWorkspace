import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionSearchInput } from "@/collection-search-input/src/collection-search-input";

describe("CollectionSearchInput", () => {
  it("uses the shared Input search variant at toolbar size", () => {
    const { container } = render(
      <CollectionSearchInput value="" onChange={() => {}} placeholder="Search…" />,
    );
    const root = container.querySelector(".collection-search-input");
    expect(root).not.toBeNull();
    expect(root!.classList.contains("input--search")).toBe(true);
    expect(root!.classList.contains("input--size-sm")).toBe(true);
    expect(container.querySelector(".input__search-icon")).not.toBeNull();
  });

  it("clears on the shared clear control and on Escape", () => {
    const onChange = vi.fn();
    render(<CollectionSearchInput value="sprint" onChange={onChange} placeholder="Search…" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
    onChange.mockClear();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith("");
  });
});
