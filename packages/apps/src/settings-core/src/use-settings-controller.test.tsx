import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { useSettingsController } from "@/settings-core/src/use-settings-controller";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

function bootstrapData(mcpEnabled: boolean) {
  return createSettingsAppBootstrap({
    data: { ...createSettingsAppBootstrap().data, mcpEnabled },
  }).data;
}

describe("useSettingsController MCP kill-switch", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });
  it("omits the assistants section when MCP is disabled", () => {
    const { result } = renderHook(() =>
      useSettingsController({
        data: bootstrapData(false),
        initialSection: "assistants",
      }),
    );

    expect(result.current.sections.map((section) => section.id)).toEqual([
      "profile",
      "memberships",
      "mail",
      "offline",
    ]);
    expect(result.current.section).toBe("profile");
    expect(result.current.currentSection.id).toBe("profile");
  });

  it("keeps assistants selected when MCP is enabled", () => {
    const { result } = renderHook(() =>
      useSettingsController({
        data: bootstrapData(true),
        initialSection: "assistants",
      }),
    );

    expect(result.current.section).toBe("assistants");
    expect(result.current.currentSection.id).toBe("assistants");
  });

  it("ignores selecting assistants when MCP is disabled", () => {
    const { result } = renderHook(() =>
      useSettingsController({
        data: bootstrapData(false),
      }),
    );

    act(() => {
      result.current.selectSection("assistants");
    });

    expect(result.current.section).toBe("profile");
    expect(result.current.currentSection.id).toBe("profile");
  });
});
