import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "login-screen.css"), "utf8");

describe("login-screen CSS", () => {
  it("uses brand cream shell with ink chrome, not navy or dark-green fill", () => {
    expect(css).toMatch(/\.login-screen \{[\s\S]*?background-color:\s*var\(--color-cream\)/);
    expect(css).toMatch(/\.login-screen \{[\s\S]*?color:\s*var\(--color-ink\)/);
    expect(css).toMatch(/\.login-screen \{[\s\S]*?color-scheme:\s*light/);
    expect(css).not.toMatch(/background-color:\s*var\(--workspace-home-bg/);
    expect(css).not.toMatch(/background-color:\s*#1b1d3a/i);
    expect(css).not.toMatch(/background-color:\s*#003311/);
    expect(css).not.toMatch(/color-scheme:\s*dark/);
  });

  it("keeps brand dark-green primary fills with white fg", () => {
    expect(css).toMatch(/\.login-screen \{[\s\S]*?--button-primary-bg:\s*#003311/);
    expect(css).toMatch(/\.login-screen \{[\s\S]*?--button-primary-fg:\s*#ffffff/);
  });

  it("styles hero and inputs with ink, not white-on-dark", () => {
    expect(css).toMatch(/\.login-screen__hero \{[\s\S]*?color:\s*var\(--color-ink/);
    expect(css).toMatch(/\.login-screen \.input[\s\S]*?color:\s*var\(--color-ink\)/);
    expect(css).not.toMatch(/\.login-screen__hero \{[\s\S]*?color:\s*#ffffff/);
  });

  it("sets app-switch lockup paper for muted tagline mix (same as sidebars)", () => {
    expect(css).toMatch(/\.login-screen \{[\s\S]*?--app-switch-lockup-bg:\s*var\(--color-cream\)/);
  });

  it("does not define copyright footer chrome", () => {
    expect(css).not.toMatch(/\.login-screen__footer/);
  });
});
