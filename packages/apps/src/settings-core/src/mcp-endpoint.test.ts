import { describe, expect, it } from "vitest";
import {
  buildMcpEndpointUrl,
  MCP_ENDPOINT_PATH,
  STORY_MCP_ENDPOINT_URL,
} from "@/settings-core/src/mcp-endpoint";

describe("buildMcpEndpointUrl", () => {
  it("joins origin and /mcp", () => {
    expect(buildMcpEndpointUrl("https://workspace.example.com")).toBe(STORY_MCP_ENDPOINT_URL);
  });

  it("strips a trailing slash on the origin", () => {
    expect(buildMcpEndpointUrl("https://workspace.example.com/")).toBe(STORY_MCP_ENDPOINT_URL);
  });

  it("falls back to /mcp when origin is empty", () => {
    expect(buildMcpEndpointUrl("")).toBe(MCP_ENDPOINT_PATH);
  });
});
