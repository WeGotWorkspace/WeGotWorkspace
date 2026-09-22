import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent } from "storybook/test";
import { fn } from "storybook/test";
import { ContactsConflictDialog } from "@/contacts-core/src/contacts-conflict-dialog";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import type { ContactConflictFieldRow } from "@/lib/offline/contacts-conflict-merge";
import { ContactsStoryScope } from "./contacts-story-scope";

const sampleFieldRows: ContactConflictFieldRow[] = [
  {
    key: "name",
    label: "Name",
    localValue: "Jane Local",
    serverValue: "Jane Server",
  },
  {
    key: "emails",
    label: "Emails",
    localValue: "jane@local.example (Work)",
    serverValue: "jane@server.example (Work)",
  },
];

const meta = {
  title: "Shared/Contacts/Conflict Dialog",
  component: ContactsConflictDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    contactName: "Jane Doe",
    labels: defaultContactsLabels,
    onKeepLocal: fn(),
    onUseServer: fn(),
    onConfirmMerge: fn(),
    onOpenChange: fn(),
  },
  render: (args) => (
    <ContactsStoryScope>
      <ContactsConflictDialog {...args} />
    </ContactsStoryScope>
  ),
} satisfies Meta<typeof ContactsConflictDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Binary: Story = {
  tags: ["vitest-ci"],
  play: async ({ args }) => {
    await expect(await screen.findByText("Sync conflict")).toBeInTheDocument();
    const keepMine = screen.getByRole("button", { name: "Keep mine" });
    const useServer = screen.getByRole("button", { name: "Use server version" });
    await expect(keepMine).toBeInTheDocument();
    await expect(useServer).toBeInTheDocument();
    await userEvent.click(keepMine);
    await expect(args.onKeepLocal).toHaveBeenCalledTimes(1);
    await userEvent.click(useServer);
    await expect(args.onUseServer).toHaveBeenCalledTimes(1);
  },
};

export const FieldMerge: Story = {
  tags: ["vitest-ci"],
  args: {
    fieldRows: sampleFieldRows,
  },
  play: async ({ args }) => {
    await expect(await screen.findByText("Sync conflict")).toBeInTheDocument();
    await expect(screen.getByText("Jane Local")).toBeInTheDocument();
    await expect(screen.getByText("Jane Server")).toBeInTheDocument();
    const applyMerge = screen.getByRole("button", { name: "Apply merged changes" });
    await userEvent.click(applyMerge);
    await expect(args.onConfirmMerge).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Use server version" }));
    await expect(args.onUseServer).toHaveBeenCalledTimes(1);
  },
};

export const WithQueue: Story = {
  args: {
    remainingCount: 2,
    fieldRows: sampleFieldRows,
  },
};
