import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

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
  const router = createWeGotWorkspaceRouter({ mode: "mock", history });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "Users & Groups" });
  return { history, router };
}

describe("AdminApp sidebar → URL", { timeout: 15_000 }, () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  it("restores the Plugins pane from /admin/plugins", async () => {
    const { history } = await renderAdminApp("/admin/plugins");
    expect(history.location.pathname).toBe("/admin/plugins");
    expect(await screen.findByText("Plugin lifecycle")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New user" })).toBeNull();
  });

  it("restores the Updates pane from /admin/updates", async () => {
    const { history } = await renderAdminApp("/admin/updates");
    expect(history.location.pathname).toBe("/admin/updates");
    expect(await screen.findByText("Release status")).toBeTruthy();
  });

  it("restores the matching pane when the router navigates to /admin/mail", async () => {
    const { history, router } = await renderAdminApp("/admin");
    await router.navigate({ to: "/admin/$section", params: { section: "mail" } });
    await waitFor(() => {
      expect(history.location.pathname).toBe("/admin/mail");
    });
    expect(await screen.findByText("IMAP (incoming)")).toBeTruthy();
  });

  it("writes /admin/plugins when the user picks Plugins and back/forward restore the pane", async () => {
    const { history } = await renderAdminApp("/admin");
    expect(await screen.findByRole("button", { name: "New user" })).toBeTruthy();

    clickSidebarSection("Plugins");

    await waitFor(() => {
      expect(history.location.pathname).toBe("/admin/plugins");
    });
    expect(await screen.findByText("Plugin lifecycle")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New user" })).toBeNull();

    history.back();
    await waitFor(() => {
      expect(history.location.pathname).toBe("/admin");
    });
    expect(await screen.findByRole("button", { name: "New user" })).toBeTruthy();

    history.forward();
    await waitFor(() => {
      expect(history.location.pathname).toBe("/admin/plugins");
    });
    expect(await screen.findByText("Plugin lifecycle")).toBeTruthy();
  });

  it("writes /admin/mail when the user picks Mail", async () => {
    const { history } = await renderAdminApp("/admin");
    clickSidebarSection(/^Mail$/);

    await waitFor(() => {
      expect(history.location.pathname).toBe("/admin/mail");
    });
    expect(await screen.findByText("IMAP (incoming)")).toBeTruthy();
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
