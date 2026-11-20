import { useEffect, useMemo, useRef } from "react";
import type { DocsHomeDrive } from "@/docs-core/src/docs-home-drives";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";
import { selectedProject } from "@/lib/projects/project-match";
import { useProjects, type WorkspaceProject } from "@/lib/projects/projects-store";
import { useProjectFilter } from "@/lib/projects/use-project-filter";

/** Browse prefix of a Project: its folder, or the whole Team Drive for a default Project. */
export function docsProjectPathPrefix(
  project: Pick<WorkspaceProject, "isDefault" | "teamSlug" | "resources">,
): string | null {
  const apiPath = project.resources.driveFolderPath;
  if (apiPath) return apiPath.replace(/^\/+|\/+$/g, "");
  return project.isDefault ? `groups/${project.teamSlug}` : null;
}

/**
 * The Project filter on Docs home (#818 C3): with a Project selected the drive list is
 * that Project's folder only, under the Project's name, and choosing it opens there.
 */
export function useDocsProjectScope({
  drives,
  view,
  selectView,
}: {
  drives: DocsHomeDrive[];
  view: DocsHomeView;
  selectView: (view: DocsHomeView) => void;
}): DocsHomeDrive[] {
  const [filter] = useProjectFilter();
  const { projects } = useProjects();
  const project = selectedProject(filter, projects);
  const prefix = project ? docsProjectPathPrefix(project) : null;

  const scoped = useMemo(
    () => (project && prefix ? [{ key: prefix, label: project.name, pathPrefix: prefix }] : drives),
    [drives, prefix, project],
  );

  const shownForRef = useRef<string | null | undefined>(undefined);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const first = shownForRef.current === undefined;
    if (shownForRef.current === prefix) return;
    shownForRef.current = prefix;
    if (!prefix) return;
    const current = viewRef.current;
    if (current.type === "drive" && current.pathPrefix === prefix) return;
    if (first && current.type !== "all") return;
    selectView({ type: "drive", pathPrefix: prefix });
  }, [prefix, selectView]);

  return scoped;
}
