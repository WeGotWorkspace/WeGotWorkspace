import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-event-dialog.css"), "utf8");
const formTsx = readFileSync(join(here, "calendar-event-form.tsx"), "utf8");
const dialogTsx = readFileSync(join(here, "calendar-event-dialog.tsx"), "utf8");
const recurrenceTsx = readFileSync(join(here, "calendar-recurrence-scope-dialog.tsx"), "utf8");

describe("calendar event dialog CSS ownership", () => {
  it("is imported by the shared form and recurrence scope dialog for standalone hosts", () => {
    expect(formTsx).toMatch(/import "\.\/calendar-event-dialog\.css"/);
    expect(recurrenceTsx).toMatch(/import "\.\/calendar-event-dialog\.css"/);
  });

  it("defines dialog-surface accent tokens outside the workspace shell", () => {
    expect(css).toMatch(/\.calendar-dialog-surface\s*\{/);
    expect(css).toContain("--calendar-accent: #6366f1");
    expect(css).toContain("--button-primary-bg: var(--calendar-accent-strong)");
  });

  it("uses a 40rem media query for the multi-column event form", () => {
    expect(css).toMatch(/@media \(min-width: 40rem\)/);
    expect(css).toMatch(
      /\.calendar-dialog-surface \.calendar-event-dialog__fields \{[\s\S]*grid-template-columns:\s*1fr 1fr/,
    );
  });
});

describe("calendar event dialog title row", () => {
  it("uses the shared name-color row so the summary field can flex", () => {
    expect(dialogTsx).toMatch(/CalendarEventForm/);
    expect(formTsx).toMatch(/NameColorRow/);
    expect(formTsx).toMatch(/NAME_COLOR_ROW_INPUT_CLASS/);
    expect(css).not.toMatch(/calendar-event-dialog__title-input/);
    expect(css).not.toMatch(/calendar-event-dialog__calendar-trigger \{[\s\S]*width:\s*auto/);
  });
});

describe("calendar event dialog shared form controls", () => {
  it("uses shared Input, Textarea, Select, LocaleDatePicker, and Button masters", () => {
    expect(formTsx).toMatch(/from "@\/ui\/input"/);
    expect(formTsx).toMatch(/from "@\/ui\/textarea"/);
    expect(formTsx).toMatch(/from "@\/ui\/select"/);
    expect(formTsx).toMatch(/from "@\/ui\/locale-date-picker"/);
    expect(formTsx).toMatch(/from "@\/button\/src\/button"/);
    expect(formTsx).toMatch(/variant="destructive-outline"/);
    expect(formTsx).not.toMatch(/calendar-event-dialog__date-trigger/);
    expect(css).not.toMatch(/calendar-event-dialog__date-trigger/);
    expect(css).not.toContain("color: #b91c1c");
  });

  it("relies on default control size md (36px) without compact size props", () => {
    expect(formTsx).not.toMatch(/size=["']sm["']/);
    expect(formTsx).not.toMatch(/size=["']lg["']/);
    expect(formTsx).not.toMatch(/size=["']xl["']/);
  });
});

describe("calendar event dialog Meet field", () => {
  it("lays out the Meet URL row with BEM + @apply", () => {
    expect(css).toMatch(
      /\.calendar-dialog-surface \.calendar-event-dialog__meet-row \{[\s\S]*@apply/,
    );
    expect(css).not.toMatch(
      /\.calendar-dialog-surface \.calendar-event-dialog__meet-row \.icon-button--size-md \{[\s\S]*size-9/,
    );
    expect(css).toMatch(/\.calendar-event-dialog__meet-menu/);
    expect(css).toMatch(/\.calendar-event-dialog__meet-menu-trigger/);
    expect(css).not.toMatch(
      /\.calendar-event-dialog__meet-menu-trigger \{[\s\S]*@apply h-9 min-h-9/,
    );
    expect(css).not.toMatch(
      /\.calendar-event-dialog__meet-menu-trigger \{[\s\S]*border-radius:\s*var\(--control-radius-button-pill\)/,
    );
    expect(css).toContain("background-color: transparent");
    expect(css).toContain("stroke-width: 1.75");
    expect(css).toContain("--meet-accent: #2a1644");
    expect(css).toContain("--card-title-icon-color: var(--meet-accent)");
    expect(css).not.toMatch(/calendar-event-dialog__meet-generate/);
    expect(css).not.toContain("calendar-event-dialog__meet-switch");
    expect(css).toMatch(/\.calendar-event-dialog__meet-scope-trigger/);
  });
});
