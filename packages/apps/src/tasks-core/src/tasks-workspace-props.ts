import type { ReactNode } from "react";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type {
  TasksAPIOperations,
  TaskProjectGroupOption,
  TasksUIData,
} from "@/lib/models/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";

export type TasksWorkspaceProps = {
  data: TasksUIData;
  session: WorkspaceSession;
  labels?: Partial<TasksUILabels>;
  operations?: TasksAPIOperations;
  listRefreshing?: boolean;
  bootstrapRevision?: number;
  onRefreshList?: () => void;
  onLogout?: () => void;
  className?: string;
  initialView?: string;
  /** `?task=` deep-link — opens the edit dialog once the list is ready. */
  initialTaskId?: string;
  onViewChange?: (view: string) => void;
  /** Shown between the header and the list, e.g. a `NoticeBar` for refused offline changes. */
  notice?: ReactNode;
};

export function taskProjectGroupsFromBootstrap(data: TasksUIData): TaskProjectGroupOption[] {
  return data.groups ?? [];
}
