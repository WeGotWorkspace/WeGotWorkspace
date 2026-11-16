import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Cloud } from "lucide-react";
import { CollectionState } from "@/collection-state/src/collection-state";
import {
  buildDriveFolderPickerBreadcrumbs,
  DRIVE_FOLDER_PICKER_ROOT,
} from "@/drive-core/src/drive-breadcrumbs";
import { DriveGridView } from "@/drive-core/src/drive-browser";
import { DriveListView } from "@/drive-core/src/drive-list-view";
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
  DRIVE_GROUPS_UI_ROOT as GROUPS_ROOT,
  DRIVE_TRASH_UI_PATH,
  isDriveTrashApiPath,
  isDriveTrashFolderName,
} from "@/lib/files/drive-path-utils";
import { useDriveGridPreviews } from "@/drive-core/src/use-drive-grid-previews";
import {
  adjacentListItem,
  listItemFocusTarget,
  listItemIdOf,
  refocusListAfterNavigation,
} from "@/hooks/list-item-focus";
import { useListSort } from "@/hooks/use-list-sort";
import {
  DRIVE_LIST_DEFAULT_SORT,
  DRIVE_LIST_SORT_COLUMNS,
  sortDriveFiles,
} from "@/drive-core/src/drive-list-sort";
import { DriveViewIcon, withDriveRootIcons } from "@/drive-core/src/drive-view-icons";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { cn } from "@/lib/utils";
import { PathBreadcrumb } from "@/path-breadcrumb/src/path-breadcrumb";
import { DestinationPickerFrame } from "@/destination-picker/src/destination-picker-frame";
import { ViewModeToggle, type ViewMode } from "@/view-mode-toggle/src/view-mode-toggle";
import "@/drive-core/src/drive-folder-picker.css";

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
  return segment && segment !== GROUPS_ROOT ? segment : labels.teamsRoot;
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
   * Optional preselected destination.
   * When omitted, a pickable `initialBrowsePath` is highlighted.
   */
  initialSelectedPath?: string | null;
  operations?: DriveAPIOperations;
  currentUsername: string;
  groupRootNames: Set<string>;
  /** Optional UI-path → display label for drive roots (Docs: Personal / principal names). */
  rootLabels?: Readonly<Record<string, string>>;
  /** Docs dialogs: Docs chrome on the Drive list. Omit for Drive's own picker. */
  listingTheme?: "docs";
  /** `file-select` picks a file (grid or list); the default picks a folder (list). */
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
    setHighlightedPath((prev) => {
      // A new files/moveIds array must not clear a drive the user already chose
      // when nothing was preselected (next is null).
      if (next === null && prev && canPickDriveFolderDestination(files, moveIds, prev)) {
        return prev;
      }
      return prev === next ? prev : next;
    });
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

  // Same column sort as Drive, for this dialog only (not remembered).
  const { sort: listSort, toggleSort: toggleListSort } = useListSort({
    columns: DRIVE_LIST_SORT_COLUMNS,
    defaultSort: DRIVE_LIST_DEFAULT_SORT,
  });
  // The rows as Drive list items: drive roots in their given order, a folder's
  // contents in the column sort (folders first).
  const atPickerRoots = browsePath === DRIVE_FOLDER_PICKER_ROOT || browsePath === GROUPS_ROOT;
  const listItems = useMemo(() => {
    if (fileSelect && !atPickerRoots) return sortDriveFiles(listingFiles, listSort);
    const items = rows.map((row) => row.file ?? createDrivePickerRootFile(row.path, row.title));
    return atPickerRoots ? items : sortDriveFiles(items, listSort);
  }, [atPickerRoots, fileSelect, listSort, listingFiles, rows]);
  const fileSelectItems = fileSelect ? listItems : [];
  const rowById = useMemo(
    () =>
      new Map(
        rows.map((row) => [row.file?.id ?? createDrivePickerRootFile(row.path, row.title).id, row]),
      ),
    [rows],
  );

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
    () => withDriveRootIcons(buildDriveFolderPickerBreadcrumbs(browsePath, labels, rootLabels)),
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

  const selectedDestinationIds = rows
    .filter((row) => row.selectable && row.path === highlightedPath)
    .map((row) => row.file?.id ?? createDrivePickerRootFile(row.path, row.title).id);

  const showEmpty = fileSelect
    ? !listingLoading && fileSelectItems.length === 0
    : !listingLoading && rows.length === 0 && browsePath !== DRIVE_FOLDER_PICKER_ROOT;

  const showListingLoading =
    listingLoading && browsePath !== DRIVE_FOLDER_PICKER_ROOT && browsePath !== GROUPS_ROOT;

  // Same keymap as the Drive list (↑/↓ move, Enter opens, Alt+↑ goes up), inside the
  // dialog where the Drive list's own keys stay off. After opening a folder by key the
  // focus moves into its listing.
  const bodyRef = useRef<HTMLDivElement>(null);
  const refocusList = () => {
    if (bodyRef.current) refocusListAfterNavigation(bodyRef.current);
  };

  const fileForId = (id: string) => listItems.find((file) => file.id === id);
  const chooseByKey = (id: string) => {
    if (fileSelect) {
      const file = fileForId(id);
      if (file && file.kind !== "folder") setSelectedFile(file);
      return;
    }
    const row = rowById.get(id);
    if (row?.selectable) setHighlightedPath(row.path);
  };
  const openByKey = (id: string) => {
    refocusList();
    if (fileSelect) {
      const file = fileForId(id);
      if (!file) return;
      if (file.kind === "folder") handleFileSelectOpen(file);
      else setSelectedFile(file);
      return;
    }
    const row = rowById.get(id);
    if (row && row.kind !== "file") openRow(row.path);
  };
  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const focusedId = listItemIdOf(event.target);
    const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (event.key === "ArrowUp" && event.altKey) {
      const parent = breadcrumbItems[breadcrumbItems.length - 2]?.path;
      if (parent == null) return;
      event.preventDefault();
      refocusList();
      openRow(parent);
      return;
    }
    if (!focusedId || !plain) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = adjacentListItem(
        event.currentTarget,
        focusedId,
        event.key === "ArrowDown" ? 1 : -1,
      );
      const nextId = next?.getAttribute("data-list-item-id");
      if (!next || !nextId) return;
      listItemFocusTarget(next)?.focus();
      next.scrollIntoView({ block: "nearest" });
      chooseByKey(nextId);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openByKey(focusedId);
    }
  };

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
      label={labels.pickerLocationLabel}
      className={cn("drive-workspace", fileSelect && "destination-picker--file-select")}
      listingTheme={listingTheme}
      bodyRef={bodyRef}
      onBodyKeyDown={handleListKeyDown}
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
            sort={listSort}
            onSort={toggleListSort}
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
        <DriveListView
          items={listItems}
          sort={atPickerRoots ? undefined : listSort}
          onSort={toggleListSort}
          activeId={null}
          selectedIds={selectedDestinationIds}
          showKindColumn={false}
          showSizeColumn={false}
          starred={{}}
          labels={labels}
          inTrash={false}
          selectionMode={false}
          isTouch={false}
          isItemDragging={pickerIsItemDragging}
          itemDragHandlers={pickerItemDragHandlers}
          folderDropZoneProps={pickerFolderDropZoneProps}
          isItemDisabled={(file) => {
            const row = rowById.get(file.id);
            return !row || (!row.selectable && row.kind === "file");
          }}
          onSelect={(id) => {
            const row = rowById.get(id);
            if (row?.selectable) setHighlightedPath(row.path);
          }}
          onOpen={(file) => {
            const row = rowById.get(file.id);
            if (row && row.kind !== "file") openRow(row.path);
          }}
          onLongPress={PICKER_NOOP}
          onStar={PICKER_NOOP}
          onDownload={PICKER_NOOP}
          onRename={PICKER_NOOP}
          onMove={PICKER_NOOP}
          onTrash={PICKER_NOOP}
          itemChrome="picker"
        />
      )}
    </DestinationPickerFrame>
  );
}
