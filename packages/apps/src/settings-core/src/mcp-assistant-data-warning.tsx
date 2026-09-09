import type { ReactNode } from "react";
import { Callout } from "@/callout/src/callout";

import "./mcp-assistant-data-warning.css";

export const MCP_ASSISTANT_DATA_WARNING_TITLE = "Content you allow here leaves this instance";

export const MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE =
  "Data is sent to the assistant vendor’s model. You can revoke access later in Settings → Connected assistants.";

export type McpAssistantDataWarningProps = {
  /** Defaults to the consent-page body (includes “revoke later in Settings”). */
  message?: string;
};

/**
 * Warning for Connect-assistant OAuth consent. Not shown on Settings → Connected assistants.
 */
export function McpAssistantDataWarning({
  message = MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE,
}: McpAssistantDataWarningProps): ReactNode {
  return (
    <Callout
      className="mcp-assistant-data-warning"
      severity="warning"
      title={MCP_ASSISTANT_DATA_WARNING_TITLE}
      message={message}
    />
  );
}
