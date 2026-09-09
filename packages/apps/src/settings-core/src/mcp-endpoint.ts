/** Path assistants use for the instance MCP server (`docs/mcp-connect.md`). */
export const MCP_ENDPOINT_PATH = "/mcp";

/**
 * MCP URL to paste in Claude / ChatGPT.
 * Uses the current origin the same way public share links do (`buildPublicShareUrl`).
 */
export function buildMcpEndpointUrl(
  origin: string | undefined = typeof window !== "undefined" ? window.location?.origin : undefined,
): string {
  const base = origin?.replace(/\/$/, "") ?? "";
  if (!base) return MCP_ENDPOINT_PATH;
  return `${base}${MCP_ENDPOINT_PATH}`;
}

/** Storybook / test fixture — same host as `docs/mcp-connect.md`. */
export const STORY_MCP_ENDPOINT_URL = "https://workspace.example.com/mcp";
