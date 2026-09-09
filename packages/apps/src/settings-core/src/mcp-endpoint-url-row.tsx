import { useId, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { useAppToast } from "@/hooks/use-app-toast";
import { cn } from "@/lib/utils";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { shareLabels } from "@/share-ui/share-labels";
import { copyShareText } from "@/share-ui/share-path-utils";
import { FieldLabelRow } from "@/ui/field-label-row";
import "@/share-ui/share-ui.css";

import "./mcp-endpoint-url-row.css";

export type McpEndpointUrlRowProps = {
  url: string;
  inputId?: string;
  className?: string;
};

/** Readonly MCP connection URL with copy — shared by Admin and Settings. */
export function McpEndpointUrlRow({ url, inputId, className }: McpEndpointUrlRowProps): ReactNode {
  const reactId = useId();
  const fieldId = inputId ?? `mcp-endpoint${reactId.replace(/:/g, "")}`;
  const { showSuccess } = useAppToast();

  const handleCopy = async () => {
    const copied = await copyShareText(url);
    if (copied) {
      showSuccess(shareLabels.copiedLink);
    }
  };

  return (
    <div className={cn("mcp-endpoint-url-row", "share-dialog", className)}>
      <FieldLabelRow label="Connection URL" htmlFor={fieldId}>
        <div className="share-dialog__link-row">
          <ShareDialogInput
            id={fieldId}
            type="url"
            value={url}
            readOnly
            mono
            aria-label="Connection URL"
          />
          <IconButton
            type="button"
            label={shareLabels.copyLink}
            icon={<Copy className="size-3.5" aria-hidden />}
            size="sm"
            variant="outline"
            disabled={!url}
            onClick={() => {
              void handleCopy();
            }}
          />
        </div>
      </FieldLabelRow>
    </div>
  );
}
