import type { MouseEvent } from "react";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile, FileKind } from "@/lib/files/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";

const FALLBACK_FILE: DriveFile = {
  id: "story-drive-fallback",
  notebook: "Doc · 1 KB",
  category: "Document",
  date: "Now",
  title: "Example file.pdf",
  excerpt: "Storybook placeholder",
  body: ["Preview body copy for the detail panel."],
  tags: [],
  wordCount: 0,
  parent: "My Drive",
  kind: "doc",
  size: "1 KB",
};

export function getDriveStoryFilesInMyDrive(): DriveFile[] {
  return DRIVE_MOCK_FILES.filter((file) => file.parent === "My Drive");
}

export function getDriveStoryFile(id?: string): DriveFile {
  if (id) {
    return DRIVE_MOCK_FILES.find((file) => file.id === id) ?? FALLBACK_FILE;
  }
  return (
    DRIVE_MOCK_FILES.find((file) => file.kind === "doc" && file.parent === "My Drive") ??
    FALLBACK_FILE
  );
}

export function getDriveStoryFileByKind(kind: FileKind): DriveFile {
  return DRIVE_MOCK_FILES.find((file) => file.kind === kind) ?? FALLBACK_FILE;
}

type FolderDropZoneProps = Pick<
  MenuItemProps,
  "isDropTarget" | "onDragOver" | "onDragLeave" | "onDrop"
>;

export type DriveBrowserStoryProps = {
  items: DriveFile[];
  filePreviews: Record<string, FilePreviewPayload>;
  selectedIds: string[];
  starred: Record<string, boolean>;
  selectionMode: boolean;
  isTouch: boolean;
  isItemDragging: (id: string) => boolean;
  itemDragHandlers: (id: string) => {
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  folderDropZoneProps: (parentPath: string) => FolderDropZoneProps;
  onSelect: (id: string, e: MouseEvent) => void;
  onOpen: (file: DriveFile) => void;
  onLongPress: (id: string) => void;
  labels: DriveUILabels;
  inTrash: boolean;
  onStar: (id: string) => void;
  onDownload: (file: DriveFile) => void;
  onRename: (file: DriveFile) => void;
  onTrash: (file: DriveFile) => void;
};

export function createDriveBrowserStoryProps(
  overrides?: Partial<DriveBrowserStoryProps>,
): DriveBrowserStoryProps {
  return {
    items: getDriveStoryFilesInMyDrive(),
    filePreviews: {},
    selectedIds: [],
    starred: {},
    selectionMode: false,
    isTouch: false,
    isItemDragging: () => false,
    itemDragHandlers: () => ({ onDragStart: STORY_NOOP, onDragEnd: STORY_NOOP }),
    folderDropZoneProps: () => ({}),
    onSelect: STORY_NOOP,
    onOpen: STORY_NOOP,
    onLongPress: STORY_NOOP,
    labels: driveLabels,
    inTrash: false,
    onStar: STORY_NOOP,
    onDownload: STORY_NOOP,
    onRename: STORY_NOOP,
    onTrash: STORY_NOOP,
    ...overrides,
  };
}

export const driveStoryLabels = driveLabels;
