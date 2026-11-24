import type { ReactNode, RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { DropdownMenu, type DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import { CollectionGhostButton } from "@/ui/collection-ghost-select";
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
  /** The invitations inbox, in both modes (list mode opens it as a side drawer). */
  invitationsTrigger: ReactNode;
};

/**
 * The calendar's header, two rows in both modes. Row one: the range title, the inbox at
 * the end. Row two: the calendar/list menu, the
 * period menu (day, week, month, year), then Today and previous / next at the end.
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
  const periodMenu: DropdownMenuEntry[] = CALENDAR_VIEW_ORDER.map((id) => ({
    id,
    label: viewLabels[id],
    checked: view === id,
    onClick: () => onSelectView(id),
  }));
  const toolbar = (
    <div className="calendar-header-toolbar">
      <ViewModeToggle
        value={presentation}
        onChange={onPresentationChange}
        gridLabel={L.showAsCalendar}
        listLabel={L.showAsList}
        disabled={searching}
        variant="menu"
        triggerVariant="ghost"
        onOpenChange={onMenuOpenChange}
      />
      <DropdownMenu
        items={periodMenu}
        disabled={searching}
        onOpenChange={onMenuOpenChange}
        trigger={
          <CollectionGhostButton
            className="calendar-header-toolbar__period"
            label={viewLabels[view]}
            disabled={searching}
          />
        }
      />
      <div className="calendar-header-toolbar__end">
        <Button
          label={L.today}
          size="md"
          variant="outline"
          disabled={searching}
          onClick={onToday}
        />
        <IconButton
          label={periodNav.previous}
          icon={<ChevronLeft className="size-4" />}
          size="md"
          variant="ghost"
          disabled={searching}
          onClick={onPrevious}
        />
        <IconButton
          label={periodNav.next}
          icon={<ChevronRight className="size-4" />}
          size="md"
          variant="ghost"
          disabled={searching}
          onClick={onNext}
        />
      </div>
    </div>
  );
  return (
    <>
      <div className="calendar-header-row">
        <ViewHeader
          title={searching ? L.searchTitle : title}
          // Narrow headers (phones, the grid) fall back to the short range.
          compactTitle={searching || wideList ? undefined : compactTitle}
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
          titleTrailing={invitationsTrigger}
        />
      </div>
      {toolbar}
    </>
  );
}
