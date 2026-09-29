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
    expect(trigger!.classList.contains("select-trigger--size-md")).toBe(true);
  });

  it("applies the sm size class for tighter triggers", () => {
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

  it("inherits trigger color on the chevron icon", () => {
    const { container } = render(
      <Select>
        <SelectTrigger aria-label="View">
          <SelectValue placeholder="Month" />
        </SelectTrigger>
      </Select>,
    );
    const icon = container.querySelector(".select-trigger__icon");
    expect(icon).not.toBeNull();
    expect(icon!.classList.contains("text-muted-foreground")).toBe(false);
  });
});
