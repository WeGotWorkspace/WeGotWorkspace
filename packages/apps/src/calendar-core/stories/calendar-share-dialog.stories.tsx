import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { CalendarShareDialog } from "@/calendar-core/src/calendar-share-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarInfoFromJmap,
  calendarSharePrincipalsFromDirectory,
  filterCalendarSharePrincipals,
  mergeCalendarShareWith,
  type CalendarShareWith,
} from "@/calendar-core/src/calendar-share";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { JmapClient, MockJmapServer, type JmapCalendar } from "@/lib/jmap-client";
import { patchCalendarLive } from "@/lib/api/wgw/calendar";
import { TooltipProvider } from "@/ui/tooltip";

const bootstrap = createCalendarAppBootstrap();
const knownPrincipals = calendarSharePrincipalsFromDirectory({
  invitees: [
    { username: "alice", email: "alice@example.test", name: "Alice" },
    { username: "bob", email: "bob@example.test", name: "Bob" },
    { username: "carol", email: "carol@example.test", name: "Carol" },
  ],
  groups: bootstrap.data.groups,
});

const ownedCalendar: CalendarInfo = {
  ...(bootstrap.data.calendars.find((calendar) => calendar.id === "default") ??
    bootstrap.data.calendars[0]!),
  shareWith: {
    alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
  },
};

function CalendarShareDialogHarness({
  initialCalendar = ownedCalendar,
  online = true,
}: {
  initialCalendar?: CalendarInfo;
  online?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [calendar, setCalendar] = useState(initialCalendar);

  return (
    <div className="calendar-workspace max-w-xl p-6">
      <CalendarShareDialog
        open={open}
        calendar={calendar}
        labels={defaultCalendarLabels}
        knownPrincipals={knownPrincipals}
        online={online}
        onOpenChange={setOpen}
        onSearchPrincipals={async (query) =>
          filterCalendarSharePrincipals(query, knownPrincipals, {
            excludeIds: new Set(Object.keys(calendar.shareWith ?? {})),
          })
        }
        onPatchShareWith={async (_calendarId, shareWith) => {
          setCalendar((current) => ({
            ...current,
            shareWith: mergeCalendarShareWith(current.shareWith, shareWith),
          }));
        }}
      />
    </div>
  );
}

function MockJmapShareHarness() {
  const server = useMemo(() => {
    const next = new MockJmapServer();
    next.seedCalendar({
      id: ownedCalendar.id,
      name: ownedCalendar.name,
      color: ownedCalendar.color,
      isDefault: true,
      myRights: {
        mayReadFreeBusy: true,
        mayReadItems: true,
        mayWriteAll: true,
        mayWriteOwn: true,
        mayUpdatePrivate: true,
        mayRSVP: true,
        mayShare: true,
        mayDelete: true,
      },
      shareWith: ownedCalendar.shareWith as JmapCalendar["shareWith"],
    });
    return next;
  }, []);
  const client = useMemo(
    () => new JmapClient({ sessionUrl: server.sessionUrl, fetch: server.fetch }),
    [server],
  );
  const [open, setOpen] = useState(true);
  const [calendar, setCalendar] = useState(ownedCalendar);

  return (
    <div className="calendar-workspace max-w-xl p-6">
      <CalendarShareDialog
        open={open}
        calendar={calendar}
        labels={defaultCalendarLabels}
        knownPrincipals={knownPrincipals}
        onOpenChange={setOpen}
        onSearchPrincipals={async (query) => filterCalendarSharePrincipals(query, knownPrincipals)}
        onPatchShareWith={async (calendarId, shareWith: CalendarShareWith) => {
          const updated = await patchCalendarLive(calendarId, { shareWith }, client);
          setCalendar(calendarInfoFromJmap(server.calendars.get(calendarId) as JmapCalendar));
          void updated;
        }}
      />
    </div>
  );
}

const meta = {
  title: "Apps/Calendar/ShareDialog",
  component: CalendarShareDialog,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <TooltipProvider delayDuration={0}>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof CalendarShareDialog>;

export default meta;
type Story = StoryObj<typeof CalendarShareDialog>;

export const Default: Story = {
  tags: ["vitest-ci"],
  render: () => <CalendarShareDialogHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(canvas.findByText("Alice")).resolves.toBeTruthy();
    await expect(
      canvas.findByText(defaultCalendarLabels.shareCalendarSectionTitle),
    ).resolves.toBeTruthy();
  },
};

export const Empty: Story = {
  render: () => (
    <CalendarShareDialogHarness initialCalendar={{ ...ownedCalendar, shareWith: null }} />
  ),
};

export const Offline: Story = {
  render: () => <CalendarShareDialogHarness online={false} />,
};

export const MockJmap: Story = {
  render: () => <MockJmapShareHarness />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const input = await body.findByPlaceholderText(
      defaultCalendarLabels.shareCalendarAddPlaceholder,
    );
    await userEvent.type(input, "carol");
    await expect(body.findByRole("option", { name: /Carol/ })).resolves.toBeTruthy();
  },
};

export const SearchAdd: Story = {
  tags: ["vitest-ci"],
  render: () => <CalendarShareDialogHarness />,
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
