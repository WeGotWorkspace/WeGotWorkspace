import type { PathBreadcrumbItem } from "@/path-breadcrumb/src/path-breadcrumb";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { ViewKey } from "@/lib/files/drive-models";
import { DRIVE_GROUPS_UI_ROOT as GROUPS_ROOT } from "@/lib/files/drive-path-utils";

/** Virtual root in the move-to folder picker (lists My Drive and shared drives). */
export const DRIVE_FOLDER_PICKER_ROOT = "";

export function isDriveSharedGroupPath(path: string): boolean {
  return path === GROUPS_ROOT || path.startsWith(`${GROUPS_ROOT}/`);
}

type DriveViewBreadcrumbLabels = Pick<
  DriveUILabels,
  | "accessTitle"
  | "sidebarHome"
  | "sidebarMyDrive"
  | "sidebarRecent"
  | "sidebarSharedWithMe"
  | "sidebarStarred"
  | "sidebarUploads"
  | "teamsRoot"
>;

/** Breadcrumbs of any Drive view. A view without folders gets its own title. */
export function buildDriveViewBreadcrumbs(
  view: ViewKey,
  labels: DriveViewBreadcrumbLabels,
  rootLabels?: Readonly<Record<string, string>>,
): PathBreadcrumbItem[] {
  if (view.type === "folder") return buildDriveFolderBreadcrumbs(view.path, labels, rootLabels);
  const titles: Record<Exclude<ViewKey["type"], "folder">, string> = {
    all: labels.sidebarHome,
    access: labels.accessTitle,
    recent: labels.sidebarRecent,
    starred: labels.sidebarStarred,
    shared: labels.sidebarSharedWithMe,
    uploads: labels.sidebarUploads,
  };
  return [{ label: titles[view.type], path: null }];
}

export function buildDriveFolderBreadcrumbs(
  viewPath: string,
  labels: Pick<DriveUILabels, "sidebarMyDrive" | "teamsRoot">,
  /** Optional UI-path → display label (Personal / principal group names). */
  rootLabels?: Readonly<Record<string, string>>,
): PathBreadcrumbItem[] {
  if (viewPath === GROUPS_ROOT) {
    return [{ label: labels.teamsRoot, path: null }];
  }

  if (viewPath.startsWith(`${GROUPS_ROOT}/`)) {
    const relativeParts = viewPath.slice(`${GROUPS_ROOT}/`.length).split("/").filter(Boolean);
    return relativeParts.map((segment, index) => {
      const path = `${GROUPS_ROOT}/${relativeParts.slice(0, index + 1).join("/")}`;
      const label = index === 0 ? (rootLabels?.[path] ?? segment) : segment;
      return { label, path };
    });
  }

  if (viewPath === "My Drive") {
    return [{ label: rootLabels?.["My Drive"] ?? labels.sidebarMyDrive, path: "My Drive" }];
  }

  if (viewPath.startsWith("My Drive/")) {
    const relativeParts = viewPath.slice("My Drive/".length).split("/").filter(Boolean);
    return [
      { label: rootLabels?.["My Drive"] ?? labels.sidebarMyDrive, path: "My Drive" },
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
  labels: Pick<DriveUILabels, "folderPickerDrivesRoot" | "sidebarMyDrive" | "teamsRoot">,
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

  if (browsePath === GROUPS_ROOT) {
    return [drivesRoot, { label: labels.teamsRoot, path: GROUPS_ROOT }];
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

/**
 * Where an item lives, in the names the sidebar and list use: the drive's display
 * name, then its folders ("Personal / Studio Assets"). Items outside the drive tree
 * (Shared with me) keep their list location.
 */
export function driveItemLocationLabel(
  file: { parent: string; location?: string },
  labels: Pick<DriveUILabels, "sidebarMyDrive" | "teamsRoot">,
  rootLabels?: Readonly<Record<string, string>>,
): string {
  const inDriveTree =
    file.parent === "My Drive" ||
    file.parent.startsWith("My Drive/") ||
    file.parent.startsWith(`${GROUPS_ROOT}/`);
  if (!inDriveTree) return file.location ?? file.parent;
  return buildDriveFolderBreadcrumbs(file.parent, labels, rootLabels)
    .map((crumb) => crumb.label)
    .join(" / ");
}
