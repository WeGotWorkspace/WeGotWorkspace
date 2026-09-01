import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect, userEvent, within } from "storybook/test";
import { CollectionListWorkspace } from "@/collection-layout/src/collection-layout";
import { ContactsListPanel } from "@/contacts-core/src/contacts-list-panel";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { useSyncRetryToast } from "@/hooks/use-sync-retry-toast";
import { contactsGroupViewKey } from "@/contacts-core/src/contacts-group-utils";
import { useContactsPaneStoryController } from "./contacts-pane-stories.harness";
import { ContactsStoryScope } from "./contacts-story-scope";

const storyChrome = {
  sidebarOpen: true,
  toggleSidebar: () => {},
} as const;

export type ContactsListPanePreset = "default" | "empty" | "loading" | "inGroup";

function storyCard(overrides: Record<string, unknown>): ContactCard {
  return {
    "@type": "Card",
    version: "1.0",
    addressBookIds: { default: true as const },
    ...overrides,
  } as unknown as ContactCard;
}

const primaryChannelCards: ContactCard[] = [
  storyCard({
    id: "card-company-and-email",
    uid: "urn:uuid:company-and-email",
    name: { "@type": "Name" as const, isOrdered: false, full: "Cora Company" },
    organizations: {
      "org-1": { "@type": "Organization" as const, name: "Acme Corp" },
    },
    emails: {
      "email-1": { "@type": "EmailAddress" as const, address: "cora@example.com" },
    },
    phones: {
      "phone-1": { "@type": "Phone" as const, number: "+1-555-0144" },
    },
  }),
  storyCard({
    id: "card-preferred-email",
    uid: "urn:uuid:preferred-email",
    name: { "@type": "Name" as const, isOrdered: false, full: "Ada Email" },
    emails: {
      "email-work": { "@type": "EmailAddress" as const, address: "ada.work@example.com", pref: 2 },
      "email-home": { "@type": "EmailAddress" as const, address: "ada.home@example.com", pref: 1 },
    },
    phones: {
      "phone-1": { "@type": "Phone" as const, number: "+1-555-0101" },
    },
  }),
  storyCard({
    id: "card-phone-only",
    uid: "urn:uuid:phone-only",
    name: { "@type": "Name" as const, isOrdered: false, full: "Pat Phone" },
    phones: {
      "phone-work": { "@type": "Phone" as const, number: "+1-555-0100", pref: 2 },
      "phone-mobile": { "@type": "Phone" as const, number: "+1-555-0199", pref: 1 },
    },
  }),
  storyCard({
    id: "card-neither",
    uid: "urn:uuid:neither",
    name: { "@type": "Name" as const, isOrdered: false, full: "No Channel" },
  }),
  storyCard({
    id: "card-group-channel",
    uid: "urn:uuid:group-channel",
    kind: "group" as const,
    name: { "@type": "Name" as const, isOrdered: false, full: "Friends Group" },
    members: {},
  }),
];

function ContactsListPaneHarness({
  preset = "default",
  pendingCardIds,
  failedSyncCount,
  visibleCards,
}: {
  preset?: ContactsListPanePreset;
  pendingCardIds?: string[];
  failedSyncCount?: number;
  visibleCards?: ContactCard[];
}) {
  const controller = useContactsPaneStoryController(
    preset === "empty"
      ? { cardsOverride: [] }
      : preset === "loading"
        ? { listLoading: true, cardsOverride: [] }
        : visibleCards
          ? { cardsOverride: visibleCards }
          : undefined,
  );

  useSyncRetryToast({
    active: (failedSyncCount ?? 0) > 0,
    title: controller.L.syncFailedTitle,
    message: controller.L.syncFailedMessage,
    retryLabel: controller.L.retrySync,
    onRetry: () => {},
  });

  useEffect(() => {
    if (preset === "inGroup") {
      controller.selectView(contactsGroupViewKey("card-group-friends"));
    }
    // Storybook: apply group filter when preset changes, not on every controller churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [preset]);

  const listProps = ContactsListPanel({
    L: controller.L,
    sidebarOpen: storyChrome.sidebarOpen,
    onToggleSidebar: storyChrome.toggleSidebar,
    viewLabel: controller.viewLabel,
    view: controller.view,
    selectedGroupId: controller.selectedGroup?.id ?? null,
    selectedIds: controller.selectedIds,
    selectionMode: controller.selectionMode || controller.selectedIds.length > 1,
    listLoading: controller.listLoading,
    listRefreshing: controller.listRefreshing,
    visibleCards: visibleCards ?? controller.visibleCards,
    searchQuery: controller.searchQuery,
    setSearchQuery: controller.setSearchQuery,
    searchInputRef: controller.searchInputRef,
    isTouch: controller.isTouch,
    activeId: controller.activeId,
    isItemDragging: controller.isItemDragging,
    handleSelect: controller.handleSelect,
    enterSelectionFor: controller.enterSelectionFor,
    itemDragHandlers: controller.itemDragHandlers,
    onSwipeDelete: (id) => controller.openDeleteConfirm([id]),
    onSwipeRemoveFromGroup: (id) => controller.removeFromGroup([id]),
    selectionBar: controller.selectionBar,
    onRefreshList: () => {},
    pendingCardIds: pendingCardIds ? new Set(pendingCardIds) : undefined,
  });

  return (
    <ContactsStoryScope variant="list-column">
      <CollectionListWorkspace {...listProps} />
      {controller.confirmDialog}
    </ContactsStoryScope>
  );
}

const meta = {
  title: "Apps/Contacts/Panes/List",
  component: ContactsListPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    preset: {
      control: "select",
      options: ["default", "empty", "loading", "inGroup"],
    },
  },
} satisfies Meta<typeof ContactsListPaneHarness>;

export default meta;
type Story = StoryObj<typeof ContactsListPaneHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  args: { preset: "default" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 3, name: "Jane Doe" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { level: 3, name: "Acme Corp" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Refresh contacts" })).toBeInTheDocument();

    const janeRow = canvasElement.querySelector('[data-list-item-id="card-jane"]');
    const joeRow = canvasElement.querySelector('[data-list-item-id="card-joe"]');
    const acmeRow = canvasElement.querySelector('[data-list-item-id="card-acme"]');
    await expect(janeRow).toBeTruthy();
    await expect(within(janeRow as HTMLElement).getByText("Acme Corp")).toBeInTheDocument();
    await expect(within(janeRow as HTMLElement).queryByText("jane@example.com")).toBeNull();
    await expect(
      (janeRow as HTMLElement).querySelector(".list-item__subtitle--below"),
    ).toBeTruthy();
    await expect((janeRow as HTMLElement).querySelector(".list-item__body")).toBeNull();

    await expect(joeRow).toBeTruthy();
    await expect(within(joeRow as HTMLElement).getByText("joe@example.com")).toBeInTheDocument();
    await expect((joeRow as HTMLElement).querySelector(".list-item__body")).toBeTruthy();
    await expect((joeRow as HTMLElement).querySelector(".list-item__subtitle--below")).toBeNull();

    await expect(acmeRow).toBeTruthy();
    await expect(within(acmeRow as HTMLElement).queryByText("info@acme.com")).toBeNull();
    await expect(canvas.queryByText("+1-555-0101")).not.toBeInTheDocument();
    const input = canvas.getByPlaceholderText("Search contacts...");
    await userEvent.type(input, "joe@");
    await expect(input).toHaveValue("joe@");
  },
};

export const PendingSync: Story = {
  tags: ["vitest-ci"],
  args: { preset: "default", pendingCardIds: ["card-jane"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("img", { name: "Pending sync" })).toBeInTheDocument();
  },
};

export const RetrySync: Story = {
  tags: ["vitest-ci"],
  args: { preset: "default", failedSyncCount: 2 },
  play: async () => {
    const body = within(document.body);
    await expect(body.getByText("Some changes couldn’t sync")).toBeInTheDocument();
    await expect(body.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { preset: "empty" },
};

export const Loading: Story = {
  args: { preset: "loading" },
};

export const PrimaryChannel: Story = {
  tags: ["vitest-ci"],
  args: { visibleCards: primaryChannelCards },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const companyRow = canvasElement.querySelector('[data-list-item-id="card-company-and-email"]');
    const emailRow = canvasElement.querySelector('[data-list-item-id="card-preferred-email"]');
    const phoneRow = canvasElement.querySelector('[data-list-item-id="card-phone-only"]');
    const neitherRow = canvasElement.querySelector('[data-list-item-id="card-neither"]');
    const groupRow = canvasElement.querySelector('[data-list-item-id="card-group-channel"]');

    await expect(companyRow).toBeTruthy();
    await expect(within(companyRow as HTMLElement).getByText("Acme Corp")).toBeInTheDocument();
    await expect(within(companyRow as HTMLElement).queryByText("cora@example.com")).toBeNull();
    await expect(within(companyRow as HTMLElement).queryByText("+1-555-0144")).toBeNull();
    await expect(companyRow?.querySelector(".list-item__subtitle--below")).toBeTruthy();
    await expect(companyRow?.querySelector(".list-item__body")).toBeNull();

    await expect(emailRow).toBeTruthy();
    await expect(
      within(emailRow as HTMLElement).getByText("ada.home@example.com"),
    ).toBeInTheDocument();
    await expect(within(emailRow as HTMLElement).queryByText("ada.work@example.com")).toBeNull();
    await expect(within(emailRow as HTMLElement).queryByText("+1-555-0101")).toBeNull();
    await expect(emailRow?.querySelector(".list-item__body")).toBeTruthy();
    await expect(emailRow?.querySelector(".list-item__subtitle--below")).toBeNull();

    await expect(phoneRow).toBeTruthy();
    await expect(within(phoneRow as HTMLElement).getByText("+1-555-0199")).toBeInTheDocument();
    await expect(within(phoneRow as HTMLElement).queryByText("+1-555-0100")).toBeNull();
    await expect(phoneRow?.querySelector(".list-item__body")).toBeTruthy();
    await expect(phoneRow?.querySelector(".list-item__subtitle--below")).toBeNull();

    await expect(neitherRow).toBeTruthy();
    await expect(neitherRow?.querySelector(".list-item__body")).toBeNull();
    await expect(neitherRow?.querySelector(".list-item__subtitle--below")).toBeNull();

    await expect(groupRow).toBeTruthy();
    await expect(groupRow?.querySelector(".list-item__body")).toBeNull();
    await expect(groupRow?.querySelector(".list-item__subtitle--below")).toBeNull();
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Friends Group" }),
    ).toBeInTheDocument();
  },
};

export const ActiveGroup: Story = {
  tags: ["vitest-ci"],
  args: { preset: "inGroup" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Friends")).toBeInTheDocument();
    await expect(canvas.getByText("2 Contacts")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Rename group" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Delete group" })).toBeNull();
    await expect(canvas.getByRole("heading", { level: 3, name: "Jane Doe" })).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Joe Example" }),
    ).toBeInTheDocument();
  },
};
