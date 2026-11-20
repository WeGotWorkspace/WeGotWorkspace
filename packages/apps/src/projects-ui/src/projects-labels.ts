/** Copy for the Project filter and the Create Project dialog (#818). */
export const projectsLabels = {
  filterLabel: "Project",
  allProjects: "All Projects",
  createProject: "Create Project",
  createTitle: "Create Project",
  createDescription: "A Project gets its own calendar, task list, notebook, channel and folder.",
  nameLabel: "Name",
  colorLabel: "Color",
  teamLabel: "Team",
  create: "Create",
  cancel: "Cancel",
  created: (name: string) => `Project “${name}” created`,
  createFailed: "Could not create the Project",
} as const;
