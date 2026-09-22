import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COLOR_SEMANTIC,
  COLOR_WE_GOT_PRIMITIVES,
  CONTROL_SIZE_TOKENS,
  FONT_PRIMITIVES,
  FONT_SEMANTIC,
} from "./token-catalog";
import { formatCssVarRef, toCssVarName } from "./css-token-utils";

const here = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(join(here, "../styles.css"), "utf8");
const workspaceType = readFileSync(join(here, "../workspace-shell/src/workspace-type.css"), "utf8");

function declaredCustomProps(css: string, prefix: string): string[] {
  const found = new Set<string>();
  const re = new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\w-]+`, "g");
  for (const match of css.matchAll(re)) {
    found.add(match[0]!);
  }
  return [...found].sort();
}

describe("foundations token catalog", () => {
  it("lists every --color-we-got-* declared in styles.css", () => {
    expect([...COLOR_WE_GOT_PRIMITIVES].sort()).toEqual(
      declaredCustomProps(styles, "--color-we-got-"),
    );
  });

  it("lists semantic color roles present in styles.css", () => {
    for (const token of COLOR_SEMANTIC) {
      expect(styles).toContain(`${token}:`);
    }
  });

  it("lists font primitives and semantic roles from styles.css", () => {
    for (const token of [...FONT_PRIMITIVES, ...FONT_SEMANTIC]) {
      expect(styles).toContain(`${token}:`);
    }
  });

  it("keeps shared type role utilities in workspace-type.css", () => {
    expect(workspaceType).toMatch(/@utility text-title\b/);
    expect(workspaceType).toMatch(/@utility text-title-lg\b/);
    expect(workspaceType).toMatch(/@utility text-caption\b/);
    expect(workspaceType).toMatch(/@utility text-lockup\b/);
  });

  it("lists control size tokens from styles.css", () => {
    for (const token of CONTROL_SIZE_TOKENS) {
      expect(styles).toContain(`${token}:`);
    }
  });
});

describe("css-token-utils", () => {
  it("formats clipboard refs as var(--token)", () => {
    expect(formatCssVarRef("--color-we-got-dark")).toBe("var(--color-we-got-dark)");
    expect(formatCssVarRef("color-we-got-dark")).toBe("var(--color-we-got-dark)");
    expect(toCssVarName("color-we-got-dark")).toBe("--color-we-got-dark");
  });
});
