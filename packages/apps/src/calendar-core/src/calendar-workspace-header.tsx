import type { ReactNode, RefObject } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/button/src/button";
import type { DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import { ViewHeader } from "@/view-header/src/view-header";
import { ViewModeToggle } from "@/view-mode-toggle/src/view-mode-toggle";
import type { CalendarPresentation, CalendarViewId } from "@/lib/models/calendar-types";
import {
  calendarPeriodNavLabels,
  type CalendarUILabels,
} from "@/calendar-core/src/calendar-labels";
import { CALENDAR_SEARCH_MIN_QUERY_LENGTH } from "@/calendar-core/src/calendar-route-search";
import { CALENDAR_VIEW_ORDER } from "@/calendar-core/src/calendar-workspace-nav";

export type CalendarWorkspaceHeaderProps = {
  L: CalendarUILabels;
  title: string;
  compactTitle?: string;
  view: CalendarViewId;
  presentation: CalendarPresentation;
  /** List mode's search is showing results (the range controls rest). */
  searching: boolean;
  /** Wide list mode has room for the full range title. */
  wideList: boolean;
  /** Multi-select hides the search field. */
  multiSelected: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  searchQuery: string;
  onSearchInput: (query: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onPresentationChange: (presentation: CalendarPresentation) => void;
  /** A header menu (range, grid/list) is open: the grid ignores the pointer meanwhile. */
  onMenuOpenChange: (open: boolean) => void;
  onSelectView: (view: CalendarViewId) => void;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
  /** The grid's invitations inbox (list mode has none). */
  invitationsTrigger: ReactNode;
};

/**
 * The calendar's header, one row in both modes: the range title (its menu holds the
 * period views and Today), then the grid/list menu and previous / next. List mode puts
 * those controls at the end and searches; the grid keeps them by the title, inbox last.
 */
export function CalendarWorkspaceHeader({
  L,
  title,
  compactTitle,
  view,
  presentation,
  searching,
  wideList,
  multiSelected,
  sidebarOpen,
  onToggleSidebar,
  searchQuery,
  onSearchInput,
  searchInputRef,
  onPresentationChange,
  onMenuOpenChange,
  onSelectView,
  onToday,
  onPrevious,
  onNext,
  invitationsTrigger,
}: CalendarWorkspaceHeaderProps) {
  const listLayout = presentation === "list";
  const periodNav = calendarPeriodNavLabels(view, L);
  const viewLabels: Record<CalendarViewId, string> = {
    month: L.viewMonth,
    week: L.viewWeek,
    day: L.viewDay,
    year: L.viewYear,
  };
  const titleMenu: DropdownMenuEntry[] = [
    ...CALENDAR_VIEW_ORDER.map((id) => ({
      id,
      label: viewLabels[id],
      checked: view === id,
      onClick: () => onSelectView(id),
    })),
    { type: "separator" as const, id: "today-separator" },
    { id: "today", label: L.today, icon: <CalendarDays />, onClick: onToday },
  ];
  const nav = (
    <div className="calendar-header-nav">
      <ViewModeToggle
        value={presentation}
        onChange={onPresentationChange}
        gridLabel={L.showAsCalendar}
        listLabel={L.showAsList}
        disabled={searching}
        variant="menu"
        onOpenChange={onMenuOpenChange}
      />
      <IconButton
        label={periodNav.previous}
        icon={<ChevronLeft className="size-4" />}
        size="md"
        variant="outline"
        disabled={searching}
        onClick={onPrevious}
      />
      <IconButton
        label={periodNav.next}
        icon={<ChevronRight className="size-4" />}
        size="md"
        variant="outline"
        disabled={searching}
        onClick={onNext}
      />
    </div>
  );
  return (
    <ViewHeader
      title={searching ? L.searchTitle : title}
      // Narrow headers (phones, the grid) fall back to the short range.
      compactTitle={searching || wideList ? undefined : compactTitle}
      titleMenu={searching ? undefined : titleMenu}
      onTitleMenuOpenChange={onMenuOpenChange}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={onToggleSidebar}
      {...(listLayout
        ? {
            searchPlaceholder: L.searchPlaceholder,
            searchValue: searchQuery,
            onSearchInput,
            searchMinLength: CALENDAR_SEARCH_MIN_QUERY_LENGTH,
            searchHidden: multiSelected,
            searchInputRef,
          }
        : {})}
      // List: the range left, its controls at the end. Grid: the controls right after
      // the range (lined up with list mode's on wide screens, CSS), the inbox last.
      titleSuffix={listLayout ? undefined : nav}
      titleTrailing={listLayout ? undefined : invitationsTrigger}
      actions={listLayout ? nav : undefined}
    />
  );
}
