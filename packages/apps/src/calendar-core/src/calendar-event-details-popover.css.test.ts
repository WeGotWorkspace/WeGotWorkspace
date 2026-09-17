import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "calendar-event-details-popover.css"),
  "utf8",
);

describe("calendar event details popover CSS", () => {
  it("anchors large-screen placement beside the event with vertical center and side flips", () => {
    expect(css).toContain("anchor-name: --calendar-event-details-anchor");
    expect(css).toContain("position-anchor: --calendar-event-details-anchor");
    expect(css).toContain("position-try-fallbacks");
    expect(css).toContain("flip-inline");
    expect(css).toContain("flip-block");
    expect(css).toMatch(
      /\.calendar-dialog-surface\.calendar-event-details-popover\s*\{[\s\S]*?position-area:\s*right/,
    );
    expect(css).toMatch(
      /\.calendar-dialog-surface\.calendar-event-details-popover\s*\{[\s\S]*?align-self:\s*center/,
    );
    expect(css).toContain("position-area: left");
    expect(css).toContain("position-area: top");
    expect(css).toContain("position-area: bottom");
    expect(css).toContain("--calendar-event-details-try-above");
    expect(css).toContain("--calendar-event-details-try-below");
    expect(css).not.toContain("--calendar-event-details-try-above-start");
    expect(css).not.toContain("--calendar-event-details-try-above-end");
    expect(css).toContain("w-[min(20rem,calc(100vw-1.5rem))]");
    expect(css).toMatch(
      /\.calendar-dialog-surface\.calendar-event-details-popover\s*\{[\s\S]*?\bp-2\b/,
    );
    expect(css).not.toContain("--radix-popover-trigger-width");
  });

  it("docks only compact-month --docked (mobile uses Dialog below 768px)", () => {
    expect(css).toContain(
      "[data-radix-popper-content-wrapper]:has(.calendar-event-details-popover--docked)",
    );
    expect(css).not.toMatch(/@media \(max-width: 40rem\)/);
    expect(css).not.toMatch(/@media \(max-width: 48rem\)/);
    expect(css).not.toMatch(/@media \(max-width: 768px\)/);
    expect(css).toContain("calendar-event-details-popover--docked");
    expect(css).toContain("calendar-event-details-popover--dialog");
    expect(css).toContain("height: max-content");
    expect(css).toContain("position-anchor: none");
    expect(css).toContain("position-try-fallbacks: none");
    expect(css).toContain("calendar-event-details-popover__body");
    expect(css).toMatch(/\.calendar-event-details-popover__body\s*\{[\s\S]*?\boverflow-y-auto\b/);
    expect(css).toMatch(/\.calendar-event-details-popover__footer\s*\{[\s\S]*?\bshrink-0\b/);
  });

  it("keeps Dialog details as a centered card; full-bleed only wraps Radix popover fallback", () => {
    expect(css).toMatch(/@import "\.\/calendar-event-dialog\.css"/);
    expect(css).toMatch(
      /\.ui-modal-surface\.calendar-dialog-surface\.calendar-event-details-popover--dialog\s*\{[\s\S]*?position:\s*fixed/,
    );
    expect(css).toMatch(
      /\.ui-modal-surface\.calendar-dialog-surface\.calendar-event-details-popover--dialog\s*\{[\s\S]*?top:\s*50%/,
    );
    expect(css).toMatch(
      /\.ui-modal-surface\.calendar-dialog-surface\.calendar-event-details-popover--dialog\s*\{[\s\S]*?translate:\s*-50% -50%/,
    );
    expect(css).toMatch(
      /\.calendar-dialog-surface\.calendar-event-details-popover--dialog\s*\{[\s\S]*?\boverflow-hidden\b/,
    );
    expect(css).not.toMatch(
      /\.calendar-dialog-surface\.calendar-event-details-popover--dialog\s*\{[\s\S]*?max-h-\[50vh\]/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\[data-radix-popper-content-wrapper\]:has\(\.calendar-event-details-popover\)/,
    );
    expect(css).toMatch(
      /\[data-radix-popper-content-wrapper\]:has\(\.calendar-event-details-popover\)[\s\S]*transform:\s*none/,
    );
    expect(css).toMatch(
      /\[data-radix-popper-content-wrapper\] \.calendar-dialog-surface\.calendar-event-details-popover/,
    );
  });

  it("centers a flow event-card with icon detail rows and a shared footer", () => {
    expect(css).toContain("calendar-event-details-popover__event");
    expect(css).toContain("calendar-event-details-popover__details");
    expect(css).toContain("calendar-event-details-popover__row");
    expect(css).toContain("calendar-event-details-popover__icon");
    expect(css).toContain(
      "padding-inline-start: var(--_lc-event-card-heading-padding-inline-start, 13px)",
    );
    expect(css).toContain("font-size: var(--_lc-time-label-font-size, 0.75rem)");
    expect(css).toContain("calendar-event-details-popover__footer");
    expect(css).toContain("calendar-event-details-popover__footer-actions");
    expect(css).toContain("calendar-event-details-popover__footer-primary");
    expect(css).toContain("justify-between");
    expect(css).toMatch(/\.calendar-event-details-popover__footer-actions\s*\{[^}]*\bms-auto\b/);
    expect(css).not.toMatch(
      /\.calendar-event-details-popover__footer-primary\s*\{[^}]*\bms-auto\b/,
    );
    expect(css).not.toContain("calendar-event-details-popover__rsvp {");
    expect(css).not.toContain("calendar-event-details-popover__title");
    expect(css).not.toContain("calendar-event-details-popover__swatch");
    expect(css).not.toContain("calendar-event-details-popover__extras");
    expect(css).not.toContain("calendar-event-details-popover__meet");
    expect(css).not.toContain("calendar-event-details-popover__calendar");
    expect(css).not.toContain("calendar-event-details-popover__join");
  });

  it("sizes the editable popover for the single-column event form", () => {
    expect(css).toContain("calendar-event-details-popover--editable");
    expect(css).toMatch(/--calendar-event-details-popover-editable-max-inline-size:\s*24rem/);
    expect(css).toMatch(
      /width:\s*min\(var\(--calendar-event-details-popover-editable-max-inline-size\),\s*calc\(100vw - 1\.5rem\)\)/,
    );
    expect(css).toMatch(
      /max-width:\s*min\(\s*var\(--calendar-event-details-popover-editable-max-inline-size\)\s*,\s*calc\(100vw - 1\.5rem\)\s*\)/,
    );
    expect(css).toMatch(
      /max-inline-size:\s*min\(\s*var\(--calendar-event-details-popover-editable-max-inline-size\)\s*,\s*calc\(100vw - 1\.5rem\)\s*\)/,
    );
    expect(css).not.toMatch(
      /\.calendar-event-details-popover--editable[\s\S]*--calendar-event-dialog-max-inline-size/,
    );
    expect(css).toContain("max-height: 50vh");
    expect(css).not.toContain("w-[min(28rem,calc(100vw-1.5rem))]");
    expect(css).not.toContain("w-[min(34rem,calc(100vw-1.5rem))]");
  });
});
