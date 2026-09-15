import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(join(here, "styles.css"), "utf8");
const buttonCss = readFileSync(join(here, "button/src/button.css"), "utf8");
const iconButtonCss = readFileSync(join(here, "button/src/icon-button.css"), "utf8");
const inputCss = readFileSync(join(here, "ui/input.css"), "utf8");

describe("control height tokens", () => {
  it("defines a fixed xs…xl scale and aliases --input-height to md", () => {
    expect(styles).toMatch(/--control-height-xs:\s*1\.75rem/);
    expect(styles).toMatch(/--control-height-sm:\s*2rem/);
    expect(styles).toMatch(/--control-height-md:\s*2\.25rem/);
    expect(styles).toMatch(/--control-height-lg:\s*2\.5rem/);
    expect(styles).toMatch(/--control-height-xl:\s*2\.75rem/);
    expect(styles).toMatch(/--input-height:\s*var\(--control-height-md\)/);
    expect(styles).not.toMatch(/@media \(min-width:\s*768px\) \{[\s\S]*--input-height:\s*2\.5rem/);
  });

  it("maps Button size classes to the matching tokens", () => {
    expect(buttonCss).toMatch(/\.button--size-xs \{[\s\S]*--control-height-xs/);
    expect(buttonCss).toMatch(/\.button--size-sm \{[\s\S]*--control-height-sm/);
    expect(buttonCss).toMatch(/\.button--size-md \{[\s\S]*--control-height-md/);
    expect(buttonCss).toMatch(/\.button--size-lg \{[\s\S]*--control-height-lg/);
    expect(buttonCss).toMatch(/\.button--size-xl \{[\s\S]*--control-height-xl/);
  });

  it("maps IconButton xs to --control-height-xs (not --tag-height)", () => {
    expect(iconButtonCss).toMatch(/\.icon-button--size-xs \{[\s\S]*--control-height-xs/);
    expect(iconButtonCss).not.toMatch(/\.icon-button--size-xs \{[\s\S]*--tag-height/);
  });

  it("maps Input / Select / control-surface size classes to the same tokens", () => {
    expect(inputCss).toMatch(/\.input--size-md[\s\S]*--control-height-md/);
    expect(inputCss).toMatch(/\.select-trigger--size-xl[\s\S]*--control-height-xl/);
    expect(inputCss).toMatch(/\.control-surface--size-xs[\s\S]*--control-height-xs/);
  });
});
