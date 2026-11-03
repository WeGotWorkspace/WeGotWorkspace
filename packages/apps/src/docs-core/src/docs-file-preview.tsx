import { Component, type ErrorInfo, type ReactNode, useLayoutEffect, useRef } from "react";
import { TextEditor } from "@/text-editor-core/src";
import { docsEditorFormatFromFileName } from "@/docs-core/src/docs-editor-format";
import { cn } from "@/lib/utils";
import "@/docs-core/src/docs-file-preview.css";

export type DocsFilePreviewVariant = "default" | "tile";

export type DocsFilePreviewProps = {
  fileName: string;
  fileApiPath?: string;
  content: string;
  className?: string;
  fallback?: ReactNode;
  variant?: DocsFilePreviewVariant;
};

type DocsFilePreviewBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type DocsFilePreviewBoundaryState = {
  hasError: boolean;
};

class DocsFilePreviewBoundary extends Component<
  DocsFilePreviewBoundaryProps,
  DocsFilePreviewBoundaryState
> {
  state: DocsFilePreviewBoundaryState = { hasError: false };

  static getDerivedStateFromError(): DocsFilePreviewBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[DocsFilePreview]", error, info);
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function DocsFilePreviewTileScale({ children }: { children: ReactNode }) {
  const scaleRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scaleEl = scaleRef.current;
    const pageEl = pageRef.current;
    if (!scaleEl || !pageEl) return;

    const syncScale = () => {
      const containerHeight = scaleEl.clientHeight;
      const pageHeight = pageEl.scrollHeight;
      if (containerHeight <= 0 || pageHeight <= 0) return;
      pageEl.style.setProperty(
        "--docs-file-preview-tile-scale",
        String(containerHeight / pageHeight),
      );
    };

    syncScale();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(syncScale);
    observer.observe(scaleEl);
    observer.observe(pageEl);

    return () => observer.disconnect();
  }, [children]);

  return (
    <div ref={scaleRef} className="docs-file-preview__tile-scale">
      <div ref={pageRef} className="docs-file-preview__tile-page">
        {children}
      </div>
    </div>
  );
}

function DocsFilePreviewEditor({
  fileName,
  fileApiPath,
  content,
  className,
  variant = "default",
}: DocsFilePreviewProps) {
  const format = docsEditorFormatFromFileName(fileName, fileApiPath);
  const isTile = variant === "tile";

  const editor = (
    <TextEditor
      key={`${fileName}:${content.length}`}
      format={format}
      content={content}
      editable={false}
      formatBar={false}
      sheetFill={!isTile}
      sheetVariant={format === "text" ? "inline" : "sheet"}
      className="docs-file-preview__editor"
    />
  );

  return (
    <div
      className={cn("docs-file-preview", isTile && "docs-file-preview--tile", className)}
      data-variant={variant}
      // The read-only preview scrolls; keyboard users need to reach it (tiles are clipped).
      {...(isTile ? {} : { role: "region", "aria-label": fileName, tabIndex: 0 })}
    >
      {isTile ? <DocsFilePreviewTileScale>{editor}</DocsFilePreviewTileScale> : editor}
    </div>
  );
}

/** Read-only Docs editor surface for drive file previews (grid tiles / detail pane). */
export function DocsFilePreview({
  fileName,
  fileApiPath,
  content,
  className,
  fallback = null,
  variant = "default",
}: DocsFilePreviewProps) {
  return (
    <DocsFilePreviewBoundary fallback={fallback}>
      <DocsFilePreviewEditor
        fileName={fileName}
        fileApiPath={fileApiPath}
        content={content}
        className={className}
        variant={variant}
      />
    </DocsFilePreviewBoundary>
  );
}
