import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { workspaceLabels } from "@/lib/workspace/workspace-labels";
import { NoticeBar } from "@/notice-bar/src/notice-bar";
import { useSyncRetryNotice } from "@/notice-bar/src/use-sync-retry-notice";

/** Retry "flushes" for a moment, then the stuck changes are gone. */
function Frame({ retryMs = 600 }: { retryMs?: number }) {
  const [stuck, setStuck] = useState(true);
  const notice = useSyncRetryNotice({
    id: "sync:story",
    active: stuck,
    title: workspaceLabels.sync.failedNotice,
    retryLabel: workspaceLabels.dialog.retry,
    onRetry: () =>
      new Promise<void>((resolve) =>
        window.setTimeout(() => {
          setStuck(false);
          resolve();
        }, retryMs),
      ),
  });
  return (
    <div>
      <NoticeBar label={workspaceLabels.noticeBarLabel} notices={[notice]} />
      <p className="p-4 text-sm">{stuck ? "Changes waiting on this device." : "All synced."}</p>
    </div>
  );
}

const meta = {
  title: "UI/Notice bar sync retry",
  component: Frame,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "`useSyncRetryNotice` (#1895): the stuck-sync row Notes, Contacts, Docs, Drive and Calendar put in their notice bar. Retry stays disabled while it runs; the row goes away once nothing is stuck.",
      },
    },
  },
} satisfies Meta<typeof Frame>;

export default meta;
type Story = StoryObj<typeof Frame>;

export const UseSyncRetryNotice: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = await canvas.findByRole("region", { name: workspaceLabels.noticeBarLabel });
    await expect(bar).toHaveTextContent(workspaceLabels.sync.failedNotice);
    const retry = within(bar).getByRole("button", { name: workspaceLabels.dialog.retry });
    await userEvent.click(retry);
    await expect(retry).toBeDisabled();
    await waitFor(() =>
      expect(canvas.queryByRole("region", { name: workspaceLabels.noticeBarLabel })).toBeNull(),
    );
    await expect(canvas.getByText("All synced.")).toBeInTheDocument();
  },
};

export const Phone: Story = {
  globals: { viewport: { value: "phone375", isRotated: false } },
};
