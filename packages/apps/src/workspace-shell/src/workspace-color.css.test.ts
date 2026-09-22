import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appsSrc = join(here, "../..");
const colorCss = readFileSync(join(here, "workspace-color.css"), "utf8");

/** App-prefixed accent / sidebar tokens that must not return after the alias purge. */
const APP_PREFIXED_COLOR_RE =
  /--(?:mail|docs|notes|tasks|calendar|contacts|drive|admin|settings|meet)-(?:accent|sidebar)\b/;

describe("workspace-color.css shared tint recipes", () => {
  it("owns accent-strong, sidebar wash, item washes, and primary button in oklch", () => {
    expect(colorCss).toMatch(
      /--workspace-accent-strong:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-ink\)/,
    );
    expect(colorCss).toMatch(/--workspace-sidebar-mix:\s*12%/);
    expect(colorCss).toMatch(
      /--app-sidebar-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) var\(--workspace-sidebar-mix\),\s*var\(--color-cream\)/,
    );
    expect(colorCss).toMatch(/--app-sidebar-color:\s*var\(--color-ink\)/);
    expect(colorCss).toMatch(/--button-primary-bg:\s*var\(--workspace-accent\)/);
    expect(colorCss).toMatch(/--button-primary-fg:\s*#ffffff/);
    expect(colorCss).toMatch(
      /--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-cream\)/,
    );
    expect(colorCss).toMatch(
      /--app-sidebar-item-selected-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 55%,\s*var\(--color-cream\)/,
    );
    expect(colorCss).toMatch(
      /--app-sidebar-item-selected-hover-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 65%,\s*var\(--color-cream\)/,
    );
    expect(colorCss).not.toMatch(/in oklab/);
    expect(colorCss).toMatch(
      /\.docs-workspace,\s*\.docs-dialog-surface \{[\s\S]*--app-sidebar-bg:\s*#0045ff/,
    );
    expect(colorCss).toMatch(
      /\.docs-workspace,\s*\.docs-dialog-surface \{[\s\S]*--app-sidebar-color:\s*#ffffff/,
    );
  });
});

describe("app-prefixed color token purge", () => {
  it("fails if --{app}-accent / --{app}-sidebar return anywhere under packages/apps", () => {
    const hits: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(css|ts|tsx|md)$/.test(entry.name)) continue;
        const text = readFileSync(full, "utf8");
        if (APP_PREFIXED_COLOR_RE.test(text)) {
          hits.push(full.replace(appsSrc + "/", "packages/apps/"));
        }
      }
    }

    walk(appsSrc);
    expect(hits, `app-prefixed color tokens found:\n${hits.join("\n")}`).toEqual([]);
  });
});
