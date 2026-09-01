import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Select, SelectTrigger, SelectValue } from "@/ui/select";

const inputCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "input.css"), "utf8");

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
});
