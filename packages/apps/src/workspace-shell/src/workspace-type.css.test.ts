import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appsSrc = join(here, "../..");
const typeCss = readFileSync(join(here, "workspace-type.css"), "utf8");
const stylesCss = readFileSync(join(here, "../../styles.css"), "utf8");

describe("workspace-type.css shared type roles", () => {
  it("defines title, title-lg, caption, and lockup from theme utilities", () => {
    expect(typeCss).toMatch(/\.text-title \{[\s\S]*@apply font-serif text-3xl font-semibold/);
    expect(typeCss).toMatch(/\.text-title-lg \{[\s\S]*@apply font-serif text-4xl font-semibold/);
    expect(typeCss).toMatch(
      /\.text-caption \{[\s\S]*@apply font-sans text-xs leading-4 font-medium uppercase/,
    );
    expect(typeCss).toMatch(/\.text-lockup \{[\s\S]*@apply font-mark/);
  });

  it("does not declare private app title face tokens", () => {
    expect(typeCss).not.toMatch(/detail-title-/);
  });
});

describe("font family primitives and semantic aliases", () => {
  it("aliases semantic families through We Got / system primitives", () => {
    expect(stylesCss).toMatch(/--font-we-got-serif:\s*"Libre Caslon Condensed",\s*serif/);
    expect(stylesCss).toMatch(/--font-we-got-mono:\s*"JetBrains Mono"/);
    expect(stylesCss).toMatch(/--font-we-got-mark:\s*"Bebas Neue"/);
    expect(stylesCss).toMatch(/--font-system-sans:\s*ui-sans-serif,\s*system-ui,\s*sans-serif/);
    expect(stylesCss).toMatch(/--font-sans:\s*var\(--font-system-sans\)/);
    expect(stylesCss).toMatch(/--font-serif:\s*var\(--font-we-got-serif\)/);
    expect(stylesCss).toMatch(/--font-mono:\s*var\(--font-we-got-mono\)/);
    expect(stylesCss).toMatch(/--font-mark:\s*var\(--font-we-got-mark\)/);
  });

  it("does not set a global text-xs line-height override", () => {
    expect(stylesCss).not.toMatch(/--text-xs--line-height/);
  });

  it("does not invent font-ui beside font-semibold", () => {
    expect(stylesCss).not.toMatch(/--font-weight-ui\b/);
    expect(stylesCss).not.toMatch(/\bfont-ui\b/);
  });
});

describe("retired type alias purge", () => {
  it("fails if --font-app, --text-2xs, or --font-display return under packages/apps", () => {
    const hits: string[] = [];
    // Build without spelling retired tokens so this file is not a false positive.
    const retired = [
      ["font", "app"],
      ["text", "2xs"],
      ["font", "display"],
    ].map(([a, b]) => `--${a}-${b}`);
    const re = new RegExp(retired.map((t) => `${t}\\b`).join("|"));

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
        if (!/\.(css|ts|tsx|md)$/.test(entry.name)) continue;
        const text = readFileSync(full, "utf8");
        if (re.test(text)) {
          hits.push(full.replace(appsSrc + "/", "packages/apps/"));
        }
      }
    }

    walk(appsSrc);
    expect(hits, `retired type aliases found:\n${hits.join("\n")}`).toEqual([]);
  });
});

describe("private title-family tokens gone", () => {
  it("fails if mail/notes detail title-family tokens return", () => {
    const hits: string[] = [];
    const re = new RegExp(`--(?:mail|note)-detail-title-${"font"}-${"family"}\\b`);

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
        if (!/\.(css|ts|tsx)$/.test(entry.name)) continue;
        const text = readFileSync(full, "utf8");
        if (re.test(text)) {
          hits.push(full.replace(appsSrc + "/", "packages/apps/"));
        }
      }
    }

    walk(appsSrc);
    expect(hits, `private title-family tokens found:\n${hits.join("\n")}`).toEqual([]);
  });
});
