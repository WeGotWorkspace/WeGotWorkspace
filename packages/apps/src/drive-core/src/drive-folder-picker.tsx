import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { Cloud, Folder } from "lucide-react";
import { kindIcon } from "@/drive-core/src/drive-icons";
import { CollectionState } from "@/collection-state/src/collection-state";
import {
  buildDriveFolderPickerBreadcrumbs,
  DRIVE_FOLDER_PICKER_ROOT,
} from "@/drive-core/src/drive-breadcrumbs";
import { DriveGridView, DriveListView } from "@/drive-core/src/drive-browser";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import { driveFolderUiPath } from "@/drive-core/src/drive-item-path";
import {
  browsePathForDrivePickerFile,
  canPickDriveFolderDestination,
  createDrivePickerRootFile,
  isDriveFileSelectListingEntry,
  type DrivePickerMode,
} from "@/drive-core/src/drive-folder-picker-utils";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import {
  apiPathFromUiPath,
  DRIVE_TRASH_UI_PATH,
  isDriveTrashApiPath,
  isDriveTrashFolderName,
} from "@/drive-core/src/drive-path-utils";
import { useDriveGridPreviews } from "@/drive-core/src/use-drive-grid-previews";
import { DriveViewIcon } from "@/drive-core/src/drive-view-icons";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { PathBreadcrumb } from "@/path-breadcrumb/src/path-breadcrumb";
import { DestinationPickerFrame } from "@/destination-picker/src/destination-picker-frame";
import { DestinationPickerList } from "@/destination-picker/src/destination-picker-list";
import { ViewModeToggle, type ViewMode } from "@/view-mode-toggle/src/view-mode-toggle";
import "@/drive-core/src/drive-folder-picker.css";

const GROUPS_ROOT = "Groups";

const PICKER_NOOP = () => {};
const PICKER_DRAG_HANDLERS = {
  onDragStart: PICKER_NOOP as (event: DragEvent) => void,
  onDragEnd: PICKER_NOOP,
};

function pickerItemDragHandlers() {
  return PICKER_DRAG_HANDLERS;
}

function pickerIsItemDragging(): boolean {
  return false;
}

function pickerFolderDropZoneProps(): Record<string, never> {
  return {};
}

function isTrashPath(path: string) {
  return path === DRIVE_TRASH_UI_PATH || path.startsWith(`${DRIVE_TRASH_UI_PATH}/`);
}

function isTrashPickerFile(file: DriveFile) {
  if (isDriveTrashFolderName(file.title)) return true;
  if (isTrashPath(file.parent)) return true;
  return isTrashPath(driveFolderUiPath(file));
}

function isTrashPickerPath(path: string) {
  return isTrashPath(path);
}

function sharedDriveRootLabel(path: string, labels: DriveUILabels): string {
  const segment = path.split("/").pop();
  return segment && segment !== "Groups" ? segment : labels.sidebarSharedDrives;
}

function resolvePickerRootTitle(
  path: string,
  labels: DriveUILabels,
  rootLabels?: Readonly<Record<string, string>>,
): string {
  const override = rootLabels?.[path]?.trim();
  if (override) return override;
  if (path === "My Drive") return labels.sidebarMyDrive;
  return sharedDriveRootLabel(path, labels);
}

type PickerRow = {
  kind: "root" | "folder" | "file";
  path: string;
  title: string;
  file?: DriveFile;
  /** False for files and other non-destination rows. */
  selectable: boolean;
};

function filterPickerListingFiles(
  listing: DriveFile[],
  browsePath: string,
  currentUsername: string,
): DriveFile[] {
  return listing.filter((file) => {
    if (isTrashPickerFile(file)) return false;
    if (
      browsePath === "My Drive" &&
      file.kind === "folder" &&
      (isDriveTrashFolderName(file.title) ||
        (typeof file.apiPath === "string" &&
          (isDriveTrashApiPath(file.apiPath, currentUsername) ||
            file.apiPath.startsWith("/groups/"))))
    ) {
      return false;
    }
    return true;
  });
}

function applyPickerListingFilter(
  listing: DriveFile[],
  browsePath: string,
  currentUsername: string,
  mode: DrivePickerMode,
): DriveFile[] {
  const visible = filterPickerListingFiles(listing, browsePath, currentUsername);
  return mode === "file-select" ? visible.filter(isDriveFileSelectListingEntry) : visible;
}

function rowsAtBrowsePath(
  moveContextFiles: DriveFile[],
  listingFiles: DriveFile[],
  browsePath: string,
  groupPaths: string[],
  labels: DriveUILabels,
  moveIds: string[],
  rootLabels?: Readonly<Record<string, string>>,
): PickerRow[] {
  if (browsePath === DRIVE_FOLDER_PICKER_ROOT) {
    const roots: PickerRow[] = [
      {
        kind: "root",
        path: "My Drive",
        title: resolvePickerRootTitle("My Drive", labels, rootLabels),
        selectable: canPickDriveFolderDestination(moveContextFiles, moveIds, "My Drive"),
      },
      ...groupPaths.map((path) => ({
        kind: "root" as const,
        path,
        title: resolvePickerRootTitle(path, labels, rootLabels),
        selectable: canPickDriveFolderDestination(moveContextFiles, moveIds, path),
      })),
    ];
    // Always list roots so users can open "My Drive" or shared drives to pick a subfolder,
    // even when the root itself is not a valid destination (e.g. items already in My Drive).
    return roots;
  }

  if (browsePath === GROUPS_ROOT) {
    return groupPaths
      .map((path) => ({
        kind: "root" as const,
        path,
        title: resolvePickerRootTitle(path, labels, rootLabels),
        selectable: canPickDriveFolderDestination(moveContextFiles, moveIds, path),
      }))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  }

  const folderRows: PickerRow[] = listingFiles
    .filter((file) => file.kind === "folder")
    .map((file) => ({
      kind: "folder" as const,
      file,
      path: driveFolderUiPath(file),
      title: file.title,
      selectable: canPickDriveFolderDestination(moveContextFiles, moveIds, driveFolderUiPath(file)),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

  const fileRows: PickerRow[] = listingFiles
    .filter((file) => file.kind !== "folder")
    .map((file) => ({
      kind: "file" as const,
      file,
      path: file.id,
      title: file.title,
      selectable: false,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

  return [...folderRows, ...fileRows];
}

export function DriveFolderPicker({
  labels,
  files,
  groupPaths,
  moveIds,
  initialBrowsePath,
  initialSelectedPath,
  operations,
  currentUsername,
  groupRootNames,
  rootLabels,
  rootIcon,
  listingTheme,
  mode = "folder-destination",
  onDestinationChange,
  onSelectedFileChange,
}: {
  labels: DriveUILabels;
  /** Items being moved (for destination validation). */
  files: DriveFile[];
  groupPaths: string[];
  moveIds: string[];
  initialBrowsePath: string;
  /**
   * Optional preselected destination (Docs New document: sidebar drive).
   * When omitted, a pickable `initialBrowsePath` is highlighted.
   */
  initialSelectedPath?: string | null;
  operations?: DriveAPIOperations;
  currentUsername: string;
  groupRootNames: Set<string>;
  /** Optional UI-path → display label for drive roots (Docs: Personal / principal names). */
  rootLabels?: Readonly<Record<string, string>>;
  /** Optional icon for drive-root rows (Docs: HardDrive). Defaults to Folder. */
  rootIcon?: ReactNode;
  /** Docs image-insert: Docs blue chrome. Omit for Drive's own picker. */
  listingTheme?: "docs";
  /** `file-select` uses Drive grid/list (images); default keeps DestinationPickerList. */
  mode?: DrivePickerMode;
  onDestinationChange?: (path: string | null) => void;
  onSelectedFileChange?: (file: DriveFile | null) => void;
}) {
  const fileSelect = mode === "file-select";
  const [browsePath, setBrowsePath] = useState(initialBrowsePath);
  const [listingFiles, setListingFiles] = useState<DriveFile[]>([]);
  const [listingLoading, setListingLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<string | null>(() => {
    if (fileSelect) return null;
    if (initialSelectedPath && canPickDriveFolderDestination(files, moveIds, initialSelectedPath)) {
      return initialSelectedPath;
    }
    return canPickDriveFolderDestination(files, moveIds, initialBrowsePath)
      ? initialBrowsePath
      : null;
  });

  useEffect(() => {
    setBrowsePath(initialBrowsePath);
  }, [initialBrowsePath]);

  useEffect(() => {
    if (fileSelect) return;
    const next =
      initialSelectedPath && canPickDriveFolderDestination(files, moveIds, initialSelectedPath)
        ? initialSelectedPath
        : canPickDriveFolderDestination(files, moveIds, initialBrowsePath)
          ? initialBrowsePath
          : null;
    setHighlightedPath((prev) => (prev === next ? prev : next));
  }, [fileSelect, files, initialBrowsePath, initialSelectedPath, moveIds]);

  useEffect(() => {
    if (browsePath === DRIVE_FOLDER_PICKER_ROOT || browsePath === GROUPS_ROOT) {
      setListingFiles([]);
      setListingLoading(false);
      return;
    }

    if (!operations) {
      const children = DRIVE_MOCK_FILES.filter(
        (file) => file.parent === browsePath && !isTrashPickerFile(file),
      );
      setListingFiles(applyPickerListingFilter(children, browsePath, currentUsername, mode));
      setListingLoading(false);
      return;
    }

    const controller = new AbortController();
    setListingLoading(true);
    void operations
      .listDirectory(apiPathFromUiPath(browsePath, currentUsername, groupRootNames), {
        signal: controller.signal,
      })
      .then((data) => {
        const mapped = data.directory.files.map((entry) =>
          driveFileFromEntry(entry, currentUsername),
        );
        setListingFiles(applyPickerListingFilter(mapped, browsePath, currentUsername, mode));
      })
      .catch(() => {
        if (!controller.signal.aborted) setListingFiles([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setListingLoading(false);
      });

    return () => controller.abort();
  }, [browsePath, operations, currentUsername, groupRootNames, mode]);

  const rows = useMemo(
    () =>
      rowsAtBrowsePath(files, listingFiles, browsePath, groupPaths, labels, moveIds, rootLabels),
    [browsePath, files, listingFiles, groupPaths, labels, moveIds, rootLabels],
  );

  const fileSelectItems = useMemo(() => {
    if (!fileSelect) return [];
    if (browsePath === DRIVE_FOLDER_PICKER_ROOT || browsePath === GROUPS_ROOT) {
      return rows.map((row) => row.file ?? createDrivePickerRootFile(row.path, row.title));
    }
    return listingFiles;
  }, [browsePath, fileSelect, listingFiles, rows]);

  const { filePreviews } = useDriveGridPreviews({
    items: fileSelectItems,
    operations,
    enabled: fileSelect && viewMode === "grid",
  });

  const destinationPath =
    highlightedPath ?? (browsePath !== DRIVE_FOLDER_PICKER_ROOT ? browsePath : null);

  useEffect(() => {
    if (fileSelect) {
      onSelectedFileChange?.(selectedFile);
      return;
    }
    onDestinationChange?.(destinationPath);
  }, [destinationPath, fileSelect, onDestinationChange, onSelectedFileChange, selectedFile]);

  const breadcrumbItems = useMemo(
    () => buildDriveFolderPickerBreadcrumbs(browsePath, labels, rootLabels),
    [browsePath, labels, rootLabels],
  );

  const breadcrumbView = useMemo<ViewKey>(() => {
    if (browsePath === DRIVE_FOLDER_PICKER_ROOT) {
      return { type: "folder", path: "My Drive" };
    }
    if (browsePath.startsWith(`${GROUPS_ROOT}/`)) {
      return { type: "folder", path: browsePath };
    }
    return { type: "folder", path: browsePath.startsWith("My Drive") ? browsePath : "My Drive" };
  }, [browsePath]);

  const openRow = (path: string) => {
    if (isTrashPickerPath(path)) return;
    setBrowsePath(path);
    setSelectedFile(null);
    if (fileSelect) return;
    setHighlightedPath(canPickDriveFolderDestination(files, moveIds, path) ? path : null);
  };

  const handleFileSelectItem = (id: string) => {
    const item = fileSelectItems.find((file) => file.id === id);
    if (!item) return;
    const folderPath = browsePathForDrivePickerFile(item);
    if (item.kind === "folder" && folderPath != null) {
      openRow(folderPath);
      return;
    }
    setSelectedFile(item);
  };

  const handleFileSelectOpen = (file: DriveFile) => {
    const folderPath = browsePathForDrivePickerFile(file);
    if (file.kind === "folder" && folderPath != null) {
      openRow(folderPath);
    }
  };

  const showEmpty = fileSelect
    ? !listingLoading && fileSelectItems.length === 0
    : !listingLoading && rows.length === 0 && browsePath !== DRIVE_FOLDER_PICKER_ROOT;

  const showListingLoading =
    listingLoading && browsePath !== DRIVE_FOLDER_PICKER_ROOT && browsePath !== GROUPS_ROOT;

  const breadcrumb = (
    <PathBreadcrumb
      size={fileSelect ? "sm" : "default"}
      className={fileSelect ? "min-w-0 flex-1" : "destination-picker__breadcrumbs"}
      leadingIcon={<DriveViewIcon view={breadcrumbView} className="size-3.5" />}
      items={breadcrumbItems}
      currentPath={browsePath}
      alwaysNavigablePaths={[DRIVE_FOLDER_PICKER_ROOT]}
      onNavigate={(path) => openRow(path)}
    />
  );

  return (
    <DestinationPickerFrame
      className={fileSelect ? "destination-picker--file-select drive-workspace" : undefined}
      listingTheme={listingTheme}
      breadcrumbs={
        fileSelect ? (
          <div className="destination-picker__breadcrumbs destination-picker__breadcrumbs--with-toggle">
            {breadcrumb}
            <ViewModeToggle
              className="destination-picker__view-toggle"
              value={viewMode}
              onChange={setViewMode}
              gridLabel={labels.gridView}
              listLabel={labels.listView}
            />
          </div>
        ) : (
          breadcrumb
        )
      }
    >
      {showListingLoading ? (
        <CollectionState variant="loading">{labels.folderListingLoading}</CollectionState>
      ) : showEmpty ? (
        <CollectionState icon={<Cloud className="size-12" />}>
          {fileSelect ? labels.fileSelectEmpty : labels.emptyFolder}
        </CollectionState>
      ) : fileSelect ? (
        viewMode === "grid" ? (
          <DriveGridView
            items={fileSelectItems}
            filePreviews={filePreviews}
            selectedIds={selectedFile ? [selectedFile.id] : []}
            starred={{}}
            labels={labels}
            inTrash={false}
            selectionMode={false}
            isTouch={false}
            isItemDragging={pickerIsItemDragging}
            itemDragHandlers={pickerItemDragHandlers}
            folderDropZoneProps={pickerFolderDropZoneProps}
            onSelect={(id) => handleFileSelectItem(id)}
            onOpen={handleFileSelectOpen}
            onLongPress={PICKER_NOOP}
            onStar={PICKER_NOOP}
            onDownload={PICKER_NOOP}
            onRename={PICKER_NOOP}
            onMove={PICKER_NOOP}
            onTrash={PICKER_NOOP}
            itemChrome="picker"
          />
        ) : (
          <DriveListView
            items={fileSelectItems}
            activeId={selectedFile?.id ?? null}
            selectedIds={selectedFile ? [selectedFile.id] : []}
            starred={{}}
            labels={labels}
            inTrash={false}
            selectionMode={false}
            isTouch={false}
            isItemDragging={pickerIsItemDragging}
            itemDragHandlers={pickerItemDragHandlers}
            folderDropZoneProps={pickerFolderDropZoneProps}
            onSelect={(id) => handleFileSelectItem(id)}
            onOpen={handleFileSelectOpen}
            onLongPress={PICKER_NOOP}
            onStar={PICKER_NOOP}
            onDownload={PICKER_NOOP}
            onRename={PICKER_NOOP}
            onMove={PICKER_NOOP}
            onTrash={PICKER_NOOP}
            itemChrome="picker"
          />
        )
      ) : rows.length === 0 ? null : (
        <DestinationPickerList
          items={rows.map((row) => {
            const navigable = row.kind === "folder" || row.kind === "root";
            const icon =
              row.kind === "root" ? (
                (rootIcon ?? <Folder fill="currentColor" fillOpacity={0.18} />)
              ) : row.kind === "folder" ? (
                <Folder fill="currentColor" fillOpacity={0.18} />
              ) : (
                <span className="[&>svg]:size-4">{row.file ? kindIcon[row.file.kind] : null}</span>
              );

            return {
              id: row.path,
              title: row.title,
              icon,
              selectable: row.selectable,
              navigable,
            };
          })}
          selectedId={highlightedPath}
          onSelect={setHighlightedPath}
          onOpen={openRow}
        />
      )}
    </DestinationPickerFrame>
  );
}
