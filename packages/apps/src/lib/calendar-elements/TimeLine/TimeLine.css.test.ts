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
  });
});
