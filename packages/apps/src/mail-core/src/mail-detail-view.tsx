import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { DetailViewHeader } from "@/detail-view-header/src/detail-view-header";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { cn } from "@/lib/utils";
import { mailboxIconForLabel } from "@/mail-core/src/mailbox-icons";
import type { MailAttachment } from "@/types/mail";
import { MailAttachments } from "./mail-attachments";
import { MailBodyIframe } from "./mail-body-iframe";

const mailDetailTagColors = {
  primary: {
    color: "var(--mail-detail-tag-primary-fg)",
    backgroundColor: "var(--mail-detail-tag-primary-bg)",
  },
  muted: {
    backgroundColor: "var(--mail-detail-tag-muted-bg)",
    color: "var(--mail-detail-tag-muted-fg)",
  },
} as const;

type MailDetailViewProps = {
  /** Used for stable keys on body paragraphs when switching messages. */
  mailId: string;
  mailbox: string;
  date: string;
  title: string;
  emptySubjectLabel?: string;
  from: string;
  /** Second line under sender name, e.g. built with i18n: `email + detailToViewer("me")`. */
  senderMetaLine: string;
  body: string[];
  excerpt?: string;
  bodyHtml?: string;
  detailLoaded?: boolean;
  attachments?: MailAttachment[];
  buildAttachmentUrl?: (attachment: MailAttachment) => string | undefined;
  onDownloadAttachment?: (attachment: MailAttachment) => void;
  className?: string;
};

export function MailDetailView({
  mailId,
  mailbox,
  date,
  title,
  emptySubjectLabel = "(no subject)",
  from,
  senderMetaLine,
  body,
  excerpt,
  bodyHtml,
  detailLoaded = false,
  attachments,
  buildAttachmentUrl,
  onDownloadAttachment,
  className,
}: MailDetailViewProps) {
  const plainBody = useMemo(() => body.filter((p) => p.trim().length > 0).join("\n\n"), [body]);
  const plainBodyFallback = useMemo(
    () => plainBody || (excerpt ?? "").trim(),
    [plainBody, excerpt],
  );
  const hasHtmlBody = (bodyHtml ?? "").trim().length > 0;
  const showIframe = detailLoaded && hasHtmlBody;
  const showPlainBody = detailLoaded && !hasHtmlBody;

  return (
    <article className={cn("mail-detail-view", className)}>
      <DetailViewHeader
        topTags={[
          {
            key: "mailbox",
            label: mailbox,
            icon: mailboxIconForLabel(mailbox),
            colors: mailDetailTagColors.primary,
          },
          {
            key: "date",
            label: date,
            icon: <CalendarDays className="size-3.5 opacity-70" />,
            colors: mailDetailTagColors.muted,
          },
        ]}
        title={title}
        emptyTitleLabel={emptySubjectLabel}
        titleClassName="mail-detail-view__title"
      />

      <div className="mail-detail-view__sender-row">
        <UserAvatar displayName={from} subtitle={senderMetaLine} size="lg" />
      </div>

      {showIframe ? (
        <MailBodyIframe key={`${mailId}-body-frame`} bodyHtml={bodyHtml ?? ""} />
      ) : showPlainBody ? (
        <div className="mail-detail-view__body">{plainBodyFallback}</div>
      ) : null}

      {attachments && attachments.length > 0 ? (
        <MailAttachments
          attachments={attachments}
          buildDownloadUrl={buildAttachmentUrl}
          onDownload={onDownloadAttachment}
        />
      ) : null}
    </article>
  );
}
