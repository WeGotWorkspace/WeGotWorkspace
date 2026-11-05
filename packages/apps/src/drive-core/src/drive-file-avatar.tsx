import { useState, type CSSProperties } from "react";
import { Folder, HardDrive } from "lucide-react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { canBrowserPreviewImage, extensionFromFileName } from "@/drive-core/src/drive-file-utils";
import { extensionAvatarLabel, extensionHue } from "@/drive-core/src/drive-file-avatar-label";
import { kindIcon } from "@/drive-core/src/drive-icons";
import { isDrivePickerRootFile } from "@/drive-core/src/drive-folder-picker-utils";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";
import { cn } from "@/lib/utils";
import "@/drive-core/src/drive-file-avatar.css";

/**
 * The square at the start of a grid tile (suite file norm). An image shows its
 * thumbnail; any other file shows its extension on that extension's own colour;
 * a folder shows the folder (or drive) icon on a quiet wash.
 */
export function DriveFileAvatar({
  file,
  preview,
  size = "md",
}: {
  file: DriveFile;
  preview?: FilePreviewPayload;
  /** `sm` for list rows; `md` for grid tiles. */
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "drive-file-avatar--sm" : undefined;
  const [failed, setFailed] = useState(false);

  if (file.kind === "folder") {
    const Icon = isDrivePickerRootFile(file) ? HardDrive : Folder;
    return (
      <span
        className={cn("drive-file-avatar drive-file-avatar--folder", sizeClass)}
        aria-hidden="true"
      >
        <Icon className="drive-folder-tile__icon" />
      </span>
    );
  }

  const thumbnailUrl =
    file.kind === "image" &&
    preview?.kind === "blob-url" &&
    !failed &&
    canBrowserPreviewImage(file.title)
      ? preview.url
      : null;

  if (thumbnailUrl) {
    return (
      <span
        className={cn("drive-file-avatar drive-file-avatar--thumbnail", sizeClass)}
        aria-hidden="true"
      >
        <img src={thumbnailUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      </span>
    );
  }

  const extension = extensionFromFileName(file.title);
  const label = extensionAvatarLabel(file.title);
  if (!label) {
    return (
      <span
        className={cn("drive-file-avatar drive-file-avatar--kind", sizeClass)}
        aria-hidden="true"
      >
        {kindIcon[file.kind]}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "drive-file-avatar drive-file-avatar--extension",
        label.length > 3 && "drive-file-avatar--long",
        sizeClass,
      )}
      style={{ "--file-avatar-hue": extensionHue(extension) } as CSSProperties}
      data-extension={extension}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}
