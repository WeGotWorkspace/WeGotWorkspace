/** Where project things live: Team folders in Drive, one subfolder per project. */
export const teamRoot = (team) => `/groups/${team}`;
export const projectFolder = (world, projectId) => {
  const p = world.projects.find((x) => x.id === projectId);
  return `${teamRoot(p.team)}/${p.name}`;
};
/** WebDAV URL for a Drive path (each segment encoded). */
export const davUrl = (origin, drivePath) => `${origin}/files${drivePath.split("/").map(encodeURIComponent).join("/")}`;
export const parentOf = (path) => path.slice(0, path.lastIndexOf("/"));
export const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);
