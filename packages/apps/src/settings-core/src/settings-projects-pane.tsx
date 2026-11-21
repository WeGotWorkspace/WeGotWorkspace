import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { FolderKanban } from "lucide-react";
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
import { projectsLabels as labels } from "@/projects-ui/src/projects-labels";
import { PurgeProjectDialog } from "@/projects-ui/src/purge-project-dialog";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { Tag } from "@/tag/src/tag";
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
  return (
    <li className="projects-manage-row">
      {canManage && !archived ? (
        <EditableProjectHead project={project} store={store} track={track} onFailure={onFailure} />
      ) : (
        <span className="projects-manage-row__head projects-manage-row__static">
          <ProjectDot color={project.color} />
          <span className="projects-manage-row__name">{project.name}</span>
        </span>
      )}
      {project.isDefault ? <Tag label={labels.defaultTag} /> : null}
      {canManage && !project.isDefault && !archived ? (
        <Button
          type="button"
          variant="outline"
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
export function ProjectsManagePane({ store = projectsStore() }: { store?: ProjectsStore }) {
  const snapshot = useProjects(store);
  const toast = useAppToast();
  const track = useTrackAutosave();
  const [purging, setPurging] = useState<WorkspaceProject | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

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

  const adminSlugs = new Set(snapshot.teams.filter((team) => team.isTeamAdmin).map((t) => t.slug));
  const active = projectsByTeam(snapshot);
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

  if (!loading && (snapshot.status === "error" || loadFailed) && active.length === 0) {
    return (
      <SettingsPaneCard>
        <p className="settings-memberships-pane__empty">{labels.loadFailed}</p>
      </SettingsPaneCard>
    );
  }

  return (
    <>
      {!loading && active.length === 0 && archived.length === 0 ? (
        <SettingsPaneCard>
          <p className="settings-memberships-pane__empty">{labels.emptyState}</p>
        </SettingsPaneCard>
      ) : null}
      {active.map(({ team, projects }) => (
        <SettingsPaneCard
          key={team.slug}
          title={team.displayName}
          icon={<FolderKanban className="size-3.5" aria-hidden />}
        >
          {renderRows(projects)}
          {team.isTeamAdmin ? null : (
            <p className="settings-memberships-pane__empty">{labels.readOnlyHint}</p>
          )}
        </SettingsPaneCard>
      ))}
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
