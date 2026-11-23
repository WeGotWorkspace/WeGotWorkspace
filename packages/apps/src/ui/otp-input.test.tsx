import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OtpInput, type OtpInputProps } from "@/ui/otp-input";

function Harness({
  onSubmit,
  initial = "",
  ...rest
}: { onSubmit: (code: string) => void; initial?: string } & Partial<OtpInputProps>) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <OtpInput aria-label="Code" value={value} onChange={setValue} {...rest} />
    </form>
  );
}

const field = () => screen.getByLabelText("Code") as HTMLInputElement;
/** Keys one at a time, like a keyboard: each adds to what the field holds. */
function typeKeys(keys: string) {
  for (const key of keys) fireEvent.change(field(), { target: { value: field().value + key } });
}
function backspace() {
  fireEvent.change(field(), { target: { value: field().value.slice(0, -1) } });
}
const boxes = (container: HTMLElement) =>
  [...container.querySelectorAll(".otp-input__box")].map((box) => box.textContent);

describe("OtpInput", () => {
  it("keeps one real numeric one-time-code input and hides the boxes", () => {
    const { container } = render(<Harness onSubmit={vi.fn()} />);
    expect(field().getAttribute("inputmode")).toBe("numeric");
    expect(field().getAttribute("autocomplete")).toBe("one-time-code");
    expect(field().getAttribute("pattern")).toBe("[0-9]*");
    expect(field().maxLength).toBe(6);
    expect(container.querySelector(".otp-input__boxes")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("input")).toHaveLength(1);
  });

  it("draws typed digits into the boxes and ignores non-digits", () => {
    const { container } = render(<Harness onSubmit={vi.fn()} />);
    typeKeys("1a2-b3");
    expect(field().value).toBe("123");
    expect(boxes(container)).toEqual(["1", "2", "3", "", "", ""]);
  });

  it("goes back a box on Backspace", () => {
    const { container } = render(<Harness onSubmit={vi.fn()} />);
    typeKeys("123");
    backspace();
    expect(boxes(container)).toEqual(["1", "2", "", "", "", ""]);
    expect(container.querySelectorAll(".otp-input__box")[2]?.hasAttribute("data-active")).toBe(
      true,
    );
  });

  it("fills all six from a pasted 123 456 or 123456", () => {
    const onSubmit = vi.fn();
    const { container } = render(<Harness onSubmit={onSubmit} />);
    fireEvent.paste(field(), { clipboardData: { getData: () => "123 456" } });
    expect(boxes(container)).toEqual(["1", "2", "3", "4", "5", "6"]);
    fireEvent.paste(field(), { clipboardData: { getData: () => "654321" } });
    expect(boxes(container)).toEqual(["6", "5", "4", "3", "2", "1"]);
  });

  it("submits once on the sixth digit, not before and not again", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    typeKeys("12345");
    expect(onSubmit).not.toHaveBeenCalled();
    typeKeys("6");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("123456");
    typeKeys("7");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits again after the code was cleared and completed anew", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    typeKeys("123456");
    fireEvent.change(field(), { target: { value: "" } });
    typeKeys("654321");
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("does not submit while disabled", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} initial="123456" disabled />);
    expect(field().disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("marks the boxes invalid, clears them and focuses the field on a wrong code", () => {
    const onSubmit = vi.fn();
    const { container, rerender } = render(
      <Harness onSubmit={onSubmit} initial="123456" disabled />,
    );
    rerender(<Harness onSubmit={onSubmit} initial="123456" disabled invalid />);
    rerender(<Harness onSubmit={onSubmit} initial="123456" invalid />);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("[data-invalid]")).not.toBeNull();
    expect(field().value).toBe("");
    expect(document.activeElement).toBe(field());
  });
});
