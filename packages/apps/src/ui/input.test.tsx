import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

describe("Input", () => {
  it("defaults to the md control size", () => {
    const { container } = render(<Input aria-label="Name" />);
    const field = container.querySelector(".input");
    expect(field).not.toBeNull();
    expect(field!.classList.contains("input--size-md")).toBe(true);
    expect(field!.classList.contains("input--search")).toBe(false);
  });

  it("applies the sm size class for tighter fields", () => {
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
      screen.getByRole("textbox", { name: "md input" }).classList.contains("input--size-md"),
    ).toBe(true);
    expect(
      screen
        .getByRole("combobox", { name: "md select" })
        .classList.contains("select-trigger--size-md"),
    ).toBe(true);
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

  it("renders a password field with a show/hide toggle", () => {
    const { container } = render(
      <Input
        variant="password"
        id="account-password"
        name="password"
        autoComplete="new-password"
        placeholder="At least 10 characters"
        aria-label="Password"
      />,
    );
    const wrapper = container.querySelector(".input--password");
    const field = container.querySelector("input");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.classList.contains("input--size-md")).toBe(true);
    expect(field).not.toBeNull();
    expect(field!.getAttribute("type")).toBe("password");
    expect(field!.getAttribute("id")).toBe("account-password");
    expect(field!.getAttribute("name")).toBe("password");
    expect(field!.getAttribute("autocomplete")).toBe("new-password");
    expect(field!.getAttribute("placeholder")).toBe("At least 10 characters");
    expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();
  });

  it("toggles password visibility without dropping the typed value", () => {
    render(<Input variant="password" defaultValue="hunter2hunter" aria-label="Password" />);
    const field = screen.getByLabelText("Password") as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(field.type).toBe("text");
    expect(field.value).toBe("hunter2hunter");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(field.type).toBe("password");
    expect(field.value).toBe("hunter2hunter");
  });

  it("treats type=password as the password variant", () => {
    const { container } = render(<Input type="password" aria-label="Password" />);
    expect(container.querySelector(".input--password")).not.toBeNull();
    expect(container.querySelector("input")!.getAttribute("type")).toBe("password");
  });

  it("disables the visibility toggle when the password field is disabled", () => {
    render(<Input variant="password" aria-label="Password" disabled />);
    expect(
      (screen.getByRole("button", { name: "Show password" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
