import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The app loads every product `*-workspace.css`. Each one `@import`s the shared
 * sheets, and Vite inlines those imports again instead of deduping them.
 * Storybook loads one product, so the product file is last.
 *
 * A shared rule with the same specificity as a product class therefore wins in
 * the app and loses in Storybook. Defaults must be `:where` (specificity 0).
 * This test cascades both orders and fails when a custom property diverges.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appsSrc = resolve(here, "../..");

const PRODUCTS: Array<{ className: string; file: string }> = [
  { className: "admin-workspace", file: "admin-core/src/admin-workspace.css" },
  { className: "settings-workspace", file: "settings-core/src/settings-workspace.css" },
  { className: "notes-workspace", file: "notes-core/src/notes-workspace.css" },
  { className: "mail-workspace", file: "mail-core/src/mail-workspace.css" },
  { className: "tasks-workspace", file: "tasks-core/src/tasks-workspace.css" },
  { className: "calendar-workspace", file: "calendar-core/src/calendar-workspace.css" },
  { className: "contacts-workspace", file: "contacts-core/src/contacts-workspace.css" },
  { className: "drive-workspace", file: "drive-core/src/drive-workspace.css" },
  { className: "docs-workspace", file: "docs-core/src/docs-workspace.css" },
  { className: "meet-workspace", file: "meet-core/src/meet-workspace.css" },
  { className: "admin-dialog-surface", file: "admin-core/src/admin-workspace.css" },
  { className: "mail-dialog-surface", file: "mail-core/src/mail-workspace.css" },
  { className: "mail-compose-dialog-surface", file: "mail-core/src/mail-workspace.css" },
  { className: "docs-dialog-surface", file: "docs-core/src/docs-workspace.css" },
  { className: "notes-dialog-surface", file: "notes-core/src/notes-workspace.css" },
  { className: "tasks-dialog-surface", file: "tasks-core/src/tasks-workspace.css" },
  { className: "calendar-dialog-surface", file: "calendar-core/src/calendar-workspace.css" },
  { className: "contacts-dialog-surface", file: "contacts-core/src/contacts-workspace.css" },
  { className: "drive-dialog-surface", file: "drive-core/src/drive-workspace.css" },
];

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Inline `@import` the way the app bundle does: every copy, no dedupe. `reference` imports stay out. */
function inlineImports(file: string, stack: string[] = []): string {
  if (stack.includes(file)) return "";
  const text = stripComments(readFileSync(file, "utf8"));
  const dir = dirname(file);
  const re = /@import\s+(?:"([^"]+)"|'([^']+)')\s*(reference)?\s*;/g;
  let out = "";
  let last = 0;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    out += text.slice(last, match.index);
    last = match.index + match[0].length;
    if (!match[3]) {
      out += `\n${inlineImports(resolve(dir, match[1] || match[2]), [...stack, file])}\n`;
    }
  }
  return out + text.slice(last);
}

function splitCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseRules(css: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  let index = 0;

  function skipWs() {
    while (index < css.length && /\s/.test(css[index])) index += 1;
  }

  function parseBlock(): string {
    const start = index;
    let depth = 0;
    for (; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          return css.slice(start + 1, index - 1);
        }
      }
    }
    return "";
  }

  while (index < css.length) {
    skipWs();
    if (index >= css.length) break;
    if (css.startsWith("@import", index)) {
      while (index < css.length && css[index] !== ";") index += 1;
      index += 1;
      continue;
    }
    if (css[index] === "@") {
      const head = css.slice(index, index + 40);
      if (/^@(media|supports|container|layer)\b/.test(head)) {
        while (index < css.length && css[index] !== "{") index += 1;
        rules.push(...parseRules(parseBlock()));
        continue;
      }
      while (index < css.length && css[index] !== ";" && css[index] !== "{") index += 1;
      if (css[index] === "{") parseBlock();
      else index += 1;
      continue;
    }
    const selectorStart = index;
    while (index < css.length && css[index] !== "{") index += 1;
    const selector = css.slice(selectorStart, index).trim();
    if (css[index] !== "{") break;
    const body = parseBlock();
    if (selector) rules.push({ selector, body });
  }
  return rules;
}

function customProperties(body: string): Array<[string, string]> {
  const chunks: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (char === ";" && depth === 0) {
      chunks.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim()) chunks.push(current);
  return chunks.flatMap((raw) => {
    const text = raw.trim();
    if (!text.startsWith("--")) return [];
    const colon = text.indexOf(":");
    if (colon < 0) return [];
    return [
      [
        text.slice(0, colon).trim(),
        text
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, " "),
      ] as [string, string],
    ];
  });
}

/** Specificity of a selector that targets `className` alone. Descendants return null. */
function selectorSpecificity(selector: string, className: string): number | null {
  const trimmed = selector.trim();
  if (trimmed === `.${className}`) return 1;
  const wrapped = trimmed.match(/^:(where|is)\(([\s\S]*)\)$/);
  if (!wrapped) return null;
  const listed = splitCommas(wrapped[2]).map((part) => part.trim());
  if (!listed.includes(`.${className}`)) return null;
  return wrapped[1] === "where" ? 0 : 1;
}

function winningProperties(css: string, className: string): Map<string, string> {
  const winners = new Map<string, { specificity: number; value: string }>();
  for (const rule of parseRules(css)) {
    for (const alternative of splitCommas(rule.selector)) {
      const specificity = selectorSpecificity(alternative, className);
      if (specificity == null) continue;
      for (const [property, value] of customProperties(rule.body)) {
        const previous = winners.get(property);
        if (!previous || specificity >= previous.specificity) {
          winners.set(property, { specificity, value });
        }
      }
    }
  }
  return new Map([...winners].map(([property, winner]) => [property, winner.value]));
}

function diffProperties(storybook: Map<string, string>, app: Map<string, string>): string[] {
  const lines: string[] = [];
  for (const property of new Set([...storybook.keys(), ...app.keys()])) {
    const storyValue = storybook.get(property);
    const appValue = app.get(property);
    if (storyValue !== appValue) {
      lines.push(
        `${property}\n  storybook: ${storyValue ?? "(unset)"}\n  app: ${appValue ?? "(unset)"}`,
      );
    }
  }
  return lines;
}

const productFiles = [...new Set(PRODUCTS.map((product) => resolve(appsSrc, product.file)))];
const appCss = productFiles.map((file) => inlineImports(file)).join("\n");

describe("workspace cascade matches Storybook", () => {
  it.each(PRODUCTS)("$className custom properties survive the full app bundle", (product) => {
    const file = resolve(appsSrc, product.file);
    const storybook = winningProperties(inlineImports(file), product.className);
    const app = winningProperties(appCss, product.className);
    const diffs = diffProperties(storybook, app);
    expect(diffs, diffs.join("\n\n")).toEqual([]);
    expect(storybook.size).toBeGreaterThan(0);
  });
});
