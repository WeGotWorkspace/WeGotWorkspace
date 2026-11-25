import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { EllipsisVertical } from "lucide-react";
import type { SettingsGroup } from "@/lib/models/settings-types";
import { Tag } from "@/tag/src/tag";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { useAppToast } from "@/hooks/use-app-toast";
import {
  archivedProjectsByTeam,
  projectsByTeam,
  projectsStore,
  useProjects,
  type ProjectsStore,
  type WorkspaceProject,
} from "@/lib/projects/projects-store";
import type { ProjectTeam } from "@/lib/api/wgw/projects";
import { projectsLabels as labels } from "@/projects-ui/src/projects-labels";
import { PurgeProjectDialog } from "@/projects-ui/src/purge-project-dialog";
import { EditProjectDialog } from "@/projects-ui/src/edit-project-dialog";
import { CreateProjectDialog } from "@/projects-ui/src/create-project-dialog";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { useTrackAutosave } from "@/ui/autosave-status";
import "./settings-projects-pane.css";

function errorDescription(error: unknown): { description?: string } {
  return { description: error instanceof Error ? error.message : undefined };
}

function teamSlugOf(group: SettingsGroup): string {
  return group.id.split("/").pop() ?? group.id;
}

function memberCountLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

function ProjectDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="projects-manage-row__dot"
      style={color ? ({ "--projects-manage-color": color } as CSSProperties) : undefined}
    />
  );
}

function ProjectRow({
  project,
  canManage,
  store,
  onAction,
  onArchiveRequest,
  onEditRequest,
  onPurgeRequest,
}: {
  project: WorkspaceProject;
  canManage: boolean;
  store: ProjectsStore;
  onAction: (work: () => Promise<unknown>, success: string, failure: string) => Promise<void>;
  onArchiveRequest: (project: WorkspaceProject) => void;
  onEditRequest: (project: WorkspaceProject) => void;
  onPurgeRequest: (project: WorkspaceProject) => void;
}) {
  const archived = project.archived;
  return (
    <li className="projects-manage-row">
      <div className="projects-manage-row__main">
        <span className="projects-manage-row__head projects-manage-row__static">
          <ProjectDot color={project.color} />
          <span className="projects-manage-row__name">{project.name}</span>
          {project.isDefault ? <Tag label={labels.defaultTag} /> : null}
          {archived ? <Tag label={labels.archivedTag} tone="warning" /> : null}
        </span>
      </div>
      {canManage && !archived ? (
        <Button
          type="button"
          variant="ghost"
          label={labels.edit}
          onClick={() => onEditRequest(project)}
        />
      ) : null}
      {canManage && (archived || !project.isDefault) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              type="button"
              variant="ghost"
              label={`${labels.moreOptions}: ${project.name}`}
              icon={<EllipsisVertical aria-hidden />}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {archived ? (
              <>
                <DropdownMenuItem
                  onSelect={() =>
                    void onAction(
                      () => store.unarchive(project.id),
                      labels.restored(project.name),
                      labels.restoreFailed,
                    )
                  }
                >
                  {labels.restore}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="menu-item--severity-danger menu-item--interactive"
                  onSelect={() => onPurgeRequest(project)}
                >
                  {labels.purge}
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                className="menu-item--severity-danger menu-item--interactive"
                onSelect={() => onArchiveRequest(project)}
              >
                {labels.archive}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

/**
 * Settings panel "Projects" (#818): the caller's Projects per Team, archived ones in a
 * group of their own. Team admins rename and recolor (autosaved), archive, restore and
 * delete; other members see the list. A refused action shows the server's answer and
 * reads the lists again, so a Project that changed elsewhere shows as it is.
 */
export function ProjectsManagePane({
  store = projectsStore(),
  groups,
  memberCounts = {},
  onManageMembers,
}: {
  store?: ProjectsStore;
  /** The Teams the user is in; a Team without Projects (yet) still shows. */
  groups: readonly SettingsGroup[];
  /** Counts after a change in the members dialog, by Team id. */
  memberCounts?: Readonly<Record<string, number>>;
  /** Opens the members dialog of a Team the user runs. */
  onManageMembers?: (group: SettingsGroup) => void;
}) {
  const snapshot = useProjects(store);
  const toast = useAppToast();
  const track = useTrackAutosave();
  const [archiving, setArchiving] = useState<WorkspaceProject | null>(null);
  const [editing, setEditing] = useState<WorkspaceProject | null>(null);
  const [purging, setPurging] = useState<WorkspaceProject | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creatingIn, setCreatingIn] = useState<ProjectTeam | null>(null);

  const reload = useCallback(async () => {
    const [active, archived] = await Promise.all([store.load(), store.loadArchived()]);
    setLoadFailed(!active || !archived);
  }, [store]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const fail = useCallback(
    (title: string, error: unknown) => {
      toast.showError(title, errorDescription(error));
      void reload();
    },
    [reload, toast],
  );

  const onAction = useCallback(
    async (work: () => Promise<unknown>, success: string, failure: string) => {
      try {
        await track(work);
        toast.showSuccess(success);
      } catch (error) {
        fail(failure, error);
      }
    },
    [fail, toast, track],
  );

  const adminSlugs = new Set(groups.filter((g) => g.isTeamAdmin).map(teamSlugOf));
  const activeByTeam = new Map(projectsByTeam(snapshot).map((entry) => [entry.team.slug, entry]));
  const archivedByTeam = new Map(
    archivedProjectsByTeam(snapshot).map((entry) => [entry.team.slug, entry.projects]),
  );
  const loading = snapshot.status === "idle" || snapshot.status === "loading";

  const renderRows = (projects: readonly WorkspaceProject[]) => (
    <ul className="projects-manage-list">
      {projects.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          canManage={project.mayManage && adminSlugs.has(project.teamSlug)}
          store={store}
          onAction={onAction}
          onArchiveRequest={setArchiving}
          onEditRequest={setEditing}
          onPurgeRequest={setPurging}
        />
      ))}
    </ul>
  );

  return (
    <>
      {!loading && (snapshot.status === "error" || loadFailed) ? (
        <p className="projects-manage-hint">{labels.loadFailed}</p>
      ) : null}
      <div className="projects-manage-teams">
        {groups.map((group) => {
          const slug = teamSlugOf(group);
          const projects = [
            ...(activeByTeam.get(slug)?.projects ?? []),
            ...(archivedByTeam.get(slug) ?? []),
          ];
          return (
            <SettingsPaneCard
              key={group.id}
              title={group.displayName}
              titleTag={
                <span className="projects-manage-team-tags">
                  <Tag
                    label={memberCountLabel(memberCounts[group.id] ?? group.memberCount)}
                    tone="pending"
                  />
                </span>
              }
              action={
                group.isTeamAdmin ? (
                  <span className="projects-manage-team-actions">
                    {onManageMembers || snapshot.status === "ready" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            type="button"
                            variant="ghost"
                            label={`${labels.moreOptions}: ${group.displayName}`}
                            icon={<EllipsisVertical aria-hidden />}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {snapshot.status === "ready" ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                setCreatingIn({
                                  slug,
                                  displayName: group.displayName,
                                  isTeamAdmin: true,
                                })
                              }
                            >
                              {labels.newProject}
                            </DropdownMenuItem>
                          ) : null}
                          {onManageMembers ? (
                            <DropdownMenuItem onSelect={() => onManageMembers(group)}>
                              {labels.edit}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </span>
                ) : null
              }
            >
              {projects.length > 0 ? renderRows(projects) : null}
            </SettingsPaneCard>
          );
        })}
      </div>
      <EditProjectDialog
        project={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSave={async (project, input) => {
          try {
            await track(() => store.patch(project.id, input));
            return true;
          } catch (error) {
            fail(labels.saveFailed, error);
            return false;
          }
        }}
      />
      <AlertDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.archiveTitle(archiving?.name ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>{labels.archiveDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="outline"
                severity="danger"
                onClick={() => {
                  const target = archiving;
                  setArchiving(null);
                  if (target) {
                    void onAction(
                      () => store.archive(target.id),
                      labels.archived(target.name),
                      labels.archiveFailed,
                    );
                  }
                }}
              >
                {labels.archive}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PurgeProjectDialog
        projectName={purging?.name ?? null}
        onOpenChange={(open) => {
          if (!open) setPurging(null);
        }}
        onPurge={async () => {
          const target = purging;
          if (!target) return false;
          try {
            await track(() => store.purge(target.id));
            toast.showSuccess(labels.purged(target.name));
            return true;
          } catch (error) {
            setPurging(null);
            fail(labels.purgeFailed, error);
            return false;
          }
        }}
      />
      <CreateProjectDialog
        open={creatingIn !== null}
        teams={creatingIn ? [creatingIn] : []}
        onOpenChange={(open) => {
          if (!open) setCreatingIn(null);
        }}
        onCreate={async (input) => {
          try {
            const created = await track(() => store.create(input));
            toast.showSuccess(labels.created(created.name));
            return true;
          } catch (error) {
            fail(labels.createFailed, error);
            return false;
          }
        }}
      />
    </>
  );
}
