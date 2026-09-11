import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "app-toaster.css"), "utf8");

describe("app-toaster CSS", () => {
  it("keeps toast chrome generic (cream surface, ink type, no accent/severity hues)", () => {
    expect(css).toMatch(
      /\[data-sonner-toast\] \.callout(?:,[\s\S]*\.callout--error)? \{[\s\S]*--callout-bg:\s*color-mix\(\s*in oklab,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\[data-sonner-toast\] \.callout(?:,[\s\S]*\.callout--error)? \{[\s\S]*--callout-text:\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(
      /\[data-sonner-toast\] \.callout(?:,[\s\S]*\.callout--error)? \{[\s\S]*--callout-icon-color:\s*var\(--color-ink\)/,
    );
    expect(css).not.toMatch(/--app-toast-accent/);
    expect(css).not.toMatch(/--workspace-accent/);
    expect(css).not.toMatch(/--callout-bg:\s*var\(--color-ink\)/);
    expect(css).not.toMatch(/--callout-text:\s*var\(--color-cream\)/);
    expect(css).not.toMatch(/#3a8f5a|#c98a1f|#b14242/);
  });

  it("uses a slightly translucent cream wash", () => {
    expect(css).toMatch(
      /--callout-bg:\s*color-mix\(\s*in oklab,\s*var\(--color-cream,\s*#ffffff\) 90%,\s*transparent\)/,
    );
  });

  it("disables text selection on toasts for easier pointer dismiss", () => {
    expect(css).toMatch(/\[data-sonner-toast\] \{[\s\S]*user-select:\s*none/);
    expect(css).toMatch(
      /\[data-sonner-toast\] \.callout(?:,[\s\S]*\.callout--error)? \{[\s\S]*user-select:\s*none/,
    );
  });

  it("matches IconButton outline chrome (control border + pill radius)", () => {
    expect(css).toMatch(
      /\[data-sonner-toast\] \.callout(?:,[\s\S]*\.callout--error)? \{[\s\S]*--callout-border:\s*var\(--control-border-color\)/,
    );
    expect(css).toMatch(
      /\[data-sonner-toast\] \.callout(?:,[\s\S]*\.callout--error)? \{[\s\S]*border-radius:\s*var\(--control-radius-button-pill\)/,
    );
  });

  it("makes the message primary and the app name a quiet caption underneath", () => {
    expect(css).toMatch(/\[data-sonner-toast\] \.menu-item__label \{[\s\S]*font-weight:\s*600/);
    expect(css).toMatch(/\[data-sonner-toast\] \.menu-item__label \{[\s\S]*font-size:\s*0\.875rem/);
    expect(css).toMatch(
      /\[data-sonner-toast\] \.menu-item__description \{[\s\S]*font-size:\s*0\.75rem[\s\S]*font-weight:\s*500/,
    );
    expect(css).toMatch(
      /\[data-sonner-toast\] \.menu-item__description \{[\s\S]*color-mix\(\s*in oklab,\s*var\(--color-ink\) 62%/,
    );
  });

  it("aligns the icon to the message row, with app name on the row below", () => {
    expect(css).toMatch(
      /\[data-sonner-toast\] \.menu-item__main--stacked \{[\s\S]*display:\s*grid/,
    );
    expect(css).toMatch(
      /\[data-sonner-toast\] \.menu-item__main--stacked \.menu-item__text \{[\s\S]*display:\s*contents/,
    );
    expect(css).toMatch(
      /\[data-sonner-toast\] \.menu-item__main--stacked \.menu-item__icon-slot \{[\s\S]*grid-row:\s*1/,
    );
    expect(css).toMatch(
      /\[data-sonner-toast\] \.menu-item__main--stacked \.menu-item__label \{[\s\S]*grid-row:\s*1/,
    );
    expect(css).toMatch(
      /\[data-sonner-toast\] \.menu-item__main--stacked \.menu-item__description \{[\s\S]*grid-row:\s*2/,
    );
  });
});
