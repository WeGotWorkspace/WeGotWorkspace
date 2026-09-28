import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { createMailAppBootstrap } from "@/lib/api/mock/mail-bootstrap";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { MailWorkspace } from "@/mail-core/src/mail-workspace";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import { SettingsDialogProvider } from "@/settings-core/src/settings-dialog-provider";
import {
  reachabilityFromShell,
  SettingsReachabilityProvider,
} from "@/settings-core/src/settings-reachability";
import { resetSettingsRegistryForTests } from "@/settings-core/src/settings-registry";
import { settingsSectionFromLocation } from "@/settings-core/src/settings-section";
import type { BuiltinPanelId } from "@/settings-core/src/settings-types";
import type { SettingsDialogApi } from "@/settings-core/src/settings-dialog-provider";
import { SettingsWorkspace } from "@/settings-core/src/settings-workspace";
import { WorkspaceAppSettingsFooter } from "@/settings-core/src/workspace-app-settings-footer";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(() => "toast-1"),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

function mockDomApis() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      addEventListener: vi.fn(),
      removeListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
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

function SettingsFromLocation() {
  const location = useLocation();
  const section = settingsSectionFromLocation(location.pathname);
  return <SettingsWorkspace {...createSettingsAppBootstrap()} section={section} />;
}

async function renderHosted(ui: ReactNode, initialPath = "/mail") {
  registerBuiltinSettings();
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const rootRoute = createRootRoute({
    component: () => (
      <SettingsReachabilityProvider value={reachabilityFromShell({})}>
        <SettingsDialogProvider>
          <Outlet />
        </SettingsDialogProvider>
      </SettingsReachabilityProvider>
    ),
  });
  const mailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/mail",
    component: () => <>{ui}</>,
  });
  const notesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/notes",
    component: () => <>{ui}</>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: SettingsFromLocation,
  });
  const settingsSectionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: SettingsFromLocation,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([mailRoute, notesRoute, settingsRoute, settingsSectionRoute]),
    history,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return { history, router };
}

function footerSettingsButton() {
  const footer = document.querySelector(".workspace-sidebar-account-footer");
  if (!(footer instanceof HTMLElement)) return null;
  return within(footer).queryByRole("button", { name: "Settings" });
}

describe("settings dialog and in-app footer", () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
    resetSettingsRegistryForTests();
    registerBuiltinSettings();
  });

  afterEach(() => {
    cleanup();
    resetSettingsRegistryForTests();
  });

  it("shows Settings above the avatar for Mail and opens the Mail pane", async () => {
    const bootstrap = createMailAppBootstrap();
    await renderHosted(
      <MailWorkspace
        messages={bootstrap.data.mail}
        mailboxes={bootstrap.data.mailboxes}
        session={bootstrap.session}
        listLoading={false}
        onLogout={() => undefined}
      />,
    );

    const settingsButton = footerSettingsButton();
    expect(settingsButton).toBeTruthy();
    settingsButton!.focus();
    fireEvent.click(settingsButton!);

    expect(await screen.findByRole("heading", { name: "Mail" })).toBeTruthy();
    expect(screen.getByText(/does not read a mailbox/i)).toBeTruthy();
  });

  it("hides the Settings row for Notes", async () => {
    const bootstrap = createNotesAppBootstrap();
    await renderHosted(
      <NotesWorkspace {...bootstrap} listLoading={false} onLogout={() => undefined} />,
      "/notes",
    );
    expect(footerSettingsButton()).toBeNull();
  });

  it("restores focus to the footer Settings control on dismiss", async () => {
    await renderHosted(<WorkspaceAppSettingsFooter appId="mail" session={mockWorkspaceSession} />);
    const settingsButton = footerSettingsButton();
    expect(settingsButton).toBeTruthy();
    settingsButton!.focus();
    fireEvent.click(settingsButton!);
    expect(await screen.findByRole("button", { name: "Close" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(footerSettingsButton()).toBe(document.activeElement);
    });
  });

  it("does not restore focus to an unmounted opener after Open in Settings", async () => {
    await renderHosted(<WorkspaceAppSettingsFooter appId="mail" session={mockWorkspaceSession} />);
    const settingsButton = footerSettingsButton();
    expect(settingsButton).toBeTruthy();
    settingsButton!.focus();
    fireEvent.click(settingsButton!);
    fireEvent.click(await screen.findByRole("button", { name: "Open in Settings" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Mail" })).toBeTruthy();
    });
    expect(footerSettingsButton()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Mail" }));
  });
});

describe("openPanel typing", () => {
  it("accepts BuiltinPanelId and rejects a typo at the type level", () => {
    type OpenPanelId = Parameters<SettingsDialogApi["openPanel"]>[0];
    const mail: OpenPanelId = "mail";
    expect(mail).toBe("mail");
    // @ts-expect-error "mial" is not a BuiltinPanelId
    const typo: OpenPanelId = "mial";
    void typo;
    const _assert: OpenPanelId extends BuiltinPanelId ? true : false = true;
    expect(_assert).toBe(true);
  });
});
