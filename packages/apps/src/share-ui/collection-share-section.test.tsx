import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { CollectionShareSection } from "@/share-ui/collection-share-section";
import { shareLabels } from "@/share-ui/share-labels";

const showSuccess = vi.fn();
vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ showSuccess, showError: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));

const COPY = {
  title: "Team access",
  hint: "Grant read or read-and-write access to people or teams.",
  placeholder: "Add people or teams…",
  empty: "No people or teams found",
  offline: "Sharing changes require a connection.",
  removeTitle: "Remove access?",
  removeConfirm: "This person or team will lose access. Continue?",
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
    expect(screen.getByPlaceholderText("Add people or teams…")).toBeTruthy();
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

  describe("confirmation toast", () => {
    const KNOWN = [
      { id: "alice", displayName: "Alice", principalType: "user" as const },
      { id: "bob", displayName: "Bob", principalType: "user" as const },
    ];
    const ALICE = { alice: { mayRead: true, mayWrite: false } };

    function renderWithAlice(extra: { recordPending?: boolean } = {}) {
      showSuccess.mockClear();
      const onPatchShareWith = vi.fn().mockResolvedValue(undefined);
      renderShare(
        <CollectionShareSection
          collectionId="list-1"
          shareWith={ALICE}
          copy={COPY}
          online
          knownPrincipals={KNOWN}
          onSearchPrincipals={vi.fn().mockResolvedValue([KNOWN[1]])}
          onPatchShareWith={onPatchShareWith}
          {...extra}
        />,
      );
      return onPatchShareWith;
    }

    it("confirms a grant", async () => {
      renderWithAlice();
      fireEvent.change(screen.getByPlaceholderText(COPY.placeholder), { target: { value: "bob" } });
      fireEvent.mouseDown(await screen.findByRole("option", { name: /Bob/ }));
      await waitFor(() =>
        expect(showSuccess).toHaveBeenCalledWith(shareLabels.accessGranted("Bob"), undefined),
      );
    });

    it("confirms an access change", async () => {
      renderWithAlice();
      fireEvent.click(screen.getByRole("combobox", { name: "Can view" }));
      fireEvent.click(screen.getByRole("option", { name: "Can edit" }));
      await waitFor(() =>
        expect(showSuccess).toHaveBeenCalledWith(shareLabels.accessChanged("Alice"), undefined),
      );
    });

    it("confirms a revoke", async () => {
      renderWithAlice();
      fireEvent.click(screen.getByRole("button", { name: shareLabels.removeGrant }));
      fireEvent.click(screen.getByRole("button", { name: shareLabels.confirmContinue }));
      await waitFor(() =>
        expect(showSuccess).toHaveBeenCalledWith(shareLabels.accessRemoved("Alice"), undefined),
      );
    });

    it("says other edits still need Save while the record is unsaved", async () => {
      renderWithAlice({ recordPending: true });
      fireEvent.click(screen.getByRole("button", { name: shareLabels.removeGrant }));
      fireEvent.click(screen.getByRole("button", { name: shareLabels.confirmContinue }));
      await waitFor(() =>
        expect(showSuccess).toHaveBeenCalledWith(shareLabels.accessRemoved("Alice"), {
          description: shareLabels.accessSavedRecordPending,
        }),
      );
    });

    it("shows no toast when the patch fails", async () => {
      showSuccess.mockClear();
      const onPatchShareWith = vi.fn().mockRejectedValue(new Error("nope"));
      renderShare(
        <CollectionShareSection
          collectionId="list-1"
          shareWith={ALICE}
          copy={COPY}
          online
          knownPrincipals={KNOWN}
          onSearchPrincipals={vi.fn().mockResolvedValue([])}
          onPatchShareWith={onPatchShareWith}
        />,
      );
      const swallow = (event: PromiseRejectionEvent) => event.preventDefault();
      window.addEventListener("unhandledrejection", swallow);
      fireEvent.click(screen.getByRole("button", { name: shareLabels.removeGrant }));
      fireEvent.click(screen.getByRole("button", { name: shareLabels.confirmContinue }));
      await waitFor(() => expect(onPatchShareWith).toHaveBeenCalled());
      expect(showSuccess).not.toHaveBeenCalled();
      window.removeEventListener("unhandledrejection", swallow);
    });
  });
});
