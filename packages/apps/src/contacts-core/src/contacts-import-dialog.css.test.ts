import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const importCss = readFileSync(join(here, "contacts-import-dialog.css"), "utf8");
const calloutCss = readFileSync(join(here, "../../callout/src/callout.css"), "utf8");
const modalCss = readFileSync(join(here, "../../ui/modal-surface.css"), "utf8");

describe("import dialog error layout", () => {
  it("constrains the form, error, and footer to the modal width", () => {
    expect(importCss).toMatch(/\.contacts-import-dialog__form \{[\s\S]*min-w-0/);
    expect(importCss).toMatch(/\.contacts-import-dialog__error \{[\s\S]*max-w-full/);
    expect(importCss).toMatch(/\.contacts-import-dialog__footer \{[\s\S]*min-w-0/);
  });

  it("wraps long callout titles so URLs stay inside the dialog", () => {
    expect(calloutCss).toMatch(/\.callout \{[\s\S]*min-w-0/);
    expect(calloutCss).toMatch(/\.callout \.menu-item__label \{[\s\S]*overflow-wrap:\s*anywhere/);
    expect(modalCss).toMatch(/\.ui-modal-surface \{[\s\S]*overflow-x-hidden/);
  });
});
