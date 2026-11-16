import { createContext, useContext, type ComponentType, type ReactNode } from "react";

/** What `FilePreview` hands the Markdown renderer for a `docs` preview. */
export type FilePreviewMarkdownRendererProps = {
  fileName: string;
  fileApiPath?: string;
  content: string;
  className?: string;
  /** Shown when the renderer fails. */
  fallback?: ReactNode;
  variant?: "default" | "tile";
};

export type FilePreviewMarkdownRenderer = ComponentType<FilePreviewMarkdownRendererProps>;

const FilePreviewMarkdownRendererContext = createContext<FilePreviewMarkdownRenderer | null>(null);

/**
 * The slot `FilePreview` renders Markdown and text documents through (#2116).
 * The shell fills it with Docs' read-only editor, so this primitive does not
 * import Docs. Without a renderer, a document preview shows its plain-text
 * fallback.
 */
export function FilePreviewMarkdownRendererProvider({
  renderer,
  children,
}: {
  renderer: FilePreviewMarkdownRenderer;
  children: ReactNode;
}) {
  return (
    <FilePreviewMarkdownRendererContext.Provider value={renderer}>
      {children}
    </FilePreviewMarkdownRendererContext.Provider>
  );
}

export function useFilePreviewMarkdownRenderer(): FilePreviewMarkdownRenderer | null {
  return useContext(FilePreviewMarkdownRendererContext);
}
