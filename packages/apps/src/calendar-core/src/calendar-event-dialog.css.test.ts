import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-event-dialog.css"), "utf8");
const formTsx = readFileSync(join(here, "calendar-event-form.tsx"), "utf8");
const whenTsx = readFileSync(join(here, "calendar-event-form-when.tsx"), "utf8");
const repeatTsx = readFileSync(join(here, "calendar-event-form-recurrence.tsx"), "utf8");
const footerTsx = readFileSync(join(here, "calendar-event-form-footer.tsx"), "utf8");
const secondaryTsx = readFileSync(join(here, "calendar-event-form-secondary.tsx"), "utf8");
const dialogTsx = readFileSync(join(here, "calendar-event-dialog.tsx"), "utf8");
const recurrenceTsx = readFileSync(join(here, "calendar-recurrence-scope-dialog.tsx"), "utf8");

describe("calendar event dialog CSS ownership", () => {
  it("is imported by the shared form and recurrence scope dialog for standalone hosts", () => {
    expect(formTsx).toMatch(/import "\.\/calendar-event-dialog\.css"/);
    expect(recurrenceTsx).toMatch(/import "\.\/calendar-event-dialog\.css"/);
  });

  it("defines dialog-surface accent tokens outside the workspace shell", () => {
    expect(css).toMatch(/\.calendar-dialog-surface\s*\{/);
    expect(css).toContain("--workspace-accent: var(--color-we-got-sand)");
    expect(css).toContain("--button-primary-bg: var(--workspace-accent)");
    expect(css).not.toContain("--button-primary-bg: var(--workspace-accent-strong)");
    expect(css).toMatch(
      /--workspace-accent-strong:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-we-got-dark\)\s*\)/,
    );
  });

  it("keeps the event form single-column (date+time pairs stay in-row)", () => {
    expect(css).toMatch(
      /\.calendar-dialog-surface \.calendar-event-dialog__fields \{[\s\S]*grid-cols-1/,
    );
    expect(css).not.toMatch(/@media \(min-width: 40rem\)/);
    expect(css).not.toMatch(/grid-template-columns:\s*1fr 1fr/);
    expect(css).toMatch(/--calendar-event-dialog-max-inline-size:\s*32rem/);
    expect(css).toMatch(
      /max-inline-size:\s*min\(var\(--calendar-event-dialog-max-inline-size\),\s*calc\(100vw - 1\.5rem\)\)/,
    );
    expect(css).toMatch(/max-h-\[75vh\]/);
    expect(css).toMatch(/--calendar-event-field-gap:\s*1rem/);
    expect(css).toMatch(/--calendar-event-field-group-gap:\s*0\.5rem/);
    expect(css).toMatch(/row-gap:\s*var\(--calendar-event-field-gap\)/);
    expect(whenTsx).toMatch(/!form\.allDay \? \(/);
  });

  it("keeps a compact card below the mobile breakpoint (no full-bleed sheet)", () => {
    expect(css).toMatch(/@media \(max-width: 767px\)/);
    expect(css).toMatch(/\.ui-modal-surface\.calendar-dialog-surface\.calendar-event-dialog \{/);
    expect(css).not.toContain("calendar-event-details-popover--dialog");
    expect(css).toMatch(
      /\.ui-modal-surface\.calendar-dialog-surface\.calendar-event-dialog[\s\S]*height:\s*auto/,
    );
    expect(css).toMatch(/safe-area-inset-top/);
    expect(css).toMatch(/safe-area-inset-bottom/);
    expect(css).not.toMatch(
      /\.ui-modal-surface\.calendar-dialog-surface\.calendar-event-dialog[\s\S]*inset:\s*0/,
    );
    expect(css).not.toMatch(
      /\.ui-modal-surface\.calendar-dialog-surface\.calendar-event-dialog[\s\S]*border-radius:\s*0/,
    );
    expect(css).toMatch(
      /\.calendar-event-dialog > \.calendar-event-dialog__form\s*\{[\s\S]*?flex:\s*1 1 auto/,
    );
  });

  it("puts all-day and timezone on one row with a visible all-day caption", () => {
    expect(whenTsx).toMatch(/calendar-event-dialog__when-meta/);
    expect(whenTsx).toMatch(/calendar-event-dialog__all-day-caption/);
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
    expect(secondaryTsx).toMatch(/from "@\/ui\/textarea"/);
    expect(formTsx).toMatch(/from "@\/ui\/select"/);
    expect(whenTsx).toMatch(/from "@\/ui\/locale-date-picker"/);
    expect(repeatTsx).toMatch(/from "@\/ui\/locale-date-picker"/);
    expect(footerTsx).toMatch(/from "@\/button\/src\/button"/);
    expect(footerTsx).toMatch(/IconButton/);
    expect(footerTsx).toMatch(/severity="danger"/);
    expect(footerTsx).not.toMatch(/variant="destructive-outline"/);
    expect(formTsx).not.toMatch(/variant="destructive-outline"/);
    expect(formTsx).not.toMatch(/calendar-event-dialog__date-trigger/);
    expect(whenTsx).not.toMatch(/calendar-event-dialog__date-trigger/);
    expect(repeatTsx).not.toMatch(/calendar-event-dialog__date-trigger/);
    expect(css).not.toMatch(/calendar-event-dialog__date-trigger/);
    expect(css).not.toContain("color: #b91c1c");
  });

  it("defaults to control size sm (32px) at every breakpoint", () => {
    expect(formTsx).toMatch(/controlSize\s*=\s*"sm"/);
    expect(formTsx).toMatch(/size=\{controlSize\}/);
    expect(formTsx).toMatch(/calendar-event-dialog__form--compact/);
  });

  it("stacks Invitees→Alarms→Description via display:contents secondary so fields share parent gap", () => {
    expect(secondaryTsx).toMatch(/calendar-event-dialog__secondary/);
    expect(secondaryTsx).toMatch(/calendar-event-dialog__secondary-start/);
    expect(secondaryTsx).toMatch(/calendar-event-dialog__secondary-end/);
    expect(css).toMatch(/\.calendar-event-dialog__secondary[\s\S]*display:\s*contents/);
    expect(css).toMatch(/\.calendar-event-dialog__secondary-start[\s\S]*display:\s*contents/);
    expect(css).toMatch(/\.calendar-event-dialog__secondary-end[\s\S]*display:\s*contents/);
    expect(css).not.toMatch(/\.calendar-event-dialog__secondary \{[\s\S]*grid-cols-2/);
    expect(formTsx).not.toMatch(/calendar-event-dialog__divider/);
    expect(secondaryTsx).not.toMatch(/calendar-event-dialog__divider/);
    expect(css).not.toMatch(/calendar-event-dialog__divider/);
    expect(formTsx).toMatch(/labelMode="icon"/);
    expect(formTsx).toMatch(/calendar-event-dialog__field-group--place/);
    expect(whenTsx).toMatch(/calendar-event-dialog__field-group--when/);
    expect(css).toMatch(/\.calendar-event-dialog__field-group/);
    expect(css).toMatch(
      /\.calendar-event-dialog__field-group \{[\s\S]*gap:\s*var\(--calendar-event-field-group-gap\)/,
    );
  });

  it("reserves datetime time slots so all-day toggle does not reflow neighbors", () => {
    expect(whenTsx).toMatch(/calendar-event-dialog__time-slot/);
    expect(css).toMatch(/calendar-event-dialog__time-slot/);
    expect(css).toMatch(/--calendar-event-time-slot-width/);
    expect(formTsx).not.toMatch(/calendar-event-dialog__field--inert/);
    expect(whenTsx).toMatch(/field--timezone/);
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
    expect(css).toMatch(
      /\.calendar-dialog-surface \.calendar-event-dialog__meet-menu-trigger \{[\s\S]*@apply flex/,
    );
    expect(css).toMatch(/meet-menu-trigger__join\.button/);
    expect(css).toMatch(/meet-menu-trigger__menu\.button/);
    expect(css).toMatch(/border-inline-start:\s*1px solid/);
    expect(css).not.toMatch(
      /\.calendar-event-dialog__meet-menu-trigger \{[\s\S]*@apply h-9 min-h-9/,
    );
    expect(css).not.toMatch(
      /\.calendar-event-dialog__meet-menu-trigger \{[\s\S]*border-radius:\s*var\(--control-radius-button-pill\)/,
    );
    expect(css).not.toContain("background-color: transparent");
    expect(css).not.toContain("stroke-width: 1.75");
    expect(css).not.toMatch(/color-swatch-trigger/);
    expect(css).toContain("--workspace-accent: var(--color-we-got-sand)");
    expect(css).toContain("--card-title-icon-color: var(--workspace-accent)");
    expect(css).not.toMatch(/calendar-event-dialog__meet-generate/);
    expect(css).not.toContain("calendar-event-dialog__meet-switch");
    expect(css).not.toMatch(/calendar-event-dialog__meet-scope-trigger/);
    expect(formTsx).not.toMatch(/onRecurrenceSaveScopeChange/);
    expect(css).toMatch(
      /\.calendar-dialog-surface \.calendar-event-dialog__meet-readonly \{[\s\S]*@apply min-w-0/,
    );
    expect(css).not.toMatch(/\.calendar-event-dialog__meet-readonly \{[\s\S]*flex-col/);
  });
});

describe("calendar event dialog invitation footer", () => {
  it("end-aligns RSVP actions and omits the series hint in invitation mode", () => {
    expect(formTsx).toContain('mode === "invitation"');
    expect(footerTsx).toContain("calendar-event-dialog__invitation-rsvp");
    expect(footerTsx).toContain("CalendarRsvpActions");
    expect(footerTsx).toMatch(
      /calendar-event-dialog__invitation-rsvp[\s\S]*CalendarRsvpActions[\s\S]*size="sm"[\s\S]*showLabels/,
    );
    expect(footerTsx).not.toMatch(
      /calendar-event-dialog__invitation-rsvp[\s\S]*CalendarRsvpActions[\s\S]*size="xs"/,
    );
    expect(footerTsx).not.toMatch(/calendar-event-dialog__invitation-rsvp[\s\S]*rsvpSeriesHint/);
    expect(css).toMatch(
      /\.calendar-dialog-surface \.calendar-event-dialog__invitation-rsvp \{[\s\S]*justify-end/,
    );
    expect(css).not.toMatch(/calendar-event-dialog__rsvp-hint/);
  });
});
