import { Fragment, useState, type CSSProperties } from "react";
import { FolderKanban, Plus } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { projectFilterValue, type ProjectFilterValue } from "@/lib/projects/project-filter";
import { selectedProject } from "@/lib/projects/project-match";
import {
  projectsByTeam,
  projectsStore,
  useProjects,
  type ProjectsStore,
} from "@/lib/projects/projects-store";
import { useProjectFilter } from "@/lib/projects/use-project-filter";
import { CreateProjectDialog } from "@/projects-ui/src/create-project-dialog";
import { projectsLabels as labels } from "@/projects-ui/src/projects-labels";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from "@/ui/select";
import "./project-filter-select.css";

const CREATE_VALUE = "__create";

function ProjectDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="project-filter-select__dot"
      style={color ? ({ "--collection-row-color": color } as CSSProperties) : undefined}
    />
  );
}

/**
 * The suite's Project filter (#818), at the foot of every app sidebar: "All Projects",
 * then each Team's Projects (its default Project first), then "Create Project" for a
 * team admin. Renders nothing until the Projects have loaded (mock data, Storybook).
 */
export function ProjectFilterSelect({ store = projectsStore() }: { store?: ProjectsStore }) {
  const snapshot = useProjects(store);
  const [filter, setFilter] = useProjectFilter(store);
  const [createOpen, setCreateOpen] = useState(false);
  const toast = useAppToast();

  if (snapshot.status !== "ready" && snapshot.status !== "offline") return null;

  const groups = projectsByTeam(snapshot);
  const adminTeams = snapshot.teams.filter((team) => team.isTeamAdmin);
  const current = selectedProject(filter, snapshot.projects);
  const canCreate = adminTeams.length > 0 && snapshot.status === "ready";

  return (
    <>
      <Select
        value={filter}
        onValueChange={(next) => {
          if (next === CREATE_VALUE) setCreateOpen(true);
          else setFilter(next as ProjectFilterValue);
        }}
      >
        <CollectionGhostSelectTrigger
          aria-label={labels.filterLabel}
          className="project-filter-select"
          style={
            current?.color
              ? ({ "--collection-row-color": current.color } as CSSProperties)
              : undefined
          }
          leading={
            current ? (
              <ProjectDot color={current.color} />
            ) : (
              <FolderKanban className="project-filter-select__icon" aria-hidden />
            )
          }
          label={current ? current.name : labels.allProjects}
        />
        <SelectContent className="collection-ghost-select__menu">
          <SelectItem value="all">{labels.allProjects}</SelectItem>
          {groups.map(({ team, projects }) => (
            <Fragment key={team.slug}>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{team.displayName}</SelectLabel>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={projectFilterValue(project.id)}>
                    <span className="project-filter-select__item">
                      <ProjectDot color={project.color} />
                      {project.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </Fragment>
          ))}
          {canCreate ? (
            <>
              <SelectSeparator />
              <SelectItem value={CREATE_VALUE}>
                <span className="project-filter-select__item">
                  <Plus className="project-filter-select__icon" aria-hidden />
                  {labels.createProject}
                </span>
              </SelectItem>
            </>
          ) : null}
        </SelectContent>
      </Select>
      <CreateProjectDialog
        open={createOpen}
        teams={adminTeams}
        onOpenChange={setCreateOpen}
        onCreate={async (input) => {
          try {
            const created = await store.create(input);
            setFilter(projectFilterValue(created.id));
            toast.showSuccess(labels.created(created.name));
            return true;
          } catch (error) {
            toast.showError(labels.createFailed, {
              description: error instanceof Error ? error.message : undefined,
            });
            return false;
          }
        }}
      />
    </>
  );
}
