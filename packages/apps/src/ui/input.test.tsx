import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Input } from "@/ui/input";

describe("Input", () => {
  it("defaults to the md control size", () => {
    const { container } = render(<Input aria-label="Name" />);
    const field = container.querySelector(".input");
    expect(field).not.toBeNull();
    expect(field!.classList.contains("input--size-sm")).toBe(false);
    expect(field!.classList.contains("input--search")).toBe(false);
  });

  it("applies the compact size class for toolbar clusters", () => {
    const { container } = render(<Input aria-label="Name" size="sm" />);
    const field = container.querySelector(".input");
    expect(field).not.toBeNull();
    expect(field!.classList.contains("input--size-sm")).toBe(true);
  });

  it("renders a leading search icon and no clear button when empty", () => {
    const { container } = render(
      <Input variant="search" size="sm" value="" onChange={() => {}} aria-label="Search" />,
    );
    expect(container.querySelector(".input--search")).not.toBeNull();
    expect(container.querySelector(".input__search-icon")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("shows a clear button when the search variant has a value", () => {
    const onChange = vi.fn();
    render(
      <Input variant="search" size="sm" value="standup" onChange={onChange} aria-label="Search" />,
    );
    const clear = screen.getByRole("button", { name: "Clear search" });
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]?.target).toMatchObject({ value: "" });
  });
});
