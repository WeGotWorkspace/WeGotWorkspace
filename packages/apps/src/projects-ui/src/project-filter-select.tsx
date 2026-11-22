import { Fragment, type CSSProperties } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, FolderKanban, Settings2 } from "lucide-react";
import { useOpenSettingsPanel } from "@/lib/settings/open-settings-panel";
import { projectFilterValue, type ProjectFilterValue } from "@/lib/projects/project-filter";
import { selectedProject } from "@/lib/projects/project-match";
import {
  projectsByTeam,
  projectsStore,
  useProjects,
  type ProjectsStore,
} from "@/lib/projects/projects-store";
import { useProjectFilter } from "@/lib/projects/use-project-filter";
import { projectsLabels as labels } from "@/projects-ui/src/projects-labels";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from "@/ui/select";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import "./project-filter-select.css";

const MANAGE_VALUE = "__manage";

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
 * then each Team with "All" (its default Project) and its other Projects, then "Manage Projects" for a
 * team admin. Renders nothing until the Projects have loaded (mock data, Storybook).
 */
export function ProjectFilterSelect({ store = projectsStore() }: { store?: ProjectsStore }) {
  const snapshot = useProjects(store);
  const [filter, setFilter] = useProjectFilter(store);
  const openSettingsPanel = useOpenSettingsPanel();

  if (snapshot.status !== "ready" && snapshot.status !== "offline") return null;

  const groups = projectsByTeam(snapshot);
  const adminTeams = snapshot.teams.filter((team) => team.isTeamAdmin);
  const current = selectedProject(filter, snapshot.projects);
  const canManage = adminTeams.length > 0 && openSettingsPanel !== null;

  return (
    <>
      <Select
        value={filter}
        onValueChange={(next) => {
          if (next === MANAGE_VALUE) openSettingsPanel?.("memberships");
          else setFilter(next as ProjectFilterValue);
        }}
      >
        <SelectPrimitive.Trigger
          aria-label={labels.filterLabel}
          className="project-filter-trigger"
          style={
            current?.color
              ? ({ "--project-filter-color": current.color } as CSSProperties)
              : undefined
          }
        >
          <UserAvatar
            displayName={labels.filterLabel}
            compact
            ariaLabel={labels.filterLabel}
            fallback={<FolderKanban className="project-filter-trigger__icon" aria-hidden />}
            className="project-filter-trigger__mark"
          />
          <span className="project-filter-trigger__label">
            {current
              ? current.isDefault
                ? labels.teamAll(current.teamName)
                : current.name
              : labels.allProjects}
          </span>
          <ChevronDown className="project-filter-trigger__chevron" aria-hidden />
        </SelectPrimitive.Trigger>
        <SelectContent className="project-filter-select__menu">
          <SelectItem value="all">{labels.allProjects}</SelectItem>
          {groups.map(({ team, projects }) => (
            <Fragment key={team.slug}>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="project-filter-select__team">
                  {team.displayName}
                </SelectLabel>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={projectFilterValue(project.id)}>
                    <span className="project-filter-select__item">
                      <ProjectDot color={project.color} />
                      {project.isDefault ? labels.allOfTeam : project.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </Fragment>
          ))}
          {canManage ? <SelectSeparator /> : null}
          {canManage ? (
            <SelectItem value={MANAGE_VALUE}>
              <span className="project-filter-select__item">
                <Settings2 className="project-filter-select__icon" aria-hidden />
                {labels.manageProjects}
              </span>
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </>
  );
}
