import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-workspace.css"), "utf8");
const tsx = readFileSync(join(here, "calendar-workspace.tsx"), "utf8");

describe("calendar workspace header CSS", () => {
  it("compacts header chrome on narrow view-header containers", () => {
    expect(css).toMatch(/@container view-header-main \(max-width: 40rem\)/);
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-header-nav \.button\[class\*="icon-button--size"\][\s\S]*size-8/,
    );
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-header-actions \.calendar-view-select \{[\s\S]*min-w-0/,
    );
    expect(css).toMatch(/\.calendar-workspace \.workspace-app-layout__main-header \{[\s\S]*p-3/);
  });

  it("tints the open inbox and current-today controls instead of filled-emerald", () => {
    expect(css).toMatch(
      /:is\([\s\S]*calendar-invitations-trigger[\s\S]*calendar-header-today[\s\S]*\)\.button--variant-subtle\.icon-button--active \{[\s\S]*--button-active-color:\s*var\(--calendar-accent-strong\)/,
    );
    expect(css).toMatch(/:is\([\s\S]*calendar-header-today-icon[\s\S]*fill:\s*none/);
  });

  it("matches inbox gap to header actions so desktop clustering stays tight", () => {
    expect(css).toMatch(/\.calendar-workspace \.view-header__end \{[\s\S]*gap-1/);
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-invitations-trigger\.button\[class\*="icon-button--size"\][\s\S]*size-8/,
    );
  });
});

describe("calendar workspace header markup", () => {
  it("pins inbox to ViewHeader titleTrailing instead of wrapping actions", () => {
    expect(tsx).toMatch(/titleTrailing=\{\s*<CalendarInvitationsTrigger/);
    const actionsBlock = tsx.match(
      /actions=\{\s*<div className="calendar-header-actions">([\s\S]*?)<\/div>\s*\}/,
    );
    expect(actionsBlock?.[1]).toBeDefined();
    expect(actionsBlock![1]).not.toMatch(/CalendarInvitationsTrigger/);
    expect(actionsBlock![1]).toMatch(/calendar-header-today/);
    expect(actionsBlock![1]).toMatch(/icon=\{<CalendarDays/);
    expect(actionsBlock![1]).toMatch(/aria-pressed=\{showingToday\}/);
  });

  it("places an icon-only Today control in titlePrefix ahead of the date title", () => {
    expect(tsx).toMatch(/titlePrefix=\{\s*<IconButton/);
    expect(tsx).toMatch(/className="calendar-header-today-icon"/);
  });
});

describe("calendar workspace sidebar overlay", () => {
  it("clears sticky list heading backgrounds while the overlay sidebar is open", () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1159px\)[\s\S]*\.app-sidebar\[data-open="true"\][\s\S]*--_lc-list-heading-bg:\s*transparent/,
    );
  });
});

describe("calendar workspace ICS import", () => {
  it("opens the native file picker before the import dialog", () => {
    expect(tsx).toMatch(/type="file"/);
    expect(tsx).toMatch(/accept=\{ICS_FILE_ACCEPT\}/);
    expect(tsx).toMatch(/icsFileInputRef\.current\?\.click\(\)/);
    const importHandler = tsx.match(
      /onImportEvents=\{\s*canImportEvents\s*\?([\s\S]*?):\s*undefined/,
    )?.[1];
    expect(importHandler).toBeDefined();
    expect(importHandler).toMatch(/icsFileInputRef/);
    expect(importHandler).not.toMatch(/openImportDialog\(\)/);
    expect(tsx).toMatch(/file=\{importFile\}/);
  });
});

describe("calendar workspace sidebar heading", () => {
  it("does not render Plus or subscribe icon buttons on the My calendars heading", () => {
    expect(tsx).toMatch(/<SidebarSection title=\{L\.myCalendarsSection\}>/);
    expect(tsx).not.toMatch(/headingActions=/);
    expect(tsx).not.toMatch(/onAdd=\{canCreateCalendar/);
    expect(tsx).not.toMatch(/addLabel=\{L\.newCalendar\}/);
  });
});

describe("calendar workspace subscribed sidebar row", () => {
  it("places an Rss mark immediately after the title, not in a trailing action slot", () => {
    expect(tsx).toMatch(
      /calendar-sidebar-row__title[\s\S]*calendar-sidebar-row__name[\s\S]*SubscribedCalendarMark/,
    );
    expect(tsx).toMatch(/<Rss className="size-3\.5"/);
    expect(tsx).not.toMatch(/Link2/);
    expect(tsx).not.toMatch(/calendar-sidebar-row__edit[\s\S]*SubscribedCalendarMark/);
    expect(css).toMatch(/\.calendar-sidebar-row__title \{[^}]*inline-flex/);
    expect(css).toMatch(/\.calendar-sidebar-row__subscription \{[^}]*size-3\.5/);
    expect(
      css.match(/\.calendar-workspace \.calendar-sidebar-row__name \{[^}]+\}/)?.[0],
    ).not.toMatch(/flex-1/);
  });
});

describe("calendar workspace stacked header", () => {
  it("uses a viewport two-row grid so flattening main cannot drop the query", () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*"toggle actions trailing"[\s\S]*"title title leading"/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*\.calendar-header-today \{[\s\S]*hidden/,
    );
    expect(css).toMatch(/\.calendar-workspace \.view-header__title-prefix \{[\s\S]*hidden/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*\.view-header__title-prefix \{[\s\S]*flex/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*\.view-header__title-block \{[\s\S]*grid-area:\s*title/,
    );
  });
});
