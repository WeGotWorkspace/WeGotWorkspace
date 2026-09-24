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
      /--workspace-accent-strong:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-we-got-dark\)/,
    );
    expect(colorCss).not.toMatch(/--workspace-sidebar-mix/);
    expect(colorCss).toMatch(/\.app-sidebar/);
    expect(colorCss).toMatch(/^:where\(/m);
    expect(colorCss).toMatch(/\.meet-device-popover/);
    expect(colorCss).toMatch(
      /--workspace-surface:\s*color-mix\(\s*in oklch,\s*var\(--color-we-got-soft\) 70%,\s*#fff\)/,
    );
    expect(colorCss).toMatch(
      /--input-background:\s*color-mix\(\s*in oklch,\s*var\(--color-we-got-dark\) 6%,\s*var\(--workspace-surface\)/,
    );
    expect(colorCss).toMatch(
      /--input-background-focus:\s*color-mix\(\s*in oklch,\s*var\(--color-we-got-dark\) 8%,\s*var\(--workspace-surface\)/,
    );
    expect(colorCss).toMatch(
      /--input-background-disabled:\s*color-mix\(\s*in oklch,\s*var\(--color-we-got-dark\) 4%,\s*var\(--workspace-surface\)/,
    );
    expect(colorCss).toMatch(
      /--app-sidebar-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 12%,\s*var\(--workspace-surface\)/,
    );
    expect(colorCss).toMatch(/--app-sidebar-color:\s*var\(--color-we-got-dark\)/);
    expect(colorCss).toMatch(/--button-primary-bg:\s*var\(--workspace-accent\)/);
    expect(colorCss).toMatch(/--button-primary-fg:\s*#ffffff/);
    expect(colorCss).toMatch(
      /--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 12%,\s*var\(--app-sidebar-bg\)/,
    );
    expect(colorCss).toMatch(
      /--app-sidebar-item-selected-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 18%,\s*var\(--app-sidebar-bg\)/,
    );
    expect(colorCss).toMatch(
      /--app-sidebar-item-selected-hover-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 28%,\s*var\(--app-sidebar-bg\)/,
    );
    expect(colorCss).not.toMatch(
      /--app-sidebar-item-(?:hover|selected|selected-hover)-bg:\s*color-mix\([\s\S]*?var\(--workspace-surface\)/,
    );
    expect(colorCss).not.toMatch(
      /--app-sidebar-item-(?:hover|selected|selected-hover)-bg:\s*color-mix\([\s\S]*?var\(--color-we-got-soft\)/,
    );
    expect(colorCss).not.toMatch(/in oklab/);
    expect(colorCss).not.toMatch(/\.admin-workspace,\s*\.settings-workspace \{/);
    expect(colorCss).not.toMatch(/--app-sidebar-bg:\s*#0045ff/);
  });
});

/** Declarations that would let a product retune the rail or the row ladder. */
const SIDEBAR_LADDER_DECL_RE =
  /--(?:workspace-sidebar-mix|app-sidebar-item-(?:hover|selected|selected-hover)-bg)\s*:/;

/** `--app-sidebar-bg:` may exist only in the recipe, the Meet header pin, and the Docs playground knob. */
const SIDEBAR_BG_DECL_RE = /--app-sidebar-bg\s*:/;
const SIDEBAR_BG_ALLOW = new Set([
  "packages/apps/workspace-shell/src/workspace-color.css",
  "packages/apps/meet-core/src/meet-workspace.css",
  "packages/apps/branding-playground/branding-workspace-decorator.tsx",
]);

describe("sidebar rail single source of truth", () => {
  it("fails if a product redeclares the mix knob or the item ladder", () => {
    const hits: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
        if (entry.name === "workspace-color.css") continue;
        if (!entry.name.endsWith(".css")) continue;
        const text = readFileSync(full, "utf8");
        if (SIDEBAR_LADDER_DECL_RE.test(text)) {
          hits.push(full.replace(appsSrc + "/", "packages/apps/"));
        }
      }
    }

    walk(appsSrc);
    expect(hits, `sidebar ladder redeclared:\n${hits.join("\n")}`).toEqual([]);
  });

  it("fails if --app-sidebar-bg is assigned outside the recipe, Meet header, or Docs knob", () => {
    const hits: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
        const rel = full.replace(appsSrc + "/", "packages/apps/");
        const isCss = entry.name.endsWith(".css");
        const isDecorator = entry.name === "branding-workspace-decorator.tsx";
        if (!isCss && !isDecorator) continue;
        if (SIDEBAR_BG_ALLOW.has(rel)) continue;
        const text = readFileSync(full, "utf8");
        if (SIDEBAR_BG_DECL_RE.test(text)) hits.push(rel);
      }
    }

    walk(appsSrc);
    expect(hits, `--app-sidebar-bg assigned outside the SST:\n${hits.join("\n")}`).toEqual([]);
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
