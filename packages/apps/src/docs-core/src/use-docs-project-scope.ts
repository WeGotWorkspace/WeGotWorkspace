import { useEffect, useMemo, useRef } from "react";
import type { DocsHomeDrive } from "@/docs-core/src/docs-home-drives";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";
import { teamSlugOfFilter } from "@/lib/projects/project-filter";
import { selectedProject } from "@/lib/projects/project-match";
import { useProjects, type WorkspaceProject } from "@/lib/projects/projects-store";
import { useProjectFilter } from "@/lib/projects/use-project-filter";

/** Browse prefix of a Project: its folder under the Team Drive root, the default Project's included. */
export function docsProjectPathPrefix(project: Pick<WorkspaceProject, "resources">): string | null {
  const apiPath = project.resources.driveFolderPath;
  return apiPath ? apiPath.replace(/^\/+|\/+$/g, "") : null;
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
  const teamSlug = teamSlugOfFilter(filter);
  // A Team filter shows the whole Team Drive (everything of the Team); a Project, its own folder.
  const prefix = project
    ? docsProjectPathPrefix(project)
    : teamSlug !== null
      ? `groups/${teamSlug}`
      : null;
  const label = project
    ? project.name
    : (drives.find((drive) => drive.pathPrefix?.toLowerCase() === prefix?.toLowerCase())?.label ??
      teamSlug ??
      "");

  const scoped = useMemo(
    () => (prefix ? [{ key: prefix, label, pathPrefix: prefix }] : drives),
    [drives, label, prefix],
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
