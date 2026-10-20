import { Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import {
  iconForMailAttachment,
  mailAttachmentMetaLabel,
} from "@/mail-core/src/mail-attachment-utils";

import "@/mail-core/src/mail-attachment-chip.css";

export type MailAttachmentChipProps = {
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Direct download URL; renders the chip as a link. */
  downloadHref?: string;
  /** Download handler when no direct URL is available. */
  onDownload?: () => void;
  /** Remove handler; whole chip acts as remove control. */
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function MailAttachmentChip({
  name,
  mimeType,
  sizeBytes,
  downloadHref,
  onDownload,
  onRemove,
  removeLabel = `Remove ${name}`,
  disabled = false,
  className,
}: MailAttachmentChipProps) {
  const Icon = iconForMailAttachment(mimeType, name);
  const metaLabel = mailAttachmentMetaLabel(name, sizeBytes);
  const isRemove = Boolean(onRemove);
  const actionLabel = isRemove ? removeLabel : `Download ${name}`;
  // The name and meta stay in the accessible name so it holds the visible text (WCAG 2.5.3).
  const accessibleName = metaLabel ? `${actionLabel} ${metaLabel}` : actionLabel;
  const TrailingIcon = isRemove ? X : Download;

  const chipClassName = cn("mail-attachment-chip", "mail-attachment-chip--interactive", className);

  const chipBody = (
    <>
      <span className="mail-attachment-chip__icon">
        <Icon aria-hidden="true" />
      </span>
      <div className="mail-attachment-chip__copy">
        <div className="mail-attachment-chip__name">{name}</div>
        {/* Keeps name and meta separate words in the text alternative. */}{" "}
        {metaLabel ? <div className="mail-attachment-chip__meta">{metaLabel}</div> : null}
      </div>
      <TrailingIcon
        className="mail-attachment-chip__action mail-attachment-chip__action--trailing size-4"
        aria-hidden="true"
      />
    </>
  );

  const chipControl =
    !isRemove && downloadHref ? (
      <a
        href={downloadHref}
        download={name}
        rel="noopener"
        className={chipClassName}
        aria-label={accessibleName}
      >
        {chipBody}
      </a>
    ) : (
      <button
        type="button"
        className={chipClassName}
        aria-label={accessibleName}
        disabled={disabled || (isRemove ? !onRemove : !onDownload)}
        onClick={isRemove ? onRemove : onDownload}
      >
        {chipBody}
      </button>
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="mail-attachment-chip__trigger">{chipControl}</span>
      </TooltipTrigger>
      <TooltipContent>{actionLabel}</TooltipContent>
    </Tooltip>
  );
}
