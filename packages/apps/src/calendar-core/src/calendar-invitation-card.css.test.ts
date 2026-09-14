import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readCss(relativePath: string): string {
  return readFileSync(join(here, relativePath), "utf8");
}

describe("calendar invitation card CSS", () => {
  it("pins the event-dialog calendar picker to the card header actions", () => {
    const css = readCss("calendar-invitation-card.css");
    expect(css).toMatch(/\.calendar-invitation-card \.docs-collab-card__actions \{[\s\S]*shrink-0/);
    expect(css).toMatch(/\.calendar-invitation-card__calendar-trigger \{[\s\S]*width:\s*auto/);
    expect(css).toMatch(/\.calendar-invitation-card__calendar \{[\s\S]*shrink-0/);
  });

  it("paints a solid cream/white surface on the card shell only", () => {
    const css = readCss("calendar-invitation-card.css");
    expect(css).toMatch(
      /\.calendar-invitation-card \{[\s\S]*--docs-surface:\s*var\(--color-cream,\s*#ffffff\)/,
    );
    expect(css).toMatch(
      /\.calendar-invitation-card \{[\s\S]*background-color:\s*var\(--docs-surface\)/,
    );
  });

  it("keeps RSVP actions on one segmented row", () => {
    const css = readCss("calendar-rsvp-actions.css");
    expect(css).toMatch(/\.calendar-invitation-card__actions \{[\s\S]*flex-nowrap/);
    expect(css).not.toMatch(/\.calendar-invitation-card__actions \{[\s\S]*flex-wrap/);
    expect(css).toMatch(/\.calendar-rsvp-actions,[\s\S]*flex-nowrap/);
    expect(css).not.toMatch(/calendar-rsvp-action--lg/);
  });

  it("keeps invitees Tag --tag-* tokens; RSVP actions no longer use selected-chip washes", () => {
    const tokens = readCss("calendar-rsvp-status.css");
    expect(tokens).toMatch(/\.calendar-invitees-rsvp-tag--accepted[\s\S]*--tag-fg:\s*#3a8f5a/);
    expect(tokens).toMatch(/\.calendar-invitees-rsvp-tag--tentative[\s\S]*--tag-fg:\s*#2563eb/);
    expect(tokens).toMatch(/\.calendar-invitees-rsvp-tag--declined[\s\S]*--tag-fg:\s*#b14242/);
    expect(tokens).toMatch(
      /\.calendar-rsvp-select--accept\.calendar-rsvp-select--selected[\s\S]*--tag-fg:\s*#3a8f5a/,
    );
    expect(tokens).not.toMatch(/calendar-rsvp-action--accept/);
    expect(tokens).not.toMatch(/calendar-invitation-card__action--accept/);

    const card = readCss("calendar-invitation-card.css");
    expect(card).toMatch(/@import "\.\/calendar-rsvp-actions\.css"/);
    const actions = readCss("calendar-rsvp-actions.css");
    expect(actions).toMatch(/@import "\.\/calendar-rsvp-status\.css"/);
    expect(actions).not.toMatch(/calendar-invitation-card__action--selected/);
    expect(actions).toMatch(
      /\.calendar-rsvp-select\.calendar-rsvp-select--selected \{[\s\S]*background-color:\s*var\(--tag-bg\)/,
    );
  });
});
