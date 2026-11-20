import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  effectiveProjectFilter,
  readProjectFilter,
  subscribeProjectFilter,
  writeProjectFilter,
  type ProjectFilterValue,
} from "@/lib/projects/project-filter";
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
  const knownIds = useMemo(
    () =>
      status === "ready" || status === "offline"
        ? new Set(projects.map((project) => project.id))
        : null,
    [status, projects],
  );
  const set = useCallback((value: ProjectFilterValue) => writeProjectFilter(value), []);
  return [effectiveProjectFilter(stored, knownIds), set];
}
