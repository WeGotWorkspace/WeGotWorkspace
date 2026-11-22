import { Fragment, type CSSProperties } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, FolderKanban, LayoutGrid, Settings2 } from "lucide-react";
import { useOpenSettingsPanel } from "@/lib/settings/open-settings-panel";
import {
  projectFilterValue,
  teamFilterValue,
  teamSlugOfFilter,
  type ProjectFilterValue,
} from "@/lib/projects/project-filter";
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
import { Tag } from "@/tag/src/tag";
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
 * then each Team with "All" (everything of the Team), its default Project by name when it has other Projects too, and those Projects, then "Manage Projects" for a
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
  const currentTeam = snapshot.teams.find((team) => team.slug === teamSlugOfFilter(filter));
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
              ? current.name
              : currentTeam
                ? labels.teamAll(currentTeam.displayName)
                : labels.allProjects}
          </span>
          <ChevronDown className="project-filter-trigger__chevron" aria-hidden />
        </SelectPrimitive.Trigger>
        <SelectContent className="project-filter-select__menu">
          <SelectItem value="all">{labels.allProjects}</SelectItem>
          {groups.map(({ team, projects }) => (
            <Fragment key={team.slug}>
              <SelectSeparator className="project-filter-select__separator" />
              <SelectGroup className="project-filter-select__group">
                <SelectLabel className="project-filter-select__team">
                  {team.displayName}
                </SelectLabel>
                <SelectItem value={teamFilterValue(team.slug)}>
                  <span className="project-filter-select__item">
                    <LayoutGrid className="project-filter-select__icon" aria-hidden />
                    <span className="project-filter-select__all">{labels.allOfTeam}</span>
                  </span>
                </SelectItem>
                {/* A Team with only its default Project: "All" is that Project already. */}
                {projects
                  .filter((project) => projects.length > 1 || !project.isDefault)
                  .map((project) => (
                    <SelectItem key={project.id} value={projectFilterValue(project.id)}>
                      <span className="project-filter-select__item">
                        <ProjectDot color={project.color} />
                        <span className="project-filter-select__name">{project.name}</span>
                        {project.isDefault ? <Tag label={labels.defaultTag} /> : null}
                      </span>
                    </SelectItem>
                  ))}
              </SelectGroup>
            </Fragment>
          ))}
          {canManage ? <SelectSeparator className="project-filter-select__separator" /> : null}
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
