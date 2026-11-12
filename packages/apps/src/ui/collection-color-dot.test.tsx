import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CollectionColorDot } from "@/ui/collection-color-dot";

describe("CollectionColorDot", () => {
  it("renders a decorative dot, not a glyph", () => {
    const { container } = render(<CollectionColorDot />);
    const dot = container.querySelector(".collection-color-dot") as HTMLElement;
    expect(dot.tagName.toLowerCase()).toBe("span");
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("takes an explicit colour", () => {
    const { container } = render(<CollectionColorDot color="#14b8a6" />);
    const dot = container.querySelector(".collection-color-dot") as HTMLElement;
    expect(dot.style.getPropertyValue("--collection-row-color")).toBe("#14b8a6");
  });
});
