import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import {
  TextEditorSource,
  type TextEditorSourceProps,
} from "@/text-editor-core/src/text-editor-source";
import type { TextEditorPageSetup } from "@/lib/page-format";

type TextEditorFrameProps = {
  format: TextEditorContentFormat;
  pageSetup?: TextEditorPageSetup | null;
  sheetFill: boolean;
  viewSource: boolean;
  /** The source pane, shown beside the formatted view when `viewSource` is on. */
  source: Omit<TextEditorSourceProps, "formatLabel" | "className">;
  formatBar: ReactNode;
  sheet: ReactNode;
  className?: string;
};

/** The editor root both the local and the collaborative editor render: format bar, sheet, and the optional source pane. */
export function TextEditorFrame({
  format,
  pageSetup,
  sheetFill,
  viewSource,
  source,
  formatBar,
  sheet,
  className,
}: TextEditorFrameProps) {
  const formatLabel = format === "markdown" ? "Markdown" : format === "text" ? "Text" : "HTML";
  return (
    <div
      className={cn(
        "text-editor flex w-full flex-col",
        sheetFill ? "h-full min-h-0 flex-1" : "h-full w-full",
        viewSource && "text-editor--view-source",
        className,
      )}
      data-paper={pageSetup?.format}
    >
      {viewSource ? (
        <div className="text-editor__body min-h-0 flex-1">
          <TextEditorSource
            {...source}
            formatLabel={formatLabel}
            className="text-editor__source min-h-0"
          />
          <div className="text-editor__formatted flex min-h-0 flex-1 flex-col">
            {formatBar}
            {sheet}
          </div>
        </div>
      ) : (
        <>
          {formatBar}
          {sheet}
        </>
      )}
    </div>
  );
}
