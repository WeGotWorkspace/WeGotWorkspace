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

  it("keeps the event form single-column (date+time pairs stay in-row)", () => {
    expect(css).toMatch(
      /\.calendar-dialog-surface \.calendar-event-dialog__fields \{[\s\S]*grid-cols-1/,
    );
    expect(css).not.toMatch(/@media \(min-width: 40rem\)/);
    expect(css).not.toMatch(/grid-template-columns:\s*1fr 1fr/);
    expect(css).toMatch(/max-inline-size:\s*min\(24rem/);
    expect(css).toMatch(/max-h-\[50vh\]/);
    expect(css).toMatch(/--calendar-event-field-gap:\s*1rem/);
    expect(css).toMatch(/--calendar-event-field-group-gap:\s*0\.5rem/);
    expect(css).toMatch(/row-gap:\s*var\(--calendar-event-field-gap\)/);
    expect(formTsx).toMatch(/!form\.allDay \? \(/);
  });

  it("puts all-day and timezone on one row with a visible all-day caption", () => {
    expect(formTsx).toMatch(/calendar-event-dialog__when-meta/);
    expect(formTsx).toMatch(/calendar-event-dialog__all-day-caption/);
    expect(css).toMatch(/\.calendar-event-dialog__when-meta/);
    expect(css).toMatch(/calendar-event-dialog__all-day-caption/);
  });
});

describe("calendar event dialog title row", () => {
  it("uses FieldLabelRow plus name-color row so the summary field can flex", () => {
    expect(dialogTsx).toMatch(/CalendarEventForm/);
    expect(formTsx).toMatch(/FieldLabelRow/);
    expect(formTsx).toMatch(/calendar-event-dialog__field--title/);
    expect(formTsx).toMatch(/NameColorRow/);
    expect(formTsx).toMatch(/NAME_COLOR_ROW_INPUT_CLASS/);
    expect(css).not.toMatch(/calendar-event-dialog__title-input/);
    expect(css).not.toMatch(/calendar-event-dialog__calendar-trigger \{[\s\S]*width:\s*auto/);
    expect(css).not.toMatch(
      /\.calendar-event-dialog__title-row \.name-color-row__input \{[\s\S]*border:\s*none/,
    );
  });
});

describe("calendar event dialog shared form controls", () => {
  it("uses shared Input, Textarea, Select, LocaleDatePicker, and Button masters", () => {
    expect(formTsx).toMatch(/from "@\/ui\/input"/);
    expect(formTsx).toMatch(/from "@\/ui\/textarea"/);
    expect(formTsx).toMatch(/from "@\/ui\/select"/);
    expect(formTsx).toMatch(/from "@\/ui\/locale-date-picker"/);
    expect(formTsx).toMatch(/from "@\/button\/src\/button"/);
    expect(formTsx).toMatch(/IconButton/);
    expect(formTsx).toMatch(/severity="danger"/);
    expect(formTsx).not.toMatch(/variant="destructive-outline"/);
    expect(formTsx).not.toMatch(/calendar-event-dialog__date-trigger/);
    expect(css).not.toMatch(/calendar-event-dialog__date-trigger/);
    expect(css).not.toContain("color: #b91c1c");
  });

  it("defaults to control size md and accepts an explicit compact size prop", () => {
    expect(formTsx).toMatch(/controlSize\s*=\s*"md"/);
    expect(formTsx).toMatch(/size=\{controlSize\}/);
    expect(formTsx).toMatch(/calendar-event-dialog__form--compact/);
  });

  it("stacks Invitees→Alarms→Description via display:contents secondary so fields share parent gap", () => {
    expect(formTsx).toMatch(/calendar-event-dialog__secondary/);
    expect(formTsx).toMatch(/calendar-event-dialog__secondary-start/);
    expect(formTsx).toMatch(/calendar-event-dialog__secondary-end/);
    expect(css).toMatch(/\.calendar-event-dialog__secondary[\s\S]*display:\s*contents/);
    expect(css).toMatch(/\.calendar-event-dialog__secondary-start[\s\S]*display:\s*contents/);
    expect(css).toMatch(/\.calendar-event-dialog__secondary-end[\s\S]*display:\s*contents/);
    expect(css).not.toMatch(/\.calendar-event-dialog__secondary \{[\s\S]*grid-cols-2/);
    expect(formTsx).not.toMatch(/calendar-event-dialog__divider/);
    expect(css).not.toMatch(/calendar-event-dialog__divider/);
    expect(formTsx).toMatch(/labelMode="icon"/);
    expect(formTsx).toMatch(/calendar-event-dialog__field-group--place/);
    expect(formTsx).toMatch(/calendar-event-dialog__field-group--when/);
    expect(css).toMatch(/\.calendar-event-dialog__field-group/);
    expect(css).toMatch(
      /\.calendar-event-dialog__field-group \{[\s\S]*gap:\s*var\(--calendar-event-field-group-gap\)/,
    );
  });

  it("reserves datetime time slots so all-day toggle does not reflow neighbors", () => {
    expect(formTsx).toMatch(/calendar-event-dialog__time-slot/);
    expect(css).toMatch(/calendar-event-dialog__time-slot/);
    expect(css).toMatch(/--calendar-event-time-slot-width/);
    expect(formTsx).not.toMatch(/calendar-event-dialog__field--inert/);
    expect(formTsx).toMatch(/field--timezone/);
  });

  it("vertically centers all-day + timezone on a shared stretched row height", () => {
    expect(css).toMatch(/\.calendar-event-dialog__when-meta \{[\s\S]*align-items:\s*stretch/);
    expect(css).toMatch(/\.calendar-event-dialog__when-meta \{[\s\S]*gap:\s*1\.25rem/);
    expect(css).toMatch(/--when-meta-row-height:/);
    expect(css).toMatch(
      /\.calendar-event-dialog__when-meta > \.field-label-row--icon \{[\s\S]*align-items:\s*center/,
    );
    expect(css).toMatch(
      /\.calendar-event-dialog__when-meta > \.field-label-row--icon \{[\s\S]*margin-top:\s*0/,
    );
    expect(css).toMatch(
      /\.calendar-event-dialog__when-meta > \.field-label-row--icon \{[\s\S]*margin-bottom:\s*0/,
    );
    expect(css).toMatch(
      /\.calendar-event-dialog__when-meta \.field-label-row__icon-label \{[\s\S]*height:\s*var\(--when-meta-row-height\)/,
    );
    expect(css).toMatch(
      /\.calendar-event-dialog__all-day \{[\s\S]*height:\s*var\(--when-meta-row-height\)/,
    );
  });

  it("owns field margins so leaked sibling mt cannot break group gaps", () => {
    expect(css).toMatch(/\.calendar-event-dialog__fields \.field-label-row[\s\S]*margin-top:\s*0/);
    expect(css).toMatch(
      /\.calendar-event-dialog__fields \.field-label-row[\s\S]*margin-bottom:\s*0/,
    );
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
    expect(css).not.toMatch(/calendar-event-dialog__meet-scope-trigger/);
    expect(formTsx).not.toMatch(/onRecurrenceSaveScopeChange/);
  });
});
