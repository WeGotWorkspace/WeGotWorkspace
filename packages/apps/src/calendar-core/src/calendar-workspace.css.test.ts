import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-workspace.css"), "utf8");
const tsx = readFileSync(join(here, "calendar-workspace.tsx"), "utf8");
const searchTsx = readFileSync(join(here, "calendar-search-results.tsx"), "utf8");

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
    expect(tsx).not.toMatch(/CalendarSearchPopover/);
    expect(tsx).not.toMatch(/calendar-search-trigger/);
    expect(tsx).not.toMatch(/calendar-header-search/);
    const actionsBlock = tsx.match(
      /actions=\{\s*<div className="calendar-header-actions">([\s\S]*?)<\/div>\s*\}/,
    );
    expect(actionsBlock?.[1]).toBeDefined();
    expect(actionsBlock![1]).not.toMatch(/CalendarInvitationsTrigger/);
    expect(actionsBlock![1]).toMatch(/CollectionSearchInput/);
    expect(actionsBlock![1].indexOf("CollectionSearchInput")).toBeLessThan(
      actionsBlock![1].indexOf("<Select"),
    );
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
    expect(tsx).toMatch(/blockName="calendar-sidebar-row"/);
    expect(tsx).toMatch(/CollectionSidebarRow/);
    expect(tsx).toMatch(/calendar-sidebar-row__title|badges=/);
    expect(tsx).toMatch(/CalendarSidebarMark/);
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

describe("calendar workspace search results", () => {
  it("scopes search list chrome under .calendar-workspace with BEM + @apply", () => {
    expect(tsx.match(/<CollectionSearchInput/g)).toHaveLength(1);
    expect(tsx).toMatch(/useViewHeaderSearchQuery/);
    expect(tsx).toMatch(/searchMinLength:\s*CALENDAR_SEARCH_MIN_QUERY_LENGTH/);
    expect(tsx).toMatch(/onSearchInput:\s*setSearchQuery/);
    expect(tsx).toMatch(/onChange=\{setSearchFieldQuery\}/);
    expect(tsx).not.toMatch(/onChange=\{setSearchQuery\}/);
    expect(tsx).not.toMatch(/searchPlaceholder=\{L\.searchPlaceholder\}/);
    expect(tsx).not.toMatch(/CalendarSearchPopover/);
    expect(tsx).toMatch(/CalendarSearchResultsList/);
    expect(searchTsx).toMatch(/calendar-list-view/);
    expect(searchTsx).toMatch(/useEventSet/);
    expect(searchTsx).toMatch(/unifiedSearchOccurrences/);
    expect(searchTsx).toMatch(/visibleSearchOccurrences/);
    expect(searchTsx).toMatch(/useCollectionListEndReached/);
    expect(searchTsx).toMatch(/CollectionListEnd/);
    expect(searchTsx).toMatch(/showYearInHeadings/);
    expect(searchTsx).toMatch(/onEventSelected/);
    expect(searchTsx).toMatch(/scrollToEvent/);
    expect(css).toMatch(/\.calendar-workspace \.calendar-search-results__scroller \{[\s\S]*@apply/);
    expect(searchTsx).not.toMatch(/searchUpcoming/);
    expect(searchTsx).not.toMatch(/SearchSection/);
    expect(css).toMatch(/\.calendar-workspace \.calendar-search-results \{[\s\S]*@apply/);
    expect(css).toMatch(/\.calendar-workspace \.calendar-search-results__agenda \{[\s\S]*@apply/);
    expect(css).not.toMatch(/calendar-search-results__caption/);
    expect(searchTsx).not.toMatch(/calendar-search-results__caption/);
    expect(css).toMatch(/\.calendar-workspace \.calendar-search-results__scope \{[\s\S]*@apply/);
    expect(css).toMatch(/\.calendar-workspace \.calendar-search-results__scope \{[\s\S]*flex-wrap/);
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-search-results__scope \{[\s\S]*\bpx-1\.5\b/,
    );
    expect(css).not.toMatch(
      /\.calendar-workspace \.calendar-search-results__scope \{[^}]*\bpx-4\b/,
    );
    expect(searchTsx).toMatch(/calendar-search-results__scope/);
    expect(searchTsx).toMatch(/<Tag/);
    expect(searchTsx).toMatch(/CalendarDays/);
    expect(searchTsx).not.toMatch(/Visible calendars/);
    expect(searchTsx).not.toMatch(/searchTruncated/);
    expect(searchTsx).not.toMatch(/truncationCaption/);
    expect(css).toMatch(/\.calendar-workspace \.calendar-main--search \{[\s\S]*@apply/);
    expect(tsx).toMatch(/calendar-search-field/);
    expect(tsx).toMatch(/searchInputRef/);
    expect(tsx).not.toMatch(/data-idle-label/);
    expect(css).not.toMatch(/content:\s*attr\(data-idle-label\)/);
    expect(css).toMatch(/\.calendar-workspace \.calendar-main \{[\s\S]*--_lc-z-sticky:\s*30/);
    expect(css).not.toMatch(/calendar-search-dock/);
    expect(css).not.toMatch(/padding-bottom:\s*5rem/);
    expect(css).not.toMatch(/\.calendar-search-field \{[\s\S]*inset-x-0/);
    expect(css).not.toMatch(/\.calendar-search-field \{[\s\S]*opacity:\s*0\.55/);
    expect(css).not.toMatch(/\.calendar-search-field \{[\s\S]*\bz-20\b/);
    expect(css).not.toMatch(/left-1\/2/);
    expect(css).not.toMatch(/-translate-x-1\/2/);
    expect(css).not.toMatch(/calendar-search-popover/);
    expect(css).not.toMatch(/calendar-search-trigger/);
    expect(css).not.toMatch(/calendar-header-search/);
    expect(css).not.toMatch(/calendar-search-results__heading/);
    expect(searchTsx).not.toMatch(/calendar-search-results__row/);
  });

  it("uses an in-flow header field on wide screens", () => {
    const desktopField = css.match(
      /\.calendar-workspace \.calendar-search-field \{[\s\S]*?\n\}/,
    )?.[0];
    expect(desktopField).toBeDefined();
    expect(desktopField).toMatch(/@apply[^;]*\bmt-0\b/);
    expect(desktopField).toMatch(/@apply[^;]*\bw-44\b/);
    expect(desktopField).not.toMatch(/\bh-8\b/);
    expect(desktopField).not.toMatch(/absolute/);
    expect(desktopField).not.toMatch(/rounded-full/);
    expect(desktopField).not.toMatch(/shadow-lg/);
    expect(desktopField).not.toMatch(/--collection-search-input-bg/);
  });

  it("keeps the compact FAB under open overlay panes", () => {
    expect(css).toMatch(/\.calendar-workspace \.workspace-app-layout__main \{[\s\S]*\bisolate\b/);
    expect(tsx).toMatch(/calendar-workspace--panel-open/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1159px\)[\s\S]*:has\(\.app-sidebar\[data-open="true"\]\)[\s\S]*\.calendar-search-field/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1159px\)[\s\S]*\.calendar-workspace--panel-open \.calendar-search-field/,
    );
    expect(css).toMatch(
      /:has\(\.app-sidebar\[data-open="true"\]\)[\s\S]*\.calendar-search-field[\s\S]*\binvisible\b/,
    );
  });

  it("repositions the same field as a right-hand FAB at the sidebar overlay 1159px floor", () => {
    const compact = css.match(
      /@media\s*\(max-width:\s*1159px\)\s*\{[\s\S]*?\.calendar-search-field \{[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(compact).toBeDefined();
    expect(compact).toMatch(/@apply[^;]*\babsolute\b/);
    expect(compact).toMatch(/@apply[^;]*\brounded-full\b/);
    expect(compact).toMatch(/@apply[^;]*\bborder\b/);
    expect(compact).toMatch(/@apply[^;]*\bshadow-xl\b/);
    expect(compact).toMatch(/box-shadow:/);
    expect(compact).toMatch(/@apply[^;]*\bw-9\b/);
    expect(compact).toMatch(/right:\s*var\(--calendar-search-fab-inline-end\)/);
    expect(compact).toMatch(/left:\s*auto/);
    expect(compact).toMatch(/z-index:\s*calc\(\s*var\(--_lc-z-sticky/);
    expect(compact).toMatch(/--collection-search-input-bg/);
    expect(css).toMatch(/@media\s*\(max-width:\s*1159px\)[\s\S]*--_lc-list-end-pad:\s*4\.5rem/);
    expect(css).toMatch(/\.calendar-search-field--expanded \{[\s\S]*width:\s*calc\(\s*100%/);
    expect(css).toMatch(/--calendar-search-fab-inline-start:\s*max\(1rem/);
    expect(css).toMatch(/--calendar-search-fab-inline-end:\s*max\(1rem/);
    expect(css).not.toMatch(/w-\[min\(22rem/);
    expect(css).not.toMatch(
      /\.calendar-search-field:is\(:focus-within[\s\S]*?\b(w-auto|left:\s*max)/,
    );
    expect(css).toMatch(/\.calendar-workspace \.calendar-search-host \{[\s\S]*\bcontents\b/);
    expect(css).toMatch(
      /:has\(\.calendar-search-field--expanded\) \.calendar-search-dismiss \{[\s\S]*\bfixed\b/,
    );
    expect(tsx).toMatch(/calendar-search-dismiss/);
    expect(tsx).toMatch(/onPointerDown=\{onSearchDismissPointerDown\}/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*--calendar-search-fab-inline-start:\s*max\(0\.75rem/,
    );
    expect(css).toMatch(/transition-\[width,padding,box-shadow,background-color\]/);
    expect(css).toMatch(/prefers-reduced-motion:\s*no-preference/);
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-search-field \{[\s\S]*@apply[^;]*\bduration-300\b/,
    );
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-search-field \{[\s\S]*@apply[^;]*\bease-out\b/,
    );
    expect(css).not.toMatch(/\bduration-150\b/);
  });

  it("opens a search result through the same details-popover opener as the surface", () => {
    expect(tsx.match(/onEventSelected=\{openEventPreview\}/g)).toHaveLength(2);
    expect(tsx).not.toMatch(/onSearchEventSelected/);
    expect(tsx).not.toMatch(/openSearchResult/);
    expect(tsx).not.toMatch(/searchPreviewKey/);
    expect(searchTsx).toMatch(/bindCalendarEventSelected/);
  });
});

describe("calendar event dialog Meet field", () => {
  it("lays out the Meet URL row with BEM + @apply", () => {
    expect(css).toMatch(
      /\.calendar-dialog-surface \.calendar-event-dialog__meet-row \{[\s\S]*@apply/,
    );
    expect(css).toMatch(
      /\.calendar-dialog-surface \.calendar-event-dialog__meet-row \.icon-button--size-sm \{[\s\S]*@apply/,
    );
    expect(css).toMatch(/\.calendar-event-dialog__meet-generate/);
    expect(css).toContain("--meet-accent: #06b6d4");
    expect(css).toContain("background-color: var(--meet-accent)");
    expect(css).toContain("color: #ffffff");
    expect(css).toContain("--loading-spinner-color: currentColor");
    expect(css).not.toContain("calendar-event-dialog__meet-switch");
    expect(css).toMatch(/\.calendar-event-dialog__meet-scope-trigger/);
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
