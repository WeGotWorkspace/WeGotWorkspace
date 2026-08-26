import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readCss(relativePath: string): string {
  return readFileSync(join(here, relativePath), "utf8");
}

function ruleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("TimeLine overlay stacking vs app dialogs", () => {
  const timeLineCss = readCss("TimeLine.css");
  const timelineViewCss = readCss("../CalendarTimelineView/CalendarTimelineView.css");
  const monthGroupCss = readCss("../CalendarViewGroup/CalendarViewGroup.css");
  const dialogSrc = readFileSync(join(here, "../../../ui/dialog.tsx"), "utf8");

  it("traps overlay z-index inside .viewport, not on :host", () => {
    const viewport = ruleBlock(timeLineCss, ".viewport");
    expect(viewport).toMatch(/position:\s*relative/);
    expect(viewport).toMatch(/z-index:\s*0/);
    expect(viewport).toMatch(/isolation:\s*isolate/);

    const host = ruleBlock(timeLineCss, ":host");
    expect(host).not.toMatch(/isolation:\s*isolate/);
  });

  it("keeps create-preview above events but does not rely on beating dialog z-50", () => {
    const preview = ruleBlock(timeLineCss, ".create-preview");
    expect(preview).toMatch(/z-index:\s*500/);
    expect(dialogSrc).toMatch(/z-50/);
    expect(timeLineCss).toMatch(/z-index:\s*600/);
    expect(timeLineCss).toMatch(/z-index:\s*700/);
  });

  it("does not elevate a dragging event with a drop shadow", () => {
    const dragging = ruleBlock(timeLineCss, ".event.event--dragging");
    expect(dragging).toMatch(/z-index:\s*600/);
    expect(dragging).not.toMatch(/drop-shadow/);
    expect(dragging).not.toMatch(/filter:/);
  });

  it("raises a selected event above stagger and uses the hover fill", () => {
    expect(timeLineCss).toMatch(/--time-line-event-selected-z:\s*400/);
    const selected =
      timeLineCss.match(/\.event\.event--selected,[\s\S]*?\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(selected).toMatch(
      /--time-line-event-selected-boost:\s*var\(--time-line-event-selected-z\)/,
    );
    expect(selected).not.toMatch(/z-index:/);
    const selectedCard = ruleBlock(timeLineCss, ".event.event--selected event-card");
    expect(selectedCard).toMatch(/--_lc-event-card-bg-active:\s*var\(--_lc-event-bg-hover\)/);
    const staggerEvent =
      timeLineCss.match(
        /:host\(\[flow="vertical"\]\[layout="stagger"\]\)\s*\.event\s*\{[\s\S]*?\n\}/,
      )?.[0] ?? "";
    expect(staggerEvent).toMatch(
      /z-index:\s*calc\(2 \+ var\(--__indent,\s*0\) \+ var\(--time-line-event-selected-boost,\s*0\)\)/,
    );
    const selectedIdx = timeLineCss.indexOf(".event.event--selected event-card");
    const draggingIdx = timeLineCss.indexOf(".event.event--dragging event-card");
    expect(selectedIdx).toBeGreaterThan(-1);
    expect(draggingIdx).toBeGreaterThan(selectedIdx);
  });

  it("keeps the resting calendar tint while dragging (no desaturated ghost mix)", () => {
    const draggingCard = ruleBlock(timeLineCss, ".event.event--dragging event-card");
    expect(draggingCard).toMatch(/--_lc-event-card-bg-active:\s*var\(--_lc-event-bg\)/);
    expect(draggingCard).toMatch(/--_lc-event-bg-hover:\s*var\(--_lc-event-bg\)/);
    expect(draggingCard).not.toMatch(/color-mix/);
    expect(draggingCard).not.toMatch(/saturat/);
    expect(draggingCard).not.toMatch(/grayscale/);
  });

  it("uses one inset token on all four sides of vertical events", () => {
    expect(timeLineCss).toMatch(
      /--time-line-event-inset:\s*var\(--time-line-event-inline-inset,\s*var\(--_lc-event-card-inset,\s*1px\)\)/,
    );
    const verticalEvent =
      timeLineCss.match(/:host\(\[flow="vertical"\]\)\s*\.event\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(verticalEvent).toMatch(/inset-inline:\s*var\(--time-line-event-inset\)/);
    expect(verticalEvent).toMatch(
      /top:\s*calc\(var\(--__start,\s*0\)\s*\+\s*var\(--time-line-event-inset\)\)/,
    );
    expect(verticalEvent).toMatch(
      /bottom:\s*calc\(var\(--__end,\s*0\)\s*\+\s*var\(--time-line-event-inset\)\)/,
    );
    expect(timelineViewCss).toMatch(/--time-line-event-inline-inset:\s*1px/);
    expect(timelineViewCss).not.toMatch(/--time-line-event-inline-inset:\s*4px/);
  });

  it("traps month (and other standalone) timelines on a layout ancestor of <time-line>", () => {
    const layout = ruleBlock(timelineViewCss, ".timeline-layout");
    expect(layout).toMatch(/isolation:\s*isolate/);
    expect(timelineViewCss).toMatch(/time-line\.timeline-timed[\s\S]*?isolation:\s*isolate/);
  });

  it("traps the month composition wrapper around calendar-timeline-view", () => {
    const monthLayout = ruleBlock(monthGroupCss, ".timeline-month-layout");
    expect(monthLayout).toMatch(/isolate/);
  });
});

describe("TimeLine event geometry vs resize handles", () => {
  const timeLineCss = readCss("TimeLine.css");

  it("keeps resize handles out of the event flex row so they cannot shift cards", () => {
    expect(timeLineCss).toContain(".event > resize-handle");
    expect(timeLineCss).toMatch(/\.event > resize-handle\s*\{[\s\S]*?position:\s*absolute/);
    expect(timeLineCss).toMatch(/\.event > resize-handle\s*\{[\s\S]*?flex:\s*none/);
    expect(timeLineCss).toMatch(/\.event > event-card\s*\{[\s\S]*?flex:\s*1/);
  });

  it("shows desktop handles on event hover, not on coarse hover", () => {
    expect(timeLineCss).toContain("(hover: hover) and (pointer: fine)");
    expect(timeLineCss).toContain("--_lc-resize-handle-event-hover: 0.88");
  });
});

describe("TimeLine touch resize selection wiring", () => {
  const timeLineTs = readCss("TimeLine.ts");
  const timelineViewTs = readCss("../CalendarTimelineView/CalendarTimelineView.ts");

  it("marks resize handles active only for the selected event key", () => {
    expect(timeLineTs).toContain("selectedEventKey");
    expect(timeLineTs).toContain("isTouchResizeHandleActive");
    expect(timeLineTs).toContain("#eventAccentVars");
    const startIdx = timeLineTs.indexOf("--__start:${this.#axisPct");
    const endIdx = timeLineTs.indexOf("--__end:${endInset}");
    const accentIdx = timeLineTs.indexOf("${this.#eventAccentVars(templateEv)}");
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    expect(accentIdx).toBeGreaterThan(endIdx);
    expect(timelineViewTs).toContain(".selectedEventKey=${this.selectedEventKey");
    expect(timelineViewTs).toContain('attribute: "selected-event-key"');
    expect(timeLineTs).toContain("z-index:400");
    expect(timeLineTs).toContain("?data-selected=${selected}");
  });
});

describe("TimeLine last-row cell export", () => {
  const timeLineTs = readCss("TimeLine.ts");

  it("exports cell-last-row on the final grid row so consumers can drop the trailing hairline", () => {
    expect(timeLineTs).toContain("cell-last-row");
    expect(timeLineTs).toContain('part="cell${lastRowPart}"');
  });
});

describe("TimeLine month header create + hover reveal", () => {
  const timeLineCss = readCss("TimeLine.css");

  it("does not rely on .cell:hover (viewport inherits pointer-events: none onto .cell)", () => {
    expect(timeLineCss).not.toMatch(/\.cell:hover\s+\.day-create-button/);
    expect(timeLineCss).toMatch(/\.cell:has\(:hover\)\s+\.day-create-button/);
    expect(timeLineCss).toMatch(/\.cell:focus-within\s+\.day-create-button/);
  });

  it("lets the cell header receive hover so empty header space can reveal the +", () => {
    expect(timeLineCss).toMatch(/\.cell-header,\s*\.cell-footer\s*\{[^}]*pointer-events:\s*auto/);
  });
});
