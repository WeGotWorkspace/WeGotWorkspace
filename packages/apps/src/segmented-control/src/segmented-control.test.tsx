import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "@/segmented-control/src/segmented-control";

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
});
