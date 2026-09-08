import { describe, expect, it } from "vitest";
import { isPwaNavigateFallbackDenied } from "@/lib/offline/pwa-navigate-fallback-denylist";

describe("isPwaNavigateFallbackDenied", () => {
  it("lets SPA routes use the index.html navigation fallback", () => {
    expect(isPwaNavigateFallbackDenied("/drive")).toBe(false);
    expect(isPwaNavigateFallbackDenied("/settings/assistants")).toBe(false);
  });

  it("sends MCP OAuth consent and discovery to the network", () => {
    expect(
      isPwaNavigateFallbackDenied(
        "/oauth/authorize?response_type=code&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fmcp-oauth-client-metadata",
      ),
    ).toBe(true);
    expect(isPwaNavigateFallbackDenied("/oauth/session")).toBe(true);
    expect(isPwaNavigateFallbackDenied("/mcp")).toBe(true);
    expect(isPwaNavigateFallbackDenied("/.well-known/oauth-authorization-server")).toBe(true);
    expect(isPwaNavigateFallbackDenied("/.well-known/oauth-protected-resource/mcp")).toBe(true);
  });

  it("keeps existing API and apps aliases on the network", () => {
    expect(isPwaNavigateFallbackDenied("/api/v1/health")).toBe(true);
    expect(isPwaNavigateFallbackDenied("/apps/shell/index.html")).toBe(true);
  });
});
