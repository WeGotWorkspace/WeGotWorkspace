import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

const inputCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "input.css"), "utf8");

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

  it("pairs Input and Select at the same size", () => {
    render(
      <>
        <Input size="sm" aria-label="sm input" defaultValue="sm" />
        <Select defaultValue="option">
          <SelectTrigger size="sm" aria-label="sm select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="option">sm</SelectItem>
          </SelectContent>
        </Select>
        <Input aria-label="md input" defaultValue="md" />
        <Select defaultValue="option">
          <SelectTrigger aria-label="md select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="option">md</SelectItem>
          </SelectContent>
        </Select>
      </>,
    );

    expect(
      screen.getByRole("textbox", { name: "sm input" }).classList.contains("input--size-sm"),
    ).toBe(true);
    expect(
      screen
        .getByRole("combobox", { name: "sm select" })
        .classList.contains("select-trigger--size-sm"),
    ).toBe(true);
    expect(
      screen.getByRole("textbox", { name: "md input" }).classList.contains("input--size-sm"),
    ).toBe(false);
    expect(
      screen
        .getByRole("combobox", { name: "md select" })
        .classList.contains("select-trigger--size-sm"),
    ).toBe(false);
  });

  it("does not set pill radius on the sm size class", () => {
    const smBlock = inputCss.match(
      /\.select-trigger--size-sm,\s*\.input--size-sm \{[\s\S]*?\n\}/,
    )?.[0];
    expect(smBlock).toBeDefined();
    expect(smBlock).not.toMatch(/control-radius-button-pill/);
    expect(smBlock).toMatch(/min-height:/);
    expect(smBlock).toMatch(/font-size:/);
    expect(inputCss).toMatch(
      /\.control-surface,\s*\.input,\s*\.textarea,\s*\.select-trigger \{[\s\S]*border-radius:\s*var\(--control-radius\)/,
    );
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
