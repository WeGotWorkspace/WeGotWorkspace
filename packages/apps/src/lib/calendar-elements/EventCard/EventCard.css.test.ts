import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readCss(relativePath: string): string {
  return readFileSync(join(here, relativePath), "utf8");
}

describe("EventCard / EventBase interaction CSS", () => {
  it("uses pointer at rest and grab while the pointer is down", () => {
    const css = readCss("EventCard.css");
    expect(css).toMatch(/:host\s*\{[^}]*cursor-pointer/);
    expect(css).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*:host\(:active\)\s*\{[\s\S]*cursor-grab/,
    );
    const hostBlock = css.match(/:host\s*\{[^}]*\}/)?.[0] ?? "";
    expect(hostBlock).not.toMatch(/cursor-grab/);
    expect(hostBlock).not.toMatch(/cursor:\s*grab/);
  });

  it("uses grabbing on EventBase while data-dragging, grab on surface :active", () => {
    const css = readCss("../EventBase/EventBase.css");
    expect(css).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*interaction-surface:active[\s\S]*cursor-grab/,
    );
    expect(css).toMatch(/:host\(\[data-dragging\]\)[\s\S]*cursor-grabbing/);
  });

  it("tints the card background on hover only for hover-capable fine pointers", () => {
    const css = readCss("EventCard.css");
    expect(css).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*:host\(:hover\)\s*\{[\s\S]*--_lc-event-card-bg-active:\s*var\(--_lc-event-bg-hover\)/,
    );
    expect(css).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*:host\(\[past\]:hover\)/,
    );
    const beforeHoverMedia = css.split(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/,
    )[0];
    expect(beforeHoverMedia).not.toMatch(/:host\(:hover\)/);
    expect(beforeHoverMedia).not.toMatch(/:host\(\[past\]:hover\)/);
  });

  it("uses pointer on TimeLine events at rest, grab on :active, grabbing while dragging", () => {
    const css = readCss("../TimeLine/TimeLine.css");
    const eventBlock = css.match(/\.event\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(eventBlock).toMatch(/cursor:\s*pointer/);
    expect(eventBlock).not.toMatch(/cursor:\s*grab/);
    expect(css).toMatch(
      /\.event:active(?:\s*,\s*\.event:active event-card)?\s*\{[\s\S]*cursor:\s*grab/,
    );
    expect(css).toMatch(/\.event\.event--dragging[\s\S]*cursor:\s*grabbing/);
  });

  it("uses a dashed accent edge and lighter fill for awaiting-reply RSVP", () => {
    const css = readCss("EventCard.css");
    expect(css).toMatch(
      /:host\(\[rsvp="needs-action"\]\)\s*\.event-card-shell::before[\s\S]*border:\s*1\.5px\s+dashed/,
    );
    expect(css).toMatch(/:host\(\[rsvp="tentative"\]\)\s*\.event-card-shell::before/);
    expect(css).toMatch(
      /:host\(\[rsvp="needs-action"\]\)\s*\.event-card-shell::before[\s\S]*color-mix\(in srgb,\s*var\(--_lc-event-card-bg\)\s*42%/,
    );
  });

  it("renders TimeLine create-preview as a card slot, not a dashed ghost", () => {
    const css = readCss("../TimeLine/TimeLine.css");
    const previewBlock = css.match(/\.create-preview\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(previewBlock).toMatch(/container-type:\s*size/);
    expect(previewBlock).toMatch(/pointer-events:\s*none/);
    expect(previewBlock).not.toMatch(/dashed/);
    expect(previewBlock).not.toMatch(/dotted/);
    expect(css).not.toMatch(/--time-line-create-preview-border/);
    expect(css).not.toMatch(/--time-line-create-preview-background/);
  });

  it("keeps EventBase multi-segment hover/press off sticky touch hover", () => {
    const css = readCss("../EventBase/EventBase.css");
    expect(css).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*event-card:hover[\s\S]*--_lc-event-card-bg-active:\s*var\(--_lc-event-bg-hover\)/,
    );
    expect(css).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*event-card:active/,
    );
    const beforeHoverMedia = css.split(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/,
    )[0];
    expect(beforeHoverMedia).not.toMatch(/event-card:hover/);
  });
});
