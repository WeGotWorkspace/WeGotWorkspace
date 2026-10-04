import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminRealtimeHealthPane } from "@/admin-core/src/admin-realtime-health-pane";
import type { RealtimeHealthSnapshot } from "@/admin-core/src/admin-realtime-health-pane";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

const health: RealtimeHealthSnapshot = {
  day: {
    samples: 4,
    joinP50Ms: 200,
    joinP95Ms: 400,
    relayPercent: 25,
    failedPairsPercent: 25,
    fallbackPercent: 25,
    pollP95Ms: 40,
    constrainedPercent: 25,
    byChannel: { meet: 3, collab: 1 },
  },
  week: {
    samples: 5,
    joinP50Ms: 300,
    joinP95Ms: 9999,
    relayPercent: 20,
    failedPairsPercent: 20,
    fallbackPercent: 20,
    pollP95Ms: 40,
    constrainedPercent: 20,
    byChannel: { meet: 4, collab: 1 },
  },
  relayDays: [{ date: "2026-10-04", issued: 1, unavailable: 2, denied: 0 }],
  turnConfigured: false,
  unavailablePeopleThisWeek: 2,
  callout: "2 people couldn't connect directly this week. Set up TURN.",
  retentionDays: 30,
};

const meta = {
  title: "Features/Admin/Panes/Real-time health",
  component: AdminRealtimeHealthPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminRealtimeHealthPane>;

export default meta;
type Story = StoryObj<typeof AdminRealtimeHealthPane>;

export const Default: Story = {
  render: () => (
    <AdminStoryScope>
      <AdminRealtimeHealthPane health={health} onOpenTurnSettings={() => undefined} />
    </AdminStoryScope>
  ),
};
