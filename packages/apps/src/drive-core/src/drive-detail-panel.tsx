import { HardDrive } from "lucide-react";
import { Tag } from "@/tag/src/tag";
import { DriveDetailActionBar } from "@/drive-core/src/drive-detail-action-bar";
import { buildDriveFileActions } from "@/drive-core/src/drive-file-action-builders";
import type { DriveFile } from "@/lib/files/drive-models";
import { useCanDownloadDriveItem } from "@/drive-core/src/drive-item-download";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import { FilePreview } from "@/file-preview/src/file-preview";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";
import { DocsCollabSidebarPanel } from "@/text-editor-core/docs-collab/docs-collab-card";
import { DRIVE_KIND_LABEL, formatDriveModified } from "@/drive-core/src/drive-list-sort";
import {
  MultiSelectionView,
  type MultiSelectionViewAction,
} from "@/multi-selection-view/src/multi-selection-view";
import "./drive-detail-panel.css";
import "@/file-preview/src/file-preview.css";

export type DriveDetailPanelProps = {
  labels: DriveUILabels;
  /** When null/undefined, panel shows the shared empty placeholder (like invitations/review). */
  file?: DriveFile | null;
  preview?: FilePreviewPayload;
  isStarred?: boolean;
  inTrash?: boolean;
  onClose: () => void;
  onDownload?: () => void;
  onStar?: () => void;
  onRename?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
  canShare?: boolean;
  canManageStructure?: boolean;
  onShare?: () => void;
  /** Show header close via DocsCollabSidebarPanel titleTrailing (default on). */
  showCloseButton?: boolean;
  /** Where the file lives, in the names the list and sidebar use (drive / folders). */
  locationLabel?: string;
  /** More than one selected: the panel shows the selection summary and its actions. */
  selectedCount?: number;
  selectionActions?: MultiSelectionViewAction[];
};

/**
 * Drive file detail — same DocsCollabSidebarPanel shell as Calendar invitations
 * and Docs review (ViewHeader, wash, titleTrailing close). Mount in
 * `workspace-app-layout__panel` or SideDrawer from DriveWorkspace.
 */
export function DriveDetailPanel({
  labels,
  file = null,
  preview,
  isStarred = false,
  inTrash = false,
  onClose,
  onDownload,
  onStar,
  onRename,
  onMove,
  onDelete,
  canShare,
  canManageStructure,
  onShare,
  showCloseButton = true,
  locationLabel,
  selectedCount = 0,
  selectionActions = [],
}: DriveDetailPanelProps) {
  const multiSelect = selectedCount > 1;
  const isEmpty = file == null && !multiSelect;
  const canDownload = useCanDownloadDriveItem(file, inTrash);

  const actions =
    file && !multiSelect && onDownload && onStar && onRename && onMove && onDelete
      ? buildDriveFileActions(
          labels,
          {
            isStarred,
            inTrash,
            isFolder: file.kind === "folder",
            canDownload,
            canShare,
            canManageStructure,
          },
          {
            onDownload,
            onStar,
            onRename,
            onMove,
            onDelete,
            onShare,
          },
        )
      : [];

  return (
    <DocsCollabSidebarPanel
      className="drive-detail-panel"
      ariaLabel={labels.detailSidebarTitle}
      title={labels.detailSidebarTitle}
      closeLabel={labels.detailClosePanel}
      onClose={onClose}
      showCloseButton={showCloseButton}
      headerActions={actions.length > 0 ? <DriveDetailActionBar actions={actions} /> : undefined}
      empty={isEmpty}
      emptyLabel={labels.detailEmpty}
      listClassName="drive-detail-panel__content"
    >
      {multiSelect ? (
        <MultiSelectionView
          size="compact"
          count={selectedCount}
          label={labels.detailMultipleSelection}
          actions={selectionActions}
        />
      ) : file ? (
        <>
          <div className="drive-detail-panel__preview">
            <FilePreview
              fileKind={file.kind}
              fileName={file.title}
              fileApiPath={file.apiPath}
              preview={preview}
              variant="detail"
              textMode="scrollable"
              mediaClassName="drive-detail-panel__preview-media"
              videoControls
            />
          </div>
          <div className="drive-detail-panel__path">
            <Tag
              label={locationLabel ?? file.location ?? file.parent}
              icon={<HardDrive className="size-3.5 opacity-70" />}
            />
          </div>
          <h1 className="drive-detail-panel__title">{file.title}</h1>
          <dl className="drive-detail-panel__meta">
            <Row label={labels.listColumnKind} value={DRIVE_KIND_LABEL[file.kind]} />
            {file.kind === "folder" ? null : (
              <Row label={labels.listColumnSize} value={file.size} />
            )}
            <Row label={labels.listColumnLastModified} value={formatDriveModified(file)} />
          </dl>
          {file.body.map((p, i) => (
            <p key={i} className="drive-detail-panel__body">
              {p}
            </p>
          ))}
        </>
      ) : null}
    </DocsCollabSidebarPanel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="drive-detail-panel__meta-row">
      <dt className="drive-detail-panel__meta-label">{label}</dt>
      <dd className="drive-detail-panel__meta-value">{value}</dd>
    </div>
  );
}
