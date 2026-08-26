import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  CalendarCalendarDialog,
  type CalendarCalendarDialogState,
} from "@/calendar-core/src/calendar-calendar-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  filterCalendarSharePrincipals,
  mergeCalendarShareWith,
  type CalendarShareWith,
} from "@/calendar-core/src/calendar-share";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { TooltipProvider } from "@/ui/tooltip";

const bootstrap = createCalendarAppBootstrap();
const knownPrincipals = [
  { id: "alice", displayName: "Alice", principalType: "user" as const },
  { id: "bob", displayName: "Bob", principalType: "user" as const },
  { id: "carol", displayName: "Carol", principalType: "user" as const },
];
const ownedCalendar: CalendarInfo = {
  ...(bootstrap.data.calendars.find((calendar) => calendar.id === "default") ??
    bootstrap.data.calendars[0]!),
  shareWith: {
    alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
  },
};

const editOwnedDialog = {
  mode: "edit" as const,
  calendarId: "default",
  name: "Personal",
  color: "#6366f1",
  mayDelete: true,
  scope: "personal" as const,
  canPublish: true,
};

function EditOwnedShareHarness({
  initialCalendar = ownedCalendar,
  dialog = editOwnedDialog,
  online = true,
}: {
  initialCalendar?: CalendarInfo;
  dialog?: Extract<CalendarCalendarDialogState, { mode: "edit" }>;
  online?: boolean;
}) {
  const [calendar, setCalendar] = useState(initialCalendar);

  return (
    <CalendarCalendarDialog
      dialog={dialog}
      labels={defaultCalendarLabels}
      groups={bootstrap.data.groups}
      personalOwnerLabel="Me"
      publish={{
        feed: null,
        onToggle: fn(),
        onCopyHttps: fn(),
      }}
      share={{
        calendar,
        knownPrincipals,
        online,
        onSearchPrincipals: async (query) =>
          filterCalendarSharePrincipals(query, knownPrincipals, {
            excludeIds: new Set(Object.keys(calendar.shareWith ?? {})),
          }),
        onPatchShareWith: async (_calendarId, shareWith: CalendarShareWith) => {
          setCalendar((current) => ({
            ...current,
            shareWith: mergeCalendarShareWith(current.shareWith, shareWith),
          }));
        },
      }}
      onClose={fn()}
      onConfirm={fn()}
      onDelete={fn()}
    />
  );
}

const meta: Meta<typeof CalendarCalendarDialog> = {
  title: "Apps/Calendar/CalendarDialog",
  component: CalendarCalendarDialog,
  decorators: [
    (Story) => (
      <TooltipProvider delayDuration={0}>
        <Story />
      </TooltipProvider>
    ),
  ],
  args: {
    labels: defaultCalendarLabels,
    groups: bootstrap.data.groups,
    personalOwnerLabel: "Me",
    onClose: fn(),
    onConfirm: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarCalendarDialog>;

export const Create: Story = {
  tags: ["vitest-ci"],
  args: {
    dialog: { mode: "create" },
  },
};

export const Subscribe: Story = {
  tags: ["vitest-ci"],
  args: {
    dialog: { mode: "subscribe" },
  },
};

export const EditOwned: Story = {
  tags: ["vitest-ci"],
  render: () => <EditOwnedShareHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(
      canvas.findByRole("heading", { name: defaultCalendarLabels.editCalendarTitle }),
    ).resolves.toBeTruthy();
    await expect(
      canvas.findByLabelText(defaultCalendarLabels.publishCalendarTitle),
    ).resolves.toBeTruthy();
    await expect(canvas.findByText("Alice")).resolves.toBeTruthy();
    await expect(
      canvas.findByText(defaultCalendarLabels.shareCalendarSectionTitle),
    ).resolves.toBeTruthy();
  },
};

export const EditOwnedSearchAdd: Story = {
  tags: ["vitest-ci"],
  render: () => <EditOwnedShareHarness />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const input = await body.findByPlaceholderText(
      defaultCalendarLabels.shareCalendarAddPlaceholder,
    );
    await userEvent.type(input, "bob");
    const option = await body.findByRole("option", { name: /Bob/ });
    await userEvent.click(option);
    await expect(body.findByText("Bob")).resolves.toBeTruthy();
  },
};

export const EditOwnedOffline: Story = {
  render: () => <EditOwnedShareHarness online={false} />,
};

export const EditChangeOwner: Story = {
  tags: ["vitest-ci"],
  args: {
    dialog: {
      mode: "edit",
      calendarId: "roadmap",
      name: "Roadmap",
      color: "#22c55e",
      mayDelete: true,
      scope: "personal",
      canChangeOwner: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const ownerSelect = await canvas.findByRole("combobox", {
      name: defaultCalendarLabels.calendarDirectoryLabel,
    });
    await expect(ownerSelect).not.toBeDisabled();
    await userEvent.click(ownerSelect);
    await userEvent.click(
      await canvas.findByRole("option", {
        name: defaultCalendarLabels.calendarDirectoryGroup("Editorial Team"),
      }),
    );
    await userEvent.click(canvas.getByRole("button", { name: defaultCalendarLabels.save }));
    await expect(
      canvas.findByRole("heading", {
        name: defaultCalendarLabels.changeCalendarOwnerConfirmTitle,
      }),
    ).resolves.toBeTruthy();
  },
};

export const EditTeam: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <EditOwnedShareHarness
      dialog={{
        mode: "edit",
        calendarId: "group-editorial",
        name: "Editorial",
        color: "#22c55e",
        mayDelete: false,
        scope: "group",
        canPublish: true,
      }}
      initialCalendar={{
        id: "group-editorial",
        name: "Editorial",
        color: "#22c55e",
        scope: "group",
        groupSlug: "editorial",
        mayShare: true,
        mayWrite: true,
        mayDelete: false,
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(
      canvas.findByRole("heading", { name: defaultCalendarLabels.editCalendarTitle }),
    ).resolves.toBeTruthy();
    await expect(
      canvas.findByLabelText(defaultCalendarLabels.publishCalendarTitle),
    ).resolves.toBeTruthy();
    await expect(
      canvas.findByText(defaultCalendarLabels.shareCalendarSectionTitle),
    ).resolves.toBeTruthy();
  },
};

export const EditSharee: Story = {
  tags: ["vitest-ci"],
  args: {
    dialog: {
      mode: "edit",
      calendarId: "family",
      name: "Family",
      color: "#f59e0b",
      mayDelete: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(
      canvas.findByRole("heading", { name: defaultCalendarLabels.editCalendarTitle }),
    ).resolves.toBeTruthy();
    await expect(canvas.queryByLabelText(defaultCalendarLabels.publishCalendarTitle)).toBeNull();
    await expect(canvas.queryByText(defaultCalendarLabels.shareCalendarSectionTitle)).toBeNull();
  },
};

export const EditPublished: Story = {
  args: {
    dialog: editOwnedDialog,
    publish: {
      feed: {
        httpsUrl: "https://example.test/api/v1/calendars/feeds/persontoken",
        webcalUrl: "webcal://example.test/api/v1/calendars/feeds/persontoken",
      },
      onToggle: fn(),
      onCopyHttps: fn(),
    },
    share: {
      calendar: ownedCalendar,
      knownPrincipals,
      online: true,
      onSearchPrincipals: fn(async () => []),
      onPatchShareWith: fn(async () => {}),
    },
    onDelete: fn(),
  },
};

export const EditSubscription: Story = {
  tags: ["vitest-ci"],
  args: {
    dialog: {
      mode: "edit",
      calendarId: "holidays",
      name: "US Holidays",
      color: "#8b5cf6",
      mayDelete: true,
      scope: "personal",
      subscriptionId: "sub-holidays",
      sourceUrl: "https://feeds.example.test/holidays.ics",
    },
    onDelete: fn(),
  },
};
