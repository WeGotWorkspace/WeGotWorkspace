import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Select, SelectTrigger, SelectValue } from "@/ui/select";

const here = dirname(fileURLToPath(import.meta.url));
const inputCss = readFileSync(join(here, "input.css"), "utf8");
const selectTsx = readFileSync(join(here, "select.tsx"), "utf8");

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

  it("aligns select-trigger idle color with outline button tokens", () => {
    expect(inputCss).toMatch(
      /\.select-trigger \{[\s\S]*color:\s*var\(--select-trigger-color,\s*var\(--button-outline-color,\s*var\(--color-ink\)\)\)/,
    );
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
    expect(inputCss).toMatch(/\.select-trigger__icon \{[\s\S]*color:\s*inherit/);
  });

  it("uses Button outline focus ring on select/control-surface triggers", () => {
    expect(inputCss).toMatch(
      /\.control-surface,\s*\.select-trigger \{[\s\S]*focus-visible:ring-1 focus-visible:ring-ring/,
    );
    expect(inputCss).not.toMatch(
      /\.select-trigger:focus-visible:not\(:disabled\) \{[\s\S]*border-color:\s*var\(--input-border-focus/,
    );
    expect(inputCss).not.toMatch(/\.select-trigger:focus:not\(:disabled\)/);
    expect(inputCss).not.toMatch(/\.input:focus:not\(:read-only\)/);
    expect(inputCss).toMatch(
      /\.input:focus-visible:not\(:read-only\),\s*\.textarea:focus-visible:not\(:read-only\) \{[\s\S]*border-color:\s*var\(--input-border-focus/,
    );
    expect(inputCss).toMatch(
      /\.select-trigger\[data-state="open"\]:not\(:disabled\) \{[\s\S]*border-color:\s*var\(--input-border-focus/,
    );
  });

  it("washes highlighted select items with quiet menu-item washes", () => {
    expect(inputCss).toMatch(
      /\.select-ui__item\[data-highlighted\][\s\S]*--menu-item-hover-background/,
    );
    expect(inputCss).toMatch(
      /\.select-ui__item\[data-highlighted\][\s\S]*var\(--workspace-accent,\s*var\(--color-ink\)\) 14%/,
    );
    expect(inputCss).not.toMatch(
      /\.select-ui__item\[data-highlighted\][\s\S]*--button-outline-hover-background/,
    );
    expect(inputCss).not.toMatch(/focus:bg-accent|data-\[highlighted\]:bg-accent/);
  });

  it("bridges portal theme from the open trigger onto SelectContent", () => {
    expect(selectTsx).toMatch(/bridgePortalThemeFromOpenTrigger/);
  });

  it("washes checked select items with quiet selected washes; checkmark keeps active color", () => {
    expect(inputCss).toMatch(
      /\.select-ui__item\[data-state="checked"\] \{[\s\S]*--menu-item-selected-background/,
    );
    expect(inputCss).toMatch(
      /\.select-ui__item\[data-state="checked"\] \{[\s\S]*var\(--workspace-accent,\s*var\(--color-ink\)\) 18%/,
    );
    expect(inputCss).not.toMatch(
      /\.select-ui__item\[data-state="checked"\] \{[\s\S]*--button-outline-active-background/,
    );
    expect(inputCss).toMatch(/\.select-ui__item-check \{[\s\S]*--button-active-color/);
  });
});
