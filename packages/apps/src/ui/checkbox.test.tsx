import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "@/ui/checkbox";

describe("Checkbox", () => {
  it("defaults to md glyph size", () => {
    render(<Checkbox aria-label="Done" />);
    expect(screen.getByRole("checkbox", { name: "Done" }).className).toMatch(/checkbox--size-md/);
  });

  it("applies the sm sidebar glyph size", () => {
    render(<Checkbox size="sm" aria-label="Visible" />);
    expect(screen.getByRole("checkbox", { name: "Visible" }).className).toMatch(
      /checkbox--size-sm/,
    );
  });
});
