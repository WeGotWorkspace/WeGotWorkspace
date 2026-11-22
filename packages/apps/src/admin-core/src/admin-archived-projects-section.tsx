import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { FolderArchive } from "lucide-react";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { Button } from "@/button/src/button";
import { Tag } from "@/tag/src/tag";
import { useAppToast } from "@/hooks/use-app-toast";
import { projectsLabels as labels } from "@/projects-ui/src/projects-labels";
import { PurgeProjectDialog } from "@/projects-ui/src/purge-project-dialog";
import { formatHumanDateTime } from "@/admin-core/src/admin-workspace-utils";
import type {
  AdminArchivedProject,
  AdminProjectOperations,
} from "@/admin-core/src/admin-projects-operations";

export const adminProjectsLabels = {
  title: "Archived Projects",
  empty: "No archived Projects",
  loadFailed: "Could not load the archived Projects",
  archivedOn: (date: string) => `Archived ${date}`,
} as const;

function errorDescription(error: unknown): { description?: string } {
  return { description: error instanceof Error ? error.message : undefined };
}

function ProjectDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="admin-project-dot"
      style={color ? ({ "--admin-project-color": color } as CSSProperties) : undefined}
    />
  );
}

/**
 * The archived Projects of every Team, under Teams on Users & Teams (#810). A team admin
 * archives; only an organization admin deletes one for good, after typing its name. A
 * refused delete shows the server's answer and reads the list again.
 */
export function AdminArchivedProjectsSection({
  operations,
}: {
  operations?: AdminProjectOperations;
}) {
  const { showSuccess, showError } = useAppToast();
  const [projects, setProjects] = useState<AdminArchivedProject[] | null>(null);
  const [purging, setPurging] = useState<AdminArchivedProject | null>(null);

  const reload = useCallback(async () => {
    if (!operations) return;
    try {
      setProjects(await operations.listArchived());
    } catch (error) {
      setProjects((current) => current ?? []);
      showError(adminProjectsLabels.loadFailed, errorDescription(error));
    }
  }, [operations, showError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const purge = async (project: AdminArchivedProject): Promise<boolean> => {
    if (!operations) return false;
    try {
      await operations.purge(project.id);
      setProjects((current) => (current ?? []).filter((entry) => entry.id !== project.id));
      showSuccess(labels.purged(project.name));
      return true;
    } catch (error) {
      showError(labels.purgeFailed, errorDescription(error));
      setPurging(null);
      void reload();
      return false;
    }
  };

  if (!operations || projects === null) return null;

  return (
    <WorkspacePageSection title={adminProjectsLabels.title} icon={<FolderArchive aria-hidden />}>
      {projects.length === 0 ? (
        <p className="workspace-page-section__lead">{adminProjectsLabels.empty}</p>
      ) : (
        <ul className="admin-divided-list">
          {projects.map((project) => (
            <li key={project.id} className="admin-list-row">
              <div className="admin-project-row__main">
                <span className="admin-project-row__head">
                  <ProjectDot color={project.color} />
                  <span className="admin-project-row__name">{project.name}</span>
                  <Tag label={labels.archivedTag} tone="warning" />
                </span>
                <span className="admin-project-row__meta">
                  {project.teamName}
                  {project.archivedAt
                    ? ` · ${adminProjectsLabels.archivedOn(formatHumanDateTime(project.archivedAt))}`
                    : ""}
                </span>
              </div>
              <div className="admin-list-row__actions">
                <Button
                  type="button"
                  variant="ghost"
                  severity="danger"
                  label={labels.purge}
                  aria-label={`${labels.purge}: ${project.name}`}
                  onClick={() => setPurging(project)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <PurgeProjectDialog
        projectName={purging?.name ?? null}
        onOpenChange={(open) => {
          if (!open) setPurging(null);
        }}
        onPurge={() => (purging ? purge(purging) : Promise.resolve(false))}
      />
    </WorkspacePageSection>
  );
}
