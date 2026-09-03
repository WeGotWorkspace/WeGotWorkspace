import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { CollectionShareSection } from "@/share-ui/collection-share-section";

const COPY = {
  title: "Team access",
  hint: "Grant read or read-and-write access to people or groups.",
  placeholder: "Add people or groups…",
  empty: "No people or groups found",
  offline: "Sharing changes require a connection.",
  removeTitle: "Remove access?",
  removeConfirm: "This person or group will lose access. Continue?",
};

function renderShare(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("CollectionShareSection", () => {
  it("renders injected copy and has no leftover calendar microcopy", () => {
    renderShare(
      <CollectionShareSection
        collectionId="list-1"
        copy={COPY}
        online
        onSearchPrincipals={vi.fn().mockResolvedValue([])}
        onPatchShareWith={vi.fn()}
      />,
    );
    expect(screen.getByText("Team access")).toBeTruthy();
    expect(screen.getByPlaceholderText("Add people or groups…")).toBeTruthy();
    expect(screen.queryByText(/calendar/i)).toBeNull();
  });

  it("shows injected offline copy and disables the add field", () => {
    renderShare(
      <CollectionShareSection
        collectionId="list-1"
        copy={COPY}
        online={false}
        onSearchPrincipals={vi.fn().mockResolvedValue([])}
        onPatchShareWith={vi.fn()}
      />,
    );
    expect(screen.getByText(COPY.offline)).toBeTruthy();
    expect(screen.getByPlaceholderText(COPY.placeholder).hasAttribute("disabled")).toBe(true);
  });

  it("omits the view/edit access select when accessSelect is false", () => {
    renderShare(
      <CollectionShareSection
        collectionId="channel-1"
        shareWith={{ "ada.lovelace": { mayRead: true, mayWrite: true } }}
        copy={COPY}
        online
        accessSelect={false}
        knownPrincipals={[
          { id: "ada.lovelace", displayName: "Ada Lovelace", principalType: "user" },
        ]}
        onSearchPrincipals={vi.fn().mockResolvedValue([])}
        onPatchShareWith={vi.fn()}
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Can view|Can edit|View|Edit/i)).toBeNull();
  });
});
