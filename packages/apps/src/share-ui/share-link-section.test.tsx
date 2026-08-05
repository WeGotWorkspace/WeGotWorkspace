/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";
import { mockDriveShareAtPath } from "@/lib/api/mock/drive-share-fixtures";
import { ShareLinkSection } from "@/share-ui/share-link-section";
import { shareLabels } from "@/share-ui/share-labels";
import {
  clearStoredSharePassword,
  readStoredSharePassword,
  writeStoredSharePassword,
} from "@/share-ui/share-password-storage";
import type { ShareMutations } from "@/share-ui/use-share-mutations";

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
    ...overrides,
  } as ShareMutations;
}

describe("ShareLinkSection password display", () => {
  const scope = mockDriveShareAtPath.path;

  beforeEach(() => {
    clearStoredSharePassword(scope);
  });

  afterEach(() => {
    cleanup();
    clearStoredSharePassword(scope);
  });

  it("shows stored plaintext when password protection is active", () => {
    writeStoredSharePassword(scope, "river-maple-42");
    render(<ShareLinkSection atPath={atPathWithPassword(true)} mutations={mutationsStub()} />);

    const input = screen.getByRole("textbox", { name: shareLabels.requirePassword });
    expect(input).toHaveValue("river-maple-42");
    expect(input).not.toHaveAttribute("placeholder", shareLabels.passwordSavedPlaceholder);
  });

  it("shows placeholder only when protected but plaintext is missing", () => {
    render(<ShareLinkSection atPath={atPathWithPassword(true)} mutations={mutationsStub()} />);

    const input = screen.getByRole("textbox", { name: shareLabels.requirePassword });
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", shareLabels.passwordSavedPlaceholder);
  });

  it("persists and displays password after enabling protection", async () => {
    const updatePublicPassword = vi.fn(async () => {
      writeStoredSharePassword(scope, "river-maple-42");
      return "river-maple-42";
    });

    const { rerender } = render(
      <ShareLinkSection
        atPath={atPathWithPassword(false)}
        mutations={mutationsStub({ updatePublicPassword })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: shareLabels.requirePassword }));
    });

    expect(updatePublicPassword).toHaveBeenCalled();
    expect(readStoredSharePassword(scope)).toBe("river-maple-42");

    rerender(
      <ShareLinkSection
        atPath={atPathWithPassword(true)}
        mutations={mutationsStub({ updatePublicPassword })}
      />,
    );

    expect(screen.getByRole("textbox", { name: shareLabels.requirePassword })).toHaveValue(
      "river-maple-42",
    );
  });

  it("restores plaintext after remount (dialog reopen)", () => {
    writeStoredSharePassword(scope, "cloud-sage-918");
    const { unmount } = render(
      <ShareLinkSection atPath={atPathWithPassword(true)} mutations={mutationsStub()} />,
    );
    expect(screen.getByRole("textbox", { name: shareLabels.requirePassword })).toHaveValue(
      "cloud-sage-918",
    );

    unmount();

    render(<ShareLinkSection atPath={atPathWithPassword(true)} mutations={mutationsStub()} />);
    expect(screen.getByRole("textbox", { name: shareLabels.requirePassword })).toHaveValue(
      "cloud-sage-918",
    );
  });

  it("does not clear stored plaintext when hasPassword briefly flickers false", async () => {
    writeStoredSharePassword(scope, "river-maple-42");
    const { rerender } = render(
      <ShareLinkSection atPath={atPathWithPassword(true)} mutations={mutationsStub()} />,
    );

    await act(async () => {
      rerender(<ShareLinkSection atPath={atPathWithPassword(false)} mutations={mutationsStub()} />);
    });
    expect(readStoredSharePassword(scope)).toBe("river-maple-42");

    await act(async () => {
      rerender(<ShareLinkSection atPath={atPathWithPassword(true)} mutations={mutationsStub()} />);
    });

    expect(screen.getByRole("textbox", { name: shareLabels.requirePassword })).toHaveValue(
      "river-maple-42",
    );
  });
});
