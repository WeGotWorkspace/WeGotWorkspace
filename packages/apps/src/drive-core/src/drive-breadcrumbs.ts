import type { PathBreadcrumbItem } from "@/path-breadcrumb/src/path-breadcrumb";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";

const GROUPS_ROOT = "Groups";

/** Virtual root in the move-to folder picker (lists My Drive and shared drives). */
export const DRIVE_FOLDER_PICKER_ROOT = "";

export function isDriveSharedGroupPath(path: string): boolean {
  return path === GROUPS_ROOT || path.startsWith(`${GROUPS_ROOT}/`);
}

export function buildDriveFolderBreadcrumbs(
  viewPath: string,
  labels: Pick<DriveUILabels, "sidebarMyDrive" | "sidebarSharedDrives">,
): PathBreadcrumbItem[] {
  if (viewPath === GROUPS_ROOT) {
    return [{ label: labels.sidebarSharedDrives, path: null }];
  }

  if (viewPath.startsWith(`${GROUPS_ROOT}/`)) {
    const relativeParts = viewPath.slice(`${GROUPS_ROOT}/`.length).split("/").filter(Boolean);
    return relativeParts.map((segment, index) => ({
      label: segment,
      path: `${GROUPS_ROOT}/${relativeParts.slice(0, index + 1).join("/")}`,
    }));
  }

  if (viewPath === "My Drive") {
    return [{ label: labels.sidebarMyDrive, path: "My Drive" }];
  }

  if (viewPath.startsWith("My Drive/")) {
    const relativeParts = viewPath.slice("My Drive/".length).split("/").filter(Boolean);
    return [
      { label: labels.sidebarMyDrive, path: "My Drive" },
      ...relativeParts.map((segment, index) => ({
        label: segment,
        path: `My Drive/${relativeParts.slice(0, index + 1).join("/")}`,
      })),
    ];
  }

  const parts = viewPath.split("/").filter(Boolean);
  return parts.map((segment, index) => ({
    label: segment,
    path: parts.slice(0, index + 1).join("/"),
  }));
}

export function buildDriveFolderPickerBreadcrumbs(
  browsePath: string,
  labels: Pick<DriveUILabels, "folderPickerDrivesRoot" | "sidebarMyDrive">,
  /** Optional UI-path → display label (e.g. Docs "Personal" / principal group names). */
  rootLabels?: Readonly<Record<string, string>>,
): PathBreadcrumbItem[] {
  const myDriveLabel = rootLabels?.["My Drive"] ?? labels.sidebarMyDrive;

  if (browsePath === DRIVE_FOLDER_PICKER_ROOT) {
    return [{ label: labels.folderPickerDrivesRoot, path: DRIVE_FOLDER_PICKER_ROOT }];
  }

  const drivesRoot: PathBreadcrumbItem = {
    label: labels.folderPickerDrivesRoot,
    path: DRIVE_FOLDER_PICKER_ROOT,
  };

  if (browsePath === "My Drive") {
    return [drivesRoot, { label: myDriveLabel, path: "My Drive" }];
  }

  if (browsePath.startsWith("My Drive/")) {
    const relativeParts = browsePath.slice("My Drive/".length).split("/").filter(Boolean);
    return [
      drivesRoot,
      { label: myDriveLabel, path: "My Drive" },
      ...relativeParts.map((segment, index) => ({
        label: segment,
        path: `My Drive/${relativeParts.slice(0, index + 1).join("/")}`,
      })),
    ];
  }

  if (browsePath.startsWith(`${GROUPS_ROOT}/`)) {
    const relativeParts = browsePath.slice(`${GROUPS_ROOT}/`.length).split("/").filter(Boolean);
    return [
      drivesRoot,
      ...relativeParts.map((segment, index) => {
        const path = `${GROUPS_ROOT}/${relativeParts.slice(0, index + 1).join("/")}`;
        const label = index === 0 ? (rootLabels?.[path] ?? segment) : segment;
        return { label, path };
      }),
    ];
  }

  const parts = browsePath.split("/").filter(Boolean);
  return [
    drivesRoot,
    ...parts.map((segment, index) => ({
      label: segment,
      path: parts.slice(0, index + 1).join("/"),
    })),
  ];
}
