import { FilePreview } from "@/file-preview/src/file-preview";
import { DocsFilePreview } from "@/docs-core/src/docs-file-preview";
import type { ChatLinkPreview as ChatLinkPreviewModel } from "@/chat-ui/src/chat-types";
import { chatFileKindFromName } from "@/chat-ui/src/chat-file-kind";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { cn } from "@/lib/utils";
import "@/file-preview/src/file-preview.css";
import "@/docs-core/src/docs-file-preview.css";
import "@/chat-ui/src/chat-link-preview.css";

export type ChatLinkPreviewProps = {
  preview: ChatLinkPreviewModel | null;
  className?: string;
};

function PreviewThumb({ preview }: { preview: ChatLinkPreviewModel }) {
  const fileName = preview.title ?? preview.url;
  const fileKind = chatFileKindFromName(fileName);

  if (preview.kind === "internal-docs" && preview.content) {
    return (
      <DocsFilePreview
        fileName={fileName.endsWith(".md") ? fileName : `${fileName}.md`}
        content={preview.content}
        variant="tile"
        fallback={
          <FilePreview
            fileKind="doc"
            fileName={fileName}
            variant="tile"
            fallbackClassName="size-10"
          />
        }
      />
    );
  }

  if (preview.kind === "internal-docs") {
    return <FilePreview fileKind="doc" fileName={fileName} variant="tile" />;
  }

  if (preview.kind === "internal-file") {
    return <FilePreview fileKind={fileKind} fileName={fileName} variant="tile" />;
  }

  return null;
}

export function ChatLinkPreview({ preview, className }: ChatLinkPreviewProps) {
  if (!preview) {
    return (
      <article className={cn("chat-link-preview chat-link-preview--missing", className)}>
        <div className="chat-link-preview__body">
          <p className="chat-link-preview__missing">{chatUiLabels.previewMissing}</p>
        </div>
      </article>
    );
  }

  const isInternal = preview.kind === "internal-file" || preview.kind === "internal-docs";
  const site =
    preview.siteName ?? (preview.kind === "external" ? chatUiLabels.previewExternal : undefined);

  return (
    <article className={cn("chat-link-preview", className)} data-kind={preview.kind}>
      {isInternal ? (
        <div className="chat-link-preview__thumb">
          <PreviewThumb preview={preview} />
        </div>
      ) : null}
      <div className="chat-link-preview__body">
        {site ? <p className="chat-link-preview__site">{site}</p> : null}
        <p className="chat-link-preview__title">{preview.title ?? preview.url}</p>
        {preview.description ? (
          <p className="chat-link-preview__description">{preview.description}</p>
        ) : null}
        <a
          className="chat-link-preview__link"
          href={preview.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {preview.url}
        </a>
      </div>
    </article>
  );
}
