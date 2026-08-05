#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { runPnpmCommand, runResultToJson } from "./run-command.js";
import { getVerificationContext } from "./verification-context.js";

const MINUTE_MS = 60_000;

const tailLinesSchema = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Number of trailing output lines to return (default 200)");

const runToolSchema = z.object({
  tailLines: tailLinesSchema,
});

const server = new McpServer({
  name: "wgw-verify",
  version: "1.0.0",
});

function registerRunTool(
  name: string,
  title: string,
  description: string,
  args: string[],
  label: string,
  timeoutMs: number,
): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: runToolSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ tailLines }) => {
      const result = await runPnpmCommand({
        args,
        label,
        timeoutMs,
        tailLines,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: runResultToJson(result),
          },
        ],
      };
    },
  );
}

registerRunTool(
  "run_apps_done_gate",
  "Run apps done gate",
  "Run pnpm test:apps-done-gate (typecheck + Vitest + Storybook smoke + coverage). Timeout: 15 minutes.",
  ["test:apps-done-gate"],
  "APPS DONE GATE",
  15 * MINUTE_MS,
);

registerRunTool(
  "run_api_done_gate",
  "Run API done gate",
  "Run pnpm test:api-done-gate (API feature test suites). Timeout: 15 minutes.",
  ["test:api-done-gate"],
  "API DONE GATE",
  15 * MINUTE_MS,
);

registerRunTool(
  "run_ci_quality",
  "Run CI quality",
  "Run pnpm run ci:quality (full API + apps quality stack). Timeout: 30 minutes.",
  ["run", "ci:quality"],
  "CI QUALITY",
  30 * MINUTE_MS,
);

registerRunTool(
  "run_lint",
  "Run lint",
  "Run pnpm lint. Timeout: 5 minutes.",
  ["lint"],
  "LINT",
  5 * MINUTE_MS,
);

registerRunTool(
  "run_typecheck",
  "Run typecheck",
  "Run pnpm typecheck. Timeout: 5 minutes.",
  ["typecheck"],
  "TYPECHECK",
  5 * MINUTE_MS,
);

registerRunTool(
  "run_format_check",
  "Run format check",
  "Run pnpm format:check. Timeout: 5 minutes.",
  ["format:check"],
  "FORMAT CHECK",
  5 * MINUTE_MS,
);

server.registerTool(
  "get_verification_context",
  {
    title: "Get verification context",
    description:
      "Read POLICY.md, smells.md, and done-checklist.md for review/handoff context.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const context = await getVerificationContext();

    return {
      content: [
        {
          type: "text" as const,
          text: context,
        },
      ],
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("MCP server failed to start:", error);
  process.exit(1);
});
