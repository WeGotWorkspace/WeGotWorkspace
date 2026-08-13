import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type {
  CalendarAPIOperations,
  CalendarUIData,
  CalendarViewId,
} from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";

export type CalendarWorkspaceProps = {
  data: CalendarUIData;
  session: WorkspaceSession;
  labels?: Partial<CalendarUILabels>;
  operations?: CalendarAPIOperations;
  listRefreshing?: boolean;
  onRefreshList?: () => void;
  initialView?: CalendarViewId;
  initialAnchor?: string;
  onViewChange?: (view: CalendarViewId) => void;
  onLogout?: () => void;
  className?: string;
};
