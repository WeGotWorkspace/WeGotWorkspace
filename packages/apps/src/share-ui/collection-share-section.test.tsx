import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("CollectionShareSection", () => {
  it("renders injected copy and has no leftover calendar microcopy", () => {
    render(
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
    render(
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
});
