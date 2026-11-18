import { ExternalLink } from "lucide-react";
import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { McpEndpointUrlRow } from "@/settings-core/src/mcp-endpoint-url-row";

import "./connect-assistant-dialog.css";

export const MCP_CONNECT_GUIDE_HREF =
  "https://github.com/WeGotWorkspace/WeGotWorkspace/blob/main/docs/mcp-connect.md";

export type ConnectAssistantDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpointUrl: string;
};

/** How to add this workspace to an assistant: the connection URL and where it goes. */
export function ConnectAssistantDialog({
  open,
  onOpenChange,
  endpointUrl,
}: ConnectAssistantDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="connect-assistant-dialog">
        <DialogHeader>
          <DialogTitle>Connect an assistant</DialogTitle>
          <DialogDescription>
            Add this workspace to your assistant as a custom connector. You then sign in here and
            choose what it may do.
          </DialogDescription>
        </DialogHeader>
        <McpEndpointUrlRow url={endpointUrl} inputId="connect-assistant-endpoint" />
        <ol className="connect-assistant-dialog__steps">
          <li>
            <strong>Claude, ChatGPT or Mistral:</strong> open Settings → Connectors, add a custom
            connector, and paste the connection URL.
          </li>
          <li>
            <strong>Claude Code:</strong> run{" "}
            <code>claude mcp add --transport http wegotworkspace {endpointUrl}</code>
          </li>
        </ol>
        <DialogFooter
          start={
            <Button variant="outline" asChild>
              <a href={MCP_CONNECT_GUIDE_HREF} target="_blank" rel="noreferrer">
                <span className="button__label">Connect guide</span>
                <span className="button__trailing-icon" aria-hidden>
                  <ExternalLink />
                </span>
              </a>
            </Button>
          }
        >
          <Button label="Done" onClick={() => onOpenChange(false)} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
