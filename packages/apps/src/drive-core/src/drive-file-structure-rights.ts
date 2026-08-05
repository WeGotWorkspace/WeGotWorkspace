/**
 * Whether rename / move / delete should appear for a file.
 * Full access = `myRights.mayManageStructure`.
 * Unknown (`undefined`) stays allowed for Storybook / listings without rights.
 */
export function resolveDriveFileCanManageStructure(
  fileMayManageStructure: boolean | undefined,
  options?: {
    isActive?: boolean;
    activeMayManageStructure?: boolean;
  },
): boolean {
  const resolved = options?.isActive
    ? (options.activeMayManageStructure ?? fileMayManageStructure)
    : fileMayManageStructure;
  return resolved !== false;
}
