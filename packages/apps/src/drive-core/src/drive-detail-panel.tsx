import { Download, HardDrive } from "lucide-react";
import { Tag } from "@/tag/src/tag";
import { useAppToast } from "@/hooks/use-app-toast";
import { DriveDetailActionBar } from "@/drive-core/src/drive-detail-action-bar";
import { buildDriveFileActions } from "@/drive-core/src/drive-file-action-builders";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import { FilePreview } from "@/file-preview/src/file-preview";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";
import { DocsCollabSidebarPanel } from "@/text-editor-core/docs-collab/docs-collab-card";
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
}: DriveDetailPanelProps) {
  const { show } = useAppToast();
  const isEmpty = file == null;

  const actions =
    !isEmpty && onDownload && onStar && onRename && onMove && onDelete
      ? buildDriveFileActions(
          labels,
          {
            isStarred,
            inTrash,
            canDownload: file.kind !== "folder",
            canShare,
            canManageStructure,
          },
          {
            onDownload: () => {
              onDownload();
              show("Download started", { icon: <Download className="size-4" /> });
            },
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
      {file ? (
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
            <Tag label={file.parent} icon={<HardDrive className="size-3.5 opacity-70" />} />
          </div>
          <h1 className="drive-detail-panel__title">{file.title}</h1>
          <dl className="drive-detail-panel__meta">
            <Row label="Type" value={file.kind} />
            <Row label="Size" value={file.size} />
            <Row label="Modified" value={file.date} />
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
