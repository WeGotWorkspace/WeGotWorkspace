import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Select, SelectTrigger, SelectValue } from "@/ui/select";

describe("SelectTrigger", () => {
  it("defaults to the md control size", () => {
    const { container } = render(
      <Select>
        <SelectTrigger aria-label="View">
          <SelectValue placeholder="Month" />
        </SelectTrigger>
      </Select>,
    );
    const trigger = container.querySelector(".select-trigger");
    expect(trigger).not.toBeNull();
    expect(trigger!.classList.contains("select-trigger--size-sm")).toBe(false);
  });

  it("applies the compact size class for toolbar clusters", () => {
    const { container } = render(
      <Select>
        <SelectTrigger size="sm" aria-label="View">
          <SelectValue placeholder="Month" />
        </SelectTrigger>
      </Select>,
    );
    const trigger = container.querySelector(".select-trigger");
    expect(trigger).not.toBeNull();
    expect(trigger!.classList.contains("select-trigger--size-sm")).toBe(true);
  });
});
