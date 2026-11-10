import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  mergeShareWith,
  type CollectionSharePrincipal,
  type CollectionShareWith,
} from "@/share-ui/collection-share";
import { CollectionShareSection } from "@/share-ui/collection-share-section";
import { noPeopleOrTeamsFoundCopy, noTeamYetCopy } from "@/share-ui/share-labels";

const COPY = {
  title: "Team access",
  hint: "Grant read or read-and-write access to people or teams.",
  placeholder: "Add people or teams…",
  empty: noPeopleOrTeamsFoundCopy,
  offline: "Sharing changes require a connection.",
  removeTitle: "Remove access?",
  removeConfirm: "This person or team will lose access. Continue?",
};

const PRINCIPALS: CollectionSharePrincipal[] = [
  { id: "alice", displayName: "Alice", principalType: "user" },
  { id: "bob", displayName: "Bob", principalType: "user" },
];

function CollectionShareHarness({
  online = true,
  noTeam = false,
  onPatchShareWith = fn(),
}: {
  online?: boolean;
  noTeam?: boolean;
  onPatchShareWith?: (id: string, shareWith: CollectionShareWith) => Promise<void>;
}) {
  const [shareWith, setShareWith] = useState<CollectionShareWith | null>({
    alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
  });
  return (
    <div className="max-w-md p-6">
      <CollectionShareSection
        collectionId="default"
        shareWith={shareWith}
        copy={COPY}
        knownPrincipals={PRINCIPALS}
        online={online}
        noTeam={noTeam}
        onSearchPrincipals={async (query) =>
          (noTeam ? [] : PRINCIPALS).filter((row) =>
            row.displayName.toLowerCase().includes(query.toLowerCase()),
          )
        }
        onPatchShareWith={async (id, patch) => {
          setShareWith((current) => mergeShareWith(current, patch));
          await onPatchShareWith(id, patch);
        }}
      />
    </div>
  );
}

const meta: Meta<typeof CollectionShareSection> = {
  title: "Features/Share/CollectionShareSection",
  component: CollectionShareSection,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof CollectionShareSection>;

export const Default: Story = {
  tags: ["vitest-ci"],
  render: () => <CollectionShareHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByText("Team access")).resolves.toBeTruthy();
    await expect(canvas.findByText("Alice")).resolves.toBeTruthy();
  },
};

export const SearchAdd: Story = {
  render: () => <CollectionShareHarness />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const input = await body.findByPlaceholderText(COPY.placeholder);
    await userEvent.type(input, "bob");
    const option = await body.findByRole("option", { name: /Bob/ });
    await userEvent.click(option);
    await expect(body.findByText("Bob")).resolves.toBeTruthy();
  },
};

export const Offline: Story = {
  render: () => <CollectionShareHarness online={false} />,
};

/** A search that matches nobody: no hint that more people exist (#1924). */
export const NoMatch: Story = {
  render: () => <CollectionShareHarness />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const input = await body.findByPlaceholderText(COPY.placeholder);
    await userEvent.type(input, "zz");
    await expect(body.findByText(COPY.empty)).resolves.toBeTruthy();
  },
};

/** The viewer is in no Team: the card says so, and so does a search (#1924). */
export const NoTeam: Story = {
  render: () => <CollectionShareHarness noTeam />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByText(noTeamYetCopy)).resolves.toBeTruthy();
    const input = await body.findByPlaceholderText(COPY.placeholder);
    await userEvent.type(input, "al");
    await expect(body.findAllByText(noTeamYetCopy)).resolves.toHaveLength(2);
  },
};
