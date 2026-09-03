import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BooleanSegmentedControl,
  SegmentedControl,
} from "@/segmented-control/src/segmented-control";

const options = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
] as const;

describe("SegmentedControl", () => {
  it("defaults to compact size without the md modifier", () => {
    const { container } = render(
      <SegmentedControl value="grid" onChange={vi.fn()} options={[...options]} />,
    );
    const root = container.querySelector(".segmented-control");
    expect(root).not.toBeNull();
    expect(root!.classList.contains("segmented-control--size-md")).toBe(false);
  });

  it("applies the md size modifier when requested", () => {
    const { container } = render(
      <SegmentedControl value="grid" onChange={vi.fn()} options={[...options]} size="md" />,
    );
    const root = container.querySelector(".segmented-control");
    expect(root).not.toBeNull();
    expect(root!.classList.contains("segmented-control--size-md")).toBe(true);
  });

  it("disables segment buttons when disabled", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SegmentedControl value="grid" onChange={onChange} options={[...options]} disabled />,
    );
    const root = container.querySelector(".segmented-control");
    const buttons = container.querySelectorAll("button");
    expect(root?.getAttribute("aria-disabled")).toBe("true");
    expect(root?.hasAttribute("data-disabled")).toBe(true);
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => expect(button.disabled).toBe(true));
  });

  it("renders a compact switch for boolean on/off", () => {
    const onChange = vi.fn();
    render(<BooleanSegmentedControl value={false} onChange={onChange} aria-label="Feature" />);
    const control = screen.getByRole("switch", { name: "Feature" });
    expect(control.classList.contains("switch")).toBe(true);
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
