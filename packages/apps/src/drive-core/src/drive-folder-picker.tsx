import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Cloud } from "lucide-react";
import { CollectionState } from "@/collection-state/src/collection-state";
import {
  buildDriveFolderPickerBreadcrumbs,
  DRIVE_FOLDER_PICKER_ROOT,
} from "@/drive-core/src/drive-breadcrumbs";
import { DriveListView } from "@/drive-core/src/drive-list-view";
import { driveFileFromEntry, optimisticDriveFolder } from "@/drive-core/src/drive-file-utils";
import { DrivePickerNewFolderRow } from "@/drive-core/src/drive-picker-new-folder";
import {
  DRIVE_PICKER_NEW_FOLDER_DEFAULT_NAME,
  drivePickerFolderNameError,
  suggestDrivePickerFolderName,
  type DrivePickerNewFolderControl,
} from "@/drive-core/src/drive-picker-new-folder-utils";
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
import { useProjectFolders } from "@/drive-core/src/drive-project-folder";
import { DriveViewIcon, withDriveRootIcons } from "@/drive-core/src/drive-view-icons";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations, DriveShareOperations } from "@/lib/files/drive-types";
import { PathBreadcrumb } from "@/path-breadcrumb/src/path-breadcrumb";
import { DestinationPickerFrame } from "@/destination-picker/src/destination-picker-frame";
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
  shareOperations,
  currentUsername,
  groupRootNames,
  rootLabels,
  listingTheme,
  mode = "folder-destination",
  onDestinationChange,
  onSelectedFileChange,
  onNewFolderChange,
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
  /**
   * Reads the open folder's own rights when its parent cannot be listed (the top folder
   * of a share the viewer was given).
   */
  shareOperations?: Pick<DriveShareOperations, "getAtPath">;
  currentUsername: string;
  groupRootNames: Set<string>;
  /** Optional UI-path → display label for drive roots (Docs: Personal / principal names). */
  rootLabels?: Readonly<Record<string, string>>;
  /** Docs dialogs: Docs chrome on the Drive list. Omit for Drive's own picker. */
  listingTheme?: "docs";
  /** `file-select` picks a file (list); the default picks a folder (list). */
  mode?: DrivePickerMode;
  onDestinationChange?: (path: string | null) => void;
  onSelectedFileChange?: (file: DriveFile | null) => void;
  /**
   * Reports the *New folder* control for the dialog footer (folder pickers only):
   * whether a folder can be added where the picker is, and how to start it.
   */
  onNewFolderChange?: (control: DrivePickerNewFolderControl | null) => void;
}) {
  const fileSelect = mode === "file-select";
  const [browsePath, setBrowsePath] = useState(initialBrowsePath);
  const [listingFiles, setListingFiles] = useState<DriveFile[]>([]);
  const [listingLoading, setListingLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [highlightedPath, setHighlightedPathState] = useState<string | null>(() => {
    if (fileSelect) return null;
    if (initialSelectedPath && canPickDriveFolderDestination(files, moveIds, initialSelectedPath)) {
      return initialSelectedPath;
    }
    return canPickDriveFolderDestination(files, moveIds, initialBrowsePath)
      ? initialBrowsePath
      : null;
  });

  // Once the person picks (or makes) a destination, a refreshed `files` list must not
  // snap the choice back to the preselection.
  const highlightChosen = useRef(false);
  const setHighlightedPath = (next: string | null | ((prev: string | null) => string | null)) => {
    highlightChosen.current = true;
    setHighlightedPathState(next);
  };
  const [newFolderDraft, setNewFolderDraft] = useState<string | null>(null);
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  // What each opened folder says about the viewer's right to add to it (from its row).
  const folderRights = useRef(new Map<string, boolean>());
  // Folders whose rights were looked up in their parent's listing (found or not).
  const rightsResolved = useRef(new Set<string>());
  const [, setRightsVersion] = useState(0);
  // Bumped when a create writes the listing, so an older browse response cannot undo it.
  const listingEpoch = useRef(0);
  const [creatingCount, setCreatingCount] = useState(0);

  useEffect(() => {
    setBrowsePath(initialBrowsePath);
  }, [initialBrowsePath]);

  useEffect(() => {
    highlightChosen.current = false;
  }, [initialBrowsePath, initialSelectedPath]);

  useEffect(() => {
    if (fileSelect) return;
    const next =
      initialSelectedPath && canPickDriveFolderDestination(files, moveIds, initialSelectedPath)
        ? initialSelectedPath
        : canPickDriveFolderDestination(files, moveIds, initialBrowsePath)
          ? initialBrowsePath
          : null;
    setHighlightedPathState((prev) => {
      // A new files/moveIds array must not clear or replace a destination the user
      // already chose.
      if (highlightChosen.current && prev === null) return prev;
      if (
        prev &&
        (highlightChosen.current || next === null) &&
        canPickDriveFolderDestination(files, moveIds, prev)
      ) {
        return prev;
      }
      return prev === next ? prev : next;
    });
  }, [fileSelect, files, initialBrowsePath, initialSelectedPath, moveIds]);

  // A name being typed belongs to the folder it was started in.
  useEffect(() => {
    setNewFolderDraft(null);
    setNewFolderError(null);
  }, [browsePath]);

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
    const epoch = listingEpoch.current;
    setListingLoading(true);
    void operations
      .listDirectory(apiPathFromUiPath(browsePath, currentUsername, groupRootNames), {
        signal: controller.signal,
      })
      .then((data) => {
        if (controller.signal.aborted || epoch !== listingEpoch.current) return;
        const mapped = data.directory.files.map((entry) =>
          driveFileFromEntry(entry, currentUsername),
        );
        setListingFiles(applyPickerListingFilter(mapped, browsePath, currentUsername, mode));
      })
      .catch(() => {
        if (!controller.signal.aborted && epoch === listingEpoch.current) setListingFiles([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setListingLoading(false);
      });

    return () => controller.abort();
  }, [browsePath, operations, currentUsername, groupRootNames, mode]);

  const noteFolderRights = (listing: DriveFile[]) => {
    for (const file of listing) {
      if (file.kind === "folder" && file.mayManageStructure !== undefined) {
        folderRights.current.set(driveFolderUiPath(file), file.mayManageStructure);
      }
    }
  };
  noteFolderRights(listingFiles);

  // The folder the picker opens in (or a drive root's descendant reached by breadcrumb)
  // was never a child row here: its rights come from its parent's listing.
  const parentOfBrowsePath = browsePath.includes("/")
    ? browsePath.slice(0, browsePath.lastIndexOf("/"))
    : null;
  if (!operations && parentOfBrowsePath) {
    noteFolderRights(DRIVE_MOCK_FILES.filter((file) => file.parent === parentOfBrowsePath));
  }
  const rightsLookupPending =
    Boolean(operations) &&
    parentOfBrowsePath !== null &&
    parentOfBrowsePath !== DRIVE_FOLDER_PICKER_ROOT &&
    parentOfBrowsePath !== GROUPS_ROOT &&
    browsePath !== "My Drive" &&
    !groupPaths.includes(browsePath) &&
    folderRights.current.get(browsePath) === undefined &&
    !rightsResolved.current.has(browsePath);

  useEffect(() => {
    if (!operations || !parentOfBrowsePath || !rightsLookupPending) return;
    const controller = new AbortController();
    const { signal } = controller;
    void operations
      .listDirectory(apiPathFromUiPath(parentOfBrowsePath, currentUsername, groupRootNames), {
        signal,
      })
      .then((data) => {
        noteFolderRights(
          data.directory.files.map((entry) => driveFileFromEntry(entry, currentUsername)),
        );
      })
      .catch(() => {})
      .then(async () => {
        if (signal.aborted || folderRights.current.has(browsePath) || !shareOperations) return;
        // No grant on the parent (a share's top folder): ask for the folder's own rights.
        try {
          const share = await shareOperations.getAtPath(
            apiPathFromUiPath(browsePath, currentUsername, groupRootNames),
            { signal },
          );
          if (!signal.aborted) {
            folderRights.current.set(browsePath, share.myRights.mayManageStructure);
          }
        } catch {
          // Unknown rights: leave the button on; the server still refuses a forbidden create.
        }
      })
      .finally(() => {
        if (signal.aborted) return;
        rightsResolved.current.add(browsePath);
        setRightsVersion((version) => version + 1);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    browsePath,
    operations,
    shareOperations,
    currentUsername,
    groupRootNames,
    rightsLookupPending,
  ]);

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

  const destinationPath =
    highlightedPath ?? (browsePath !== DRIVE_FOLDER_PICKER_ROOT ? browsePath : null);

  useEffect(() => {
    if (fileSelect) {
      onSelectedFileChange?.(selectedFile);
      return;
    }
    onDestinationChange?.(destinationPath);
  }, [destinationPath, fileSelect, onDestinationChange, onSelectedFileChange, selectedFile]);

  const { isProjectFolderUiPath } = useProjectFolders();
  const breadcrumbItems = useMemo(
    () =>
      withDriveRootIcons(
        buildDriveFolderPickerBreadcrumbs(browsePath, labels, rootLabels),
        isProjectFolderUiPath,
      ),
    [browsePath, isProjectFolderUiPath, labels, rootLabels],
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
    // Like the folder picker: click selects, double-click (or Enter) opens a folder.
    setSelectedFile(item.kind === "folder" ? null : item);
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

  // ---- New folder: made where the picker is, picked once named ----
  const browsePathRef = useRef(browsePath);
  browsePathRef.current = browsePath;
  const canAddFolder = !fileSelect && !atPickerRoots;
  const newFolderDisabledReason = !canAddFolder
    ? labels.pickerNewFolderOpenFolder
    : listingLoading || rightsLookupPending
      ? labels.folderListingLoading
      : folderRights.current.get(browsePath) === false
        ? labels.pickerNewFolderReadOnly
        : null;
  const naming = newFolderDraft !== null;

  const startNewFolder = useCallback(() => {
    if (!canAddFolder || newFolderDisabledReason !== null) return;
    setNewFolderError(null);
    setNewFolderDraft(
      suggestDrivePickerFolderName(DRIVE_PICKER_NEW_FOLDER_DEFAULT_NAME, listingFiles),
    );
  }, [canAddFolder, listingFiles, newFolderDisabledReason]);

  const cancelNewFolder = () => {
    setNewFolderDraft(null);
    setNewFolderError(null);
  };

  const submitNewFolder = () => {
    if (newFolderDraft === null) return;
    const name = newFolderDraft.trim();
    if (!name) {
      cancelNewFolder();
      return;
    }
    const nameError = drivePickerFolderNameError(name, listingFiles, labels);
    if (nameError) {
      setNewFolderError(nameError);
      return;
    }
    const parent = browsePath;
    const optimistic = optimisticDriveFolder(name, parent);
    const newPath = driveFolderUiPath(optimistic);
    setNewFolderDraft(null);
    setNewFolderError(null);
    // The folder is there at once and picked, so one click on the dialog's button finishes.
    listingEpoch.current += 1;
    setListingFiles((prev) => [...prev, optimistic]);
    setHighlightedPath(canPickDriveFolderDestination(files, moveIds, newPath) ? newPath : null);
    if (!operations) return;
    const apiParent = apiPathFromUiPath(parent, currentUsername, groupRootNames);
    // Drive's own create action, so offline it queues like a folder made in Drive.
    setCreatingCount((count) => count + 1);
    void operations
      .createFolder({ cwd: apiParent, name })
      .then(() => {
        const refreshEpoch = listingEpoch.current;
        return (
          operations
            .listDirectory(apiParent)
            .then((data) => {
              // A later create wrote its own row since this refresh started.
              if (browsePathRef.current !== parent || refreshEpoch !== listingEpoch.current) return;
              listingEpoch.current += 1;
              const mapped = data.directory.files.map((entry) =>
                driveFileFromEntry(entry, currentUsername),
              );
              setListingFiles(applyPickerListingFilter(mapped, parent, currentUsername, mode));
            })
            // Offline or slow: the folder row stays as made.
            .catch(() => {})
        );
      })
      .catch(() => {
        if (browsePathRef.current !== parent) return;
        setListingFiles((prev) => prev.filter((file) => file.id !== optimistic.id));
        setHighlightedPath((prev) => (prev === newPath ? parent : prev));
        setNewFolderError(labels.pickerNewFolderFailed);
      })
      .finally(() => setCreatingCount((count) => count - 1));
  };

  useEffect(() => {
    if (fileSelect || !onNewFolderChange) return;
    onNewFolderChange({
      disabledReason: newFolderDisabledReason,
      active: naming,
      creating: creatingCount > 0,
      start: startNewFolder,
    });
  }, [
    creatingCount,
    fileSelect,
    naming,
    newFolderDisabledReason,
    onNewFolderChange,
    startNewFolder,
  ]);

  const breadcrumb = (
    <PathBreadcrumb
      className="destination-picker__breadcrumbs"
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
      className="drive-workspace"
      listingTheme={listingTheme}
      bodyRef={bodyRef}
      onBodyKeyDown={handleListKeyDown}
      breadcrumbs={breadcrumb}
    >
      {newFolderDraft !== null ? (
        <DrivePickerNewFolderRow
          labels={labels}
          value={newFolderDraft}
          error={newFolderError}
          onChange={(value) => {
            setNewFolderDraft(value);
            setNewFolderError(null);
          }}
          onSubmit={submitNewFolder}
          onCancel={cancelNewFolder}
        />
      ) : newFolderError ? (
        <p className="destination-picker__new-folder-error px-4" role="alert">
          {newFolderError}
        </p>
      ) : null}
      {showListingLoading ? (
        <CollectionState variant="loading">{labels.folderListingLoading}</CollectionState>
      ) : showEmpty && !naming ? (
        <CollectionState icon={<Cloud className="size-12" />}>
          {fileSelect ? labels.fileSelectEmpty : labels.emptyFolder}
        </CollectionState>
      ) : listItems.length === 0 || (showEmpty && naming) ? null : (
        <DriveListView
          items={listItems}
          sort={atPickerRoots ? undefined : listSort}
          onSort={toggleListSort}
          activeId={fileSelect ? (selectedFile?.id ?? null) : null}
          selectedIds={fileSelect && selectedFile ? [selectedFile.id] : selectedDestinationIds}
          showKindColumn={fileSelect}
          showSizeColumn={fileSelect}
          starred={{}}
          labels={labels}
          inTrash={false}
          selectionMode={false}
          isTouch={false}
          isItemDragging={pickerIsItemDragging}
          itemDragHandlers={pickerItemDragHandlers}
          folderDropZoneProps={pickerFolderDropZoneProps}
          isItemDisabled={
            fileSelect
              ? undefined
              : (file) => {
                  const row = rowById.get(file.id);
                  return !row || (!row.selectable && row.kind === "file");
                }
          }
          onSelect={(id) => {
            if (fileSelect) {
              handleFileSelectItem(id);
              return;
            }
            const row = rowById.get(id);
            if (row?.selectable) setHighlightedPath(row.path);
          }}
          onOpen={(file) => {
            if (fileSelect) {
              handleFileSelectOpen(file);
              return;
            }
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
