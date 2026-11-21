import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Plus, Users } from "lucide-react";
import type { SettingsGroup } from "@/lib/models/settings-types";
import { Tag } from "@/tag/src/tag";
import { Button } from "@/button/src/button";
import { FORM_AUTOSAVE_DELAY_MS } from "@/hooks/use-form-autosave";
import { useAppToast } from "@/hooks/use-app-toast";
import { TASK_LIST_DOT_COLORS } from "@/lib/models/task-lists";
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
import { CreateProjectDialog } from "@/projects-ui/src/create-project-dialog";
import { PurgeProjectDialog } from "@/projects-ui/src/purge-project-dialog";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { useTrackAutosave } from "@/ui/autosave-status";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import { Input } from "@/ui/input";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";
import { NO_AUTOFILL } from "@/ui/no-autofill";
import { SwatchColorPicker } from "@/ui/swatch-color-picker";
import "./settings-projects-pane.css";

type Track = ReturnType<typeof useTrackAutosave>;

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

/** Name and color of one Project, saved as they change: color at once, name after a pause. */
function EditableProjectHead({
  project,
  store,
  track,
  onFailure,
}: {
  project: WorkspaceProject;
  store: ProjectsStore;
  track: Track;
  onFailure: (error: unknown) => void;
}) {
  const [name, setName] = useState(project.name);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ name, project });
  latest.current = { name, project };

  // A change from elsewhere (a reload, another tab) replaces the field.
  useEffect(() => setName(project.name), [project.name]);

  const save = useCallback(
    (patch: { name?: string; color?: string }) =>
      track(() => store.patch(project.id, patch)).catch((error) => {
        if (patch.name !== undefined) setName(latest.current.project.name);
        onFailure(error);
      }),
    [onFailure, project.id, store, track],
  );

  const saveName = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = latest.current.name.trim();
    if (next === "") {
      setName(latest.current.project.name);
      return;
    }
    if (next !== latest.current.project.name) void save({ name: next });
  }, [save]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const color = project.color ?? TASK_LIST_DOT_COLORS[0] ?? "#3b82f6";
  return (
    <NameColorRow className="projects-manage-row__head">
      <Input
        {...NO_AUTOFILL}
        className={NAME_COLOR_ROW_INPUT_CLASS}
        aria-label={labels.nameOf(project.name)}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(saveName, FORM_AUTOSAVE_DELAY_MS);
        }}
        onBlur={saveName}
        onKeyDown={(event) => {
          if (event.key === "Enter") saveName();
        }}
      />
      <SwatchColorPicker
        value={color}
        onChange={(next) => void save({ color: next })}
        colorLabel={labels.colorOf(project.name)}
        swatches={TASK_LIST_DOT_COLORS}
      >
        <ColorSwatchTrigger
          color={color}
          label={labels.colorOf(project.name)}
          aria-haspopup="dialog"
        />
      </SwatchColorPicker>
    </NameColorRow>
  );
}

function ProjectRow({
  project,
  canManage,
  store,
  track,
  onFailure,
  onAction,
  onPurgeRequest,
}: {
  project: WorkspaceProject;
  canManage: boolean;
  store: ProjectsStore;
  track: Track;
  onFailure: (error: unknown) => void;
  onAction: (work: () => Promise<unknown>, success: string, failure: string) => Promise<void>;
  onPurgeRequest: (project: WorkspaceProject) => void;
}) {
  const archived = project.archived;
  const [editing, setEditing] = useState(false);
  return (
    <li className="projects-manage-row">
      <div className="projects-manage-row__main">
        {canManage && !archived && editing ? (
          <EditableProjectHead
            project={project}
            store={store}
            track={track}
            onFailure={onFailure}
          />
        ) : (
          <span className="projects-manage-row__head projects-manage-row__static">
            <ProjectDot color={project.color} />
            <span className="projects-manage-row__name">{project.name}</span>
            {project.isDefault ? <Tag label={labels.defaultTag} /> : null}
          </span>
        )}
      </div>
      {canManage && !archived ? (
        <Button
          type="button"
          variant="ghost"
          label={editing ? labels.done : labels.edit}
          onClick={() => setEditing((value) => !value)}
        />
      ) : null}
      {canManage && !project.isDefault && !archived ? (
        <Button
          type="button"
          variant="ghost"
          label={labels.archive}
          onClick={() =>
            void onAction(
              () => store.archive(project.id),
              labels.archived(project.name),
              labels.archiveFailed,
            )
          }
        />
      ) : null}
      {canManage && archived ? (
        <>
          <Button
            type="button"
            variant="outline"
            label={labels.restore}
            onClick={() =>
              void onAction(
                () => store.unarchive(project.id),
                labels.restored(project.name),
                labels.restoreFailed,
              )
            }
          />
          <Button
            type="button"
            variant="destructive-outline"
            label={labels.purge}
            onClick={() => onPurgeRequest(project)}
          />
        </>
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
}: {
  store?: ProjectsStore;
  /** The Teams the user is in; a Team without Projects (yet) still shows. */
  groups: readonly SettingsGroup[];
}) {
  const snapshot = useProjects(store);
  const toast = useAppToast();
  const track = useTrackAutosave();
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
  const archived = archivedProjectsByTeam(snapshot);
  const loading = snapshot.status === "idle" || snapshot.status === "loading";

  const renderRows = (projects: readonly WorkspaceProject[]) => (
    <ul className="projects-manage-list">
      {projects.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          canManage={project.mayManage && adminSlugs.has(project.teamSlug)}
          store={store}
          track={track}
          onFailure={(error) => fail(labels.saveFailed, error)}
          onAction={onAction}
          onPurgeRequest={setPurging}
        />
      ))}
    </ul>
  );

  return (
    <>
      {!loading && snapshot.status === "error" ? (
        <p className="projects-manage-hint">{labels.loadFailed}</p>
      ) : null}
      <div className="projects-manage-teams">
        {groups.map((group) => {
          const slug = teamSlugOf(group);
          const projects = activeByTeam.get(slug)?.projects ?? [];
          return (
            <SettingsPaneCard
              key={group.id}
              title={group.displayName}
              icon={<Users className="size-3.5" aria-hidden />}
              titleTag={<Tag label={group.isTeamAdmin ? "Admin" : "Member"} />}
              action={
                <span className="projects-manage-team-tags">
                  {group.isTeamAdmin ? <Tag label={memberCountLabel(group.memberCount)} /> : null}
                  {group.isTeamAdmin && snapshot.status === "ready" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      label={labels.newProject}
                      icon={<Plus className="size-3.5" aria-hidden />}
                      onClick={() =>
                        setCreatingIn({
                          slug,
                          displayName: group.displayName,
                          isTeamAdmin: true,
                        })
                      }
                    />
                  ) : null}
                </span>
              }
            >
              {projects.length > 0 ? renderRows(projects) : null}
            </SettingsPaneCard>
          );
        })}
      </div>
      {groups.some((g) => !g.isTeamAdmin) ? (
        <p className="projects-manage-hint">{labels.readOnlyHint}</p>
      ) : null}
      {archived.length > 0 ? (
        <SettingsPaneCard title={labels.archivedGroup}>
          {archived.map(({ team, projects }) => (
            <div key={team.slug} className="projects-manage-archived-team">
              <p className="projects-manage-archived-team__name">{team.displayName}</p>
              {renderRows(projects)}
            </div>
          ))}
        </SettingsPaneCard>
      ) : null}
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
      <PurgeProjectDialog
        projectName={purging?.name ?? null}
        onOpenChange={(open) => {
          if (!open) setPurging(null);
        }}
        onPurge={async () => {
          if (!purging) return false;
          const target = purging;
          try {
            await track(() => store.purge(target.id));
            toast.showSuccess(labels.purged(target.name));
            return true;
          } catch (error) {
            fail(labels.purgeFailed, error);
            return false;
          }
        }}
      />
    </>
  );
}
