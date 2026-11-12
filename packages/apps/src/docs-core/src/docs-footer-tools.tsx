import {
  DocsPageSetupMenu,
  type DocsPageSetupMenuProps,
} from "@/docs-core/src/docs-page-setup-menu";
import { Switch } from "@/ui/switch";

export type DocsFooterSourceToggle = {
  checked: boolean;
  disabled?: boolean;
  /** Visible switch label ("Source"). */
  label: string;
  /** Action / disabled reason for assistive tech and the tooltip. */
  ariaLabel: string;
  onToggle: () => void;
};

export type DocsFooterToolsProps = {
  pageSetup?: DocsPageSetupMenuProps;
  /** Left out for plain text: the document already is its source. */
  source?: DocsFooterSourceToggle;
};

/** Footer start: page size and source view sit with the document, not the title row. */
export function DocsFooterTools({ pageSetup, source }: DocsFooterToolsProps) {
  if (!pageSetup && !source) return null;
  return (
    <div className="docs-workspace__footer-tools">
      {pageSetup ? <DocsPageSetupMenu {...pageSetup} /> : null}
      {source ? (
        <label className="docs-workspace__source-switch" title={source.ariaLabel}>
          <Switch
            checked={source.checked}
            onCheckedChange={source.onToggle}
            disabled={source.disabled}
            aria-label={source.ariaLabel}
          />
          <span>{source.label}</span>
        </label>
      ) : null}
    </div>
  );
}
