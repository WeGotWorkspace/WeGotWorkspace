import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readCss(relativePath: string): string {
  return readFileSync(join(here, relativePath), "utf8");
}

describe("calendar invitation card CSS", () => {
  it("paints a solid cream/white surface on the card shell only", () => {
    const css = readCss("calendar-invitation-card.css");
    expect(css).toMatch(
      /\.calendar-invitation-card \{[\s\S]*--docs-surface:\s*var\(--color-cream,\s*#ffffff\)/,
    );
    expect(css).toMatch(
      /\.calendar-invitation-card \{[\s\S]*background-color:\s*var\(--docs-surface\)/,
    );
  });

  it("keeps Accept | Maybe | Decline on one row", () => {
    const css = readCss("calendar-rsvp-actions.css");
    expect(css).toMatch(/\.calendar-invitation-card__actions \{[\s\S]*flex-nowrap/);
    expect(css).not.toMatch(/\.calendar-invitation-card__actions \{[\s\S]*flex-wrap/);
    expect(css).toMatch(/\.calendar-rsvp-actions,[\s\S]*flex-nowrap/);
    expect(css).toMatch(/\.calendar-rsvp-action--lg \{[\s\S]*h-9/);
  });

  it("applies invitees Tag --tag-* tokens only on the selected RSVP action", () => {
    const tokens = readCss("calendar-rsvp-status.css");
    expect(tokens).toMatch(/\.calendar-invitees-rsvp-tag--accepted[\s\S]*--tag-fg:\s*#3a8f5a/);
    expect(tokens).toMatch(
      /\.calendar-invitation-card__action--accept\.calendar-invitation-card__action--selected[\s\S]*--tag-fg:\s*#3a8f5a/,
    );
    expect(tokens).toMatch(/\.calendar-invitees-rsvp-tag--tentative[\s\S]*--tag-fg:\s*#2563eb/);
    expect(tokens).toMatch(
      /\.calendar-invitation-card__action--maybe\.calendar-invitation-card__action--selected[\s\S]*--tag-fg:\s*#2563eb/,
    );
    expect(tokens).toMatch(/\.calendar-invitees-rsvp-tag--declined[\s\S]*--tag-fg:\s*#b14242/);
    expect(tokens).toMatch(
      /\.calendar-invitation-card__action--decline\.calendar-invitation-card__action--selected[\s\S]*--tag-fg:\s*#b14242/,
    );

    const card = readCss("calendar-invitation-card.css");
    expect(card).toMatch(/@import "\.\/calendar-rsvp-actions\.css"/);
    const actions = readCss("calendar-rsvp-actions.css");
    expect(actions).toMatch(/@import "\.\/calendar-rsvp-status\.css"/);
    const unselected = actions.match(/\.calendar-invitation-card__action \{[\s\S]*?\}/)?.[0] ?? "";
    expect(unselected).toMatch(/background-color:\s*transparent/);
    expect(unselected).toMatch(/color:\s*var\(--docs-text/);
    expect(unselected).not.toMatch(/--tag-fg/);
    expect(actions).toMatch(
      /\.calendar-invitation-card__action--selected \{[\s\S]*background-color:\s*var\(--tag-bg\)/,
    );
    expect(actions).toMatch(
      /\.calendar-invitation-card__action--selected \{[\s\S]*color:\s*var\(--tag-fg\)/,
    );
    expect(tokens).toMatch(
      /\.calendar-rsvp-action--accept\.calendar-rsvp-action--selected[\s\S]*--tag-fg:\s*#3a8f5a/,
    );
  });
});
