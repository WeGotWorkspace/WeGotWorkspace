import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  effectiveProjectFilter,
  projectIdOfFilter,
  readProjectFilter,
  subscribeProjectFilter,
  writeProjectFilter,
  type ProjectFilterValue,
} from "@/lib/projects/project-filter";
import { projectIdsInScope, selectedTeamSlug } from "@/lib/projects/project-match";
import { projectsStore, useProjects, type ProjectsStore } from "@/lib/projects/projects-store";

/**
 * The suite's Project filter, checked against the loaded Projects: a stored id that is no
 * longer listed reads as "All Projects". Setting it reaches every tab of this browser.
 */
export function useProjectFilter(
  store: ProjectsStore = projectsStore(),
): [ProjectFilterValue, (value: ProjectFilterValue) => void] {
  const stored = useSyncExternalStore(
    subscribeProjectFilter,
    readProjectFilter,
    (): ProjectFilterValue => "all",
  );
  const { status, projects } = useProjects(store);
  const knownTeamSlugs = useMemo(
    () =>
      status === "ready" || status === "offline"
        ? new Set(projects.map((project) => project.teamSlug))
        : null,
    [status, projects],
  );
  const knownIds = useMemo(
    () =>
      status === "ready" || status === "offline"
        ? new Set(projects.map((project) => project.id))
        : null,
    [status, projects],
  );
  const set = useCallback((value: ProjectFilterValue) => writeProjectFilter(value), []);
  return [effectiveProjectFilter(stored, knownIds, knownTeamSlugs), set];
}

/**
 * The selected Project's id, or null for "All Projects" and for a Team filter (and before the
 * Projects load, so an app never hides everything while it waits). Apps that narrow
 * collections read {@link useSelectedProjectIds}, which also covers a Team.
 */
export function useSelectedProjectId(store: ProjectsStore = projectsStore()): string | null {
  const [filter] = useProjectFilter(store);
  const { status } = useProjects(store);
  if (status !== "ready" && status !== "offline") return null;
  return projectIdOfFilter(filter);
}

/**
 * The ids of the Projects the filter keeps: one Project, every Project of a Team, or null for
 * "All Projects" (and before the Projects load).
 */
export function useSelectedProjectIds(store: ProjectsStore = projectsStore()): string[] | null {
  const [filter] = useProjectFilter(store);
  const { status, projects } = useProjects(store);
  return useMemo(
    () => (status === "ready" || status === "offline" ? projectIdsInScope(filter, projects) : null),
    [filter, status, projects],
  );
}

/** The Team of the selected Project or Team filter, or null for "All Projects". */
export function useSelectedProjectTeamSlug(store: ProjectsStore = projectsStore()): string | null {
  const [filter] = useProjectFilter(store);
  const { projects } = useProjects(store);
  return selectedTeamSlug(filter, projects);
}
