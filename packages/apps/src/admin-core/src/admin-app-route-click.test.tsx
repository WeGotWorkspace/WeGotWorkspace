import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-mock-routes";

function mockDomApis() {
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
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView = vi.fn();
}

function clickSidebarSection(label: string | RegExp) {
  const sidebar = screen.getByRole("complementary");
  fireEvent.click(within(sidebar).getByRole("button", { name: label }));
}

async function renderAdminApp(initialPath: string) {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createMockWeGotWorkspaceRouter(history);
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "Users & Teams" });
  return { history, router };
}

describe("AdminApp sidebar → URL", { timeout: 15_000 }, () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  it("restores the Updates pane from /admin/updates", async () => {
    const { history } = await renderAdminApp("/admin/updates");
    expect(history.location.pathname).toBe("/admin/updates");
    expect(await screen.findByText("Version")).toBeTruthy();
  });

  it("restores the matching pane when the router navigates to /admin/email-delivery", async () => {
    const { history, router } = await renderAdminApp("/admin");
    await router.navigate({ to: "/admin/$section", params: { section: "email-delivery" } });
    await waitFor(() => {
      expect(history.location.pathname).toBe("/admin/email-delivery");
    });
    expect(await screen.findByText("Sending")).toBeTruthy();
  });

  it("writes /admin/email-delivery when the user picks Email delivery", async () => {
    const { history } = await renderAdminApp("/admin");
    clickSidebarSection(/^Email delivery$/);

    await waitFor(() => {
      expect(history.location.pathname).toBe("/admin/email-delivery");
    });
    expect(await screen.findByText("Sending")).toBeTruthy();
  });

  it("canonicalizes unknown /admin/:section paths to /admin", async () => {
    const { history } = await renderAdminApp("/admin/not-a-pane");
    await waitFor(() => {
      expect(history.location.pathname).toBe("/admin");
    });
    expect(await screen.findByRole("button", { name: "New user" })).toBeTruthy();
  });

  it("does not snap back to admin after navigating to another app", async () => {
    const { history, router } = await renderAdminApp("/admin");

    await router.navigate({ to: "/contacts" });

    await waitFor(() => {
      expect(history.location.pathname.startsWith("/contacts")).toBe(true);
      expect(history.location.pathname.startsWith("/admin")).toBe(false);
    });
  });
});

describe("AdminApp over http", { timeout: 15_000 }, () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("flags HTTPS as critical on Health and badges the sidebar", async () => {
    vi.stubGlobal("isSecureContext", false);
    await renderAdminApp("/admin/health");
    expect(await screen.findByText(/This site opens over http:\/\//)).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  it("passes the HTTPS check on https or localhost", async () => {
    vi.stubGlobal("isSecureContext", true);
    await renderAdminApp("/admin/health");
    expect(await screen.findByText("This site opens over a secure connection.")).toBeTruthy();
  });
});
