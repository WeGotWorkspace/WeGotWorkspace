import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminSecurityChecks,
  adminHealthIssueCount,
  adminSecurityChecks,
} from "@/admin-core/src/admin-health-pane";
import type { AdminSecurityWarning } from "@/lib/models/admin-types";
import { isLoopbackOrigin } from "@/admin-core/src/admin-workspace-utils";

const APP_URL_UNSET: AdminSecurityWarning = {
  code: "app_url_unset",
  message: "APP_URL is not set.",
};
const APP_URL_LOCAL: AdminSecurityWarning = {
  code: "app_url_local",
  message: "APP_URL is a local address (http://localhost:8080).",
};
const DEBUG_ON: AdminSecurityWarning = { code: "app_debug_on", message: "APP_DEBUG is on." };
const DATA_DIR: AdminSecurityWarning = {
  code: "data_dir_published",
  message: "The data directory is in the web root.",
};

const PUBLIC = "https://team.example.org";

function checks(
  overrides: Partial<Parameters<typeof adminSecurityChecks>[0]> = {},
): ReturnType<typeof adminSecurityChecks> {
  return adminSecurityChecks({
    warnings: [],
    secureContext: true,
    reachableDirectories: [],
    baseUri: "/",
    origin: PUBLIC,
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
});

describe("adminSecurityChecks", () => {
  it("lists every check as OK on a clean install", () => {
    const all = checks();
    expect(all.map((check) => check.id)).toEqual(["https", "web-root", "debug", "env", "app-url"]);
    expect(all.every((check) => check.severity === "ok")).toBe(true);
    expect(adminHealthIssueCount(all)).toBe(0);
  });

  it("puts problems first: critical, then warning", () => {
    const all = checks({ secureContext: false, warnings: [DEBUG_ON, DATA_DIR] });
    expect(all.slice(0, 3).map((check) => [check.id, check.severity])).toEqual([
      ["https", "critical"],
      ["web-root", "critical"],
      ["debug", "warning"],
    ]);
    expect(adminHealthIssueCount(all)).toBe(3);
  });

  it("names the folders the browser could download", () => {
    const webRoot = checks({ reachableDirectories: ["packages", "vendor"] }).find(
      (check) => check.id === "web-root",
    );
    expect(webRoot?.severity).toBe("critical");
    expect(webRoot?.description).toMatch(/^packages, vendor can be downloaded/);
    expect(webRoot?.fixUrl).toMatch(/INSTALL\.md/);
  });

  it("offers the public address plus the install base for an unset APP_URL", () => {
    const appUrl = checks({ warnings: [APP_URL_UNSET], baseUri: "/office/" }).find(
      (check) => check.id === "app-url",
    );
    expect(appUrl?.severity).toBe("warning");
    expect(appUrl?.useAddress).toBe("https://team.example.org/office");
  });

  it("only informs on a local address: no fix offered, not counted", () => {
    const all = checks({ warnings: [APP_URL_LOCAL], origin: "http://localhost:8080" });
    const appUrl = all.find((check) => check.id === "app-url");
    expect(appUrl?.severity).toBe("notice");
    expect(appUrl?.useAddress).toBeUndefined();
    expect(adminHealthIssueCount(all)).toBe(0);
  });

  it("still shows a warning it does not know, in the server's words", () => {
    // A newer API may send a code this build does not know.
    const newer = {
      code: "new_thing",
      message: "Something new.",
    } as unknown as AdminSecurityWarning;
    const unknown = checks({ warnings: [newer] });
    expect(unknown[0]).toMatchObject({
      id: "new_thing",
      severity: "warning",
      description: "Something new.",
    });
  });
});

describe("AdminSecurityChecks", () => {
  it("shows a tag per row and sends the address on Use this address", async () => {
    const onUseThisAddress = vi.fn().mockResolvedValue(true);
    render(
      <AdminSecurityChecks
        checks={checks({ warnings: [APP_URL_UNSET] })}
        onUseThisAddress={onUseThisAddress}
      />,
    );

    expect(screen.getByText("Public host address")).toBeTruthy();
    expect(screen.getByText("Warning")).toBeTruthy();
    expect(screen.getAllByText("OK")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Use this address" }));
    await waitFor(() => {
      expect(onUseThisAddress).toHaveBeenCalledWith("https://team.example.org");
    });
  });

  it("links a critical check to its fix", () => {
    render(<AdminSecurityChecks checks={checks({ secureContext: false })} />);
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Fix/ }).getAttribute("href")).toMatch(
      /#requirement-https$/,
    );
  });
});

describe("isLoopbackOrigin", () => {
  it("matches the hosts the API treats as an unset APP_URL", () => {
    for (const origin of [
      "http://localhost:8080",
      "http://127.0.0.1",
      "http://[::1]:9080",
      "https://localhost",
    ]) {
      expect(isLoopbackOrigin(origin), origin).toBe(true);
    }
    for (const origin of ["https://team.example.org", "http://192.168.1.5:8080", "not a url"]) {
      expect(isLoopbackOrigin(origin), origin).toBe(false);
    }
  });
});
