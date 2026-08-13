import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { CalendarSurfaceStore } from "@/calendar-core/src/use-calendar-surface";
import type {
  CalendarAPIOperations,
  CalendarPresentation,
  CalendarUIData,
  CalendarViewId,
} from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";

export type CalendarWorkspaceProps = {
  data: CalendarUIData;
  session: WorkspaceSession;
  labels?: Partial<CalendarUILabels>;
  operations?: CalendarAPIOperations;
  /** Adapter-backed store for the lit views; omitted = read-only empty surface. */
  surface?: CalendarSurfaceStore;
  listRefreshing?: boolean;
  onRefreshList?: () => void;
  initialView?: CalendarViewId;
  initialPresentation?: CalendarPresentation;
  initialAnchor?: string;
  onViewChange?: (view: CalendarViewId) => void;
  onLogout?: () => void;
  className?: string;
};
