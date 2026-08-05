/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";
import { mockDriveShareAtPath } from "@/lib/api/mock/drive-share-fixtures";
import { SHARE_PASSWORD_MASK, ShareLinkSection } from "@/share-ui/share-link-section";
import { shareLabels } from "@/share-ui/share-labels";
import type { ShareMutations } from "@/share-ui/use-share-mutations";
import { TooltipProvider } from "@/ui/tooltip";

vi.mock("@/share-ui/generate-friendly-share-password", () => ({
  generateFriendlySharePassword: vi.fn(() => "river-maple-42"),
}));

function atPathWithPassword(hasPassword: boolean): DriveShareAtPath {
  return {
    ...mockDriveShareAtPath,
    publicShares: mockDriveShareAtPath.publicShares.map((entry) => ({
      ...entry,
      hasPassword,
    })),
    directShares: mockDriveShareAtPath.directShares.map((entry) =>
      entry.share.kind === "public" ? { ...entry, share: { ...entry.share, hasPassword } } : entry,
    ),
  };
}

function mutationsStub(overrides: Partial<ShareMutations> = {}): ShareMutations {
  return {
    busyKey: null,
    setPublicEnabled: vi.fn(async () => undefined),
    updatePublicAccess: vi.fn(async () => undefined),
    updatePublicPassword: vi.fn(async () => "river-maple-42"),
    regeneratePublicLink: vi.fn(async () => "river-maple-42"),
    updateGrantAccess: vi.fn(async () => undefined),
    removeGuestInvite: vi.fn(async () => undefined),
    inviteGuest: vi.fn(async () => undefined),
    addTeamGrant: vi.fn(async () => undefined),
    searchPrincipals: vi.fn(async () => []),
    copyPublicLink: vi.fn(async () => undefined),
    copySharePassword: vi.fn(async () => undefined),
    ...overrides,
  } as ShareMutations;
}

function renderLinkSection(atPath: DriveShareAtPath, mutations: ShareMutations = mutationsStub()) {
  return render(
    <TooltipProvider>
      <ShareLinkSection atPath={atPath} mutations={mutations} />
    </TooltipProvider>,
  );
}

function passwordInput(): HTMLInputElement {
  return (screen.queryByRole("textbox", { name: shareLabels.passwordHiddenLabel }) ??
    screen.getByRole("textbox", { name: shareLabels.requirePassword })) as HTMLInputElement;
}

describe("ShareLinkSection password show-once", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an inert mask when password is set but not freshly revealed", () => {
    renderLinkSection(atPathWithPassword(true));

    expect(passwordInput().value).toBe(SHARE_PASSWORD_MASK);
    expect(passwordInput().getAttribute("aria-label")).toBe(shareLabels.passwordHiddenLabel);
    expect(screen.queryByRole("button", { name: shareLabels.copyPassword })).toBeNull();
  });

  it("reveals plaintext after enabling protection and shows copy", async () => {
    const updatePublicPassword = vi.fn(async () => "river-maple-42");
    renderLinkSection(atPathWithPassword(false), mutationsStub({ updatePublicPassword }));

    const passwordToggle = screen.getByRole("group", { name: shareLabels.requirePassword });
    await act(async () => {
      fireEvent.click(passwordToggle.querySelector('button[aria-label="On"]')!);
    });

    expect(updatePublicPassword).toHaveBeenCalled();
    expect(passwordInput().value).toBe("river-maple-42");
    expect(screen.getByRole("button", { name: shareLabels.copyPassword })).toBeTruthy();
  });

  it("does not restore plaintext after remount — shows mask again", async () => {
    const updatePublicPassword = vi.fn(async () => "river-maple-42");
    const { unmount } = renderLinkSection(
      atPathWithPassword(false),
      mutationsStub({ updatePublicPassword }),
    );

    const passwordToggle = screen.getByRole("group", { name: shareLabels.requirePassword });
    await act(async () => {
      fireEvent.click(passwordToggle.querySelector('button[aria-label="On"]')!);
    });
    expect(passwordInput().value).toBe("river-maple-42");

    unmount();
    renderLinkSection(atPathWithPassword(true), mutationsStub({ updatePublicPassword }));

    expect(passwordInput().value).toBe(SHARE_PASSWORD_MASK);
    expect(passwordInput().value).not.toBe("river-maple-42");
    expect(screen.queryByRole("button", { name: shareLabels.copyPassword })).toBeNull();
  });

  it("reveals a new password after regenerate confirm", async () => {
    const updatePublicPassword = vi.fn(async () => "cloud-sage-918");
    renderLinkSection(atPathWithPassword(true), mutationsStub({ updatePublicPassword }));

    expect(passwordInput().value).toBe(SHARE_PASSWORD_MASK);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: shareLabels.regeneratePassword }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: shareLabels.confirmContinue }));
    });

    expect(updatePublicPassword).toHaveBeenCalledWith(true, "");
    expect(passwordInput().value).toBe("cloud-sage-918");
    expect(screen.getByRole("button", { name: shareLabels.copyPassword })).toBeTruthy();
  });
});
