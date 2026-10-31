import { FileSliders } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import {
  docsPageSetupMenuItems,
  type DocsPageSetupMenuInput,
} from "@/docs-core/src/docs-page-setup-menu-items";

export type DocsPageSetupMenuProps = DocsPageSetupMenuInput & { disabled?: boolean };

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
        <IconButton
          label={props.labels.pageSetup}
          icon={<FileSliders />}
          size="md"
          variant="outline"
          disabled={disabled}
          className="docs-workspace__page-setup-trigger"
        />
      }
    />
  );
}
