import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkifiedTextarea } from "./linkified-textarea";

function Harness({ initial, onChange }: { initial: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <LinkifiedTextarea
      aria-label="Notes"
      placeholder="Add notes"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onChange?.(event.target.value);
      }}
    />
  );
}

afterEach(cleanup);

describe("LinkifiedTextarea", () => {
  it("shows links until the field is focused, value unchanged", () => {
    render(<Harness initial="Call https://meet.test/a now" />);
    const link = screen.getByRole("link", { name: "https://meet.test/a" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe(
      "Call https://meet.test/a now",
    );
  });

  it("does not start editing when a link is clicked", () => {
    render(<Harness initial="https://meet.test/a" />);
    const field = screen.getByLabelText("Notes");
    fireEvent.mouseDown(screen.getByRole("link"));
    expect(document.activeElement).not.toBe(field);
    expect(screen.queryByRole("link")).not.toBeNull();
  });

  it("clicking elsewhere in the field focuses the textarea with the caret at the end", () => {
    render(<Harness initial="see https://meet.test/a" />);
    const field = screen.getByLabelText("Notes") as HTMLTextAreaElement;
    const view = document.querySelector("[data-linkified-view]") as HTMLElement;
    fireEvent.mouseDown(view);
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(field.value.length);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("enters edit mode from the keyboard and returns to links on blur", () => {
    render(<Harness initial="see https://meet.test/a" />);
    const field = screen.getByLabelText("Notes");
    fireEvent.focus(field);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.blur(field);
    expect(screen.queryByRole("link")).not.toBeNull();
  });

  it("types as a plain textarea and shows the placeholder when empty", () => {
    const onChange = vi.fn();
    render(<Harness initial="" onChange={onChange} />);
    const field = screen.getByPlaceholderText("Add notes");
    expect(document.querySelector("[data-linkified-view]")).toBeNull();
    fireEvent.change(field, { target: { value: "hi" } });
    expect(onChange).toHaveBeenCalledWith("hi");
  });
});
