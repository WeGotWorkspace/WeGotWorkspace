import { FileSliders, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { Button } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import {
  docsPageSetupButtonLabel,
  docsPageSetupMenuItems,
  docsPaperLabel,
  type DocsPageSetupMenuInput,
} from "@/docs-core/src/docs-page-setup-menu-items";
import type { TextEditorPageSetup } from "@/lib/page-format";

export type DocsPageSetupMenuProps = DocsPageSetupMenuInput & { disabled?: boolean };

/** No paper: the page setup icon. Paper: a sheet standing up or lying down. */
export function DocsPageSetupIcon({ pageSetup }: { pageSetup: TextEditorPageSetup }) {
  if (pageSetup.format === "none") return <FileSliders />;
  return pageSetup.orientation === "landscape" ? <RectangleHorizontal /> : <RectangleVertical />;
}

/** Docs header control for the person's page setup (#1810). Not saved in the document. */
export function DocsPageSetupMenu({ disabled = false, ...props }: DocsPageSetupMenuProps) {
  return (
    <DropdownMenu
      align="end"
      sideOffset={10}
      disabled={disabled}
      items={docsPageSetupMenuItems(props)}
      contentClassName="min-w-[11rem] p-1.5"
      trigger={
        <Button
          label={docsPaperLabel(props.pageSetup.format, props.labels)}
          aria-label={docsPageSetupButtonLabel(props.pageSetup, props.labels)}
          title={docsPageSetupButtonLabel(props.pageSetup, props.labels)}
          icon={<DocsPageSetupIcon pageSetup={props.pageSetup} />}
          size="md"
          variant="outline"
          disabled={disabled}
          className="docs-workspace__page-setup-trigger"
        />
      }
    />
  );
}
