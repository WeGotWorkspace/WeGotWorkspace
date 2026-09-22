import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AdminStoryDataOverride } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminUpdatesPane } from "@/admin-core/src/admin-updates-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

function UpdatesPaneHarness({ dataOverride }: { dataOverride?: AdminStoryDataOverride }) {
  const controller = useAdminPaneStoryController(dataOverride);
  return (
    <AdminStoryScope>
      <AdminUpdatesPane
        controller={controller}
        setConfirmClearLogsOpen={() => {}}
        setConfirmUpdateOpen={() => {}}
        updatingNow={false}
      />
    </AdminStoryScope>
  );
}

const meta = {
  title: "Shared/Admin/Panes/Updates",
  component: AdminUpdatesPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminUpdatesPane>;

export default meta;
type Story = StoryObj<typeof AdminUpdatesPane>;

export const Default: Story = {
  render: () => <UpdatesPaneHarness />,
};

export const UpdateAvailable: Story = {
  render: () => (
    <UpdatesPaneHarness
      dataOverride={{
        updates: {
          updateAvailable: true,
          compatible: true,
          latest: {
            version: "9.9.9",
            package_url: "https://example.test/pkg.tgz",
            checksum_sha256: "a".repeat(64),
            checksum_signature: "sig",
          },
        },
        updateLogLines: ["[info] previous run completed", "[ok] schema migrated"],
      }}
    />
  ),
};

export const InProgress: Story = {
  render: () => (
    <UpdatesPaneHarness
      dataOverride={{
        updates: {
          inProgress: true,
          phase: "downloading",
          download: {
            downloadedBytes: 5_242_880,
            totalBytes: 10_485_760,
            percent: 50,
            updatedAt: "2024-06-01T10:00:00.000Z",
          },
          current: {
            from: "1.0.0",
            to: "1.1.0",
            at: "2024-06-01T10:00:00.000Z",
          },
        },
      }}
    />
  ),
};

export const DockerChannel: Story = {
  render: () => (
    <UpdatesPaneHarness
      dataOverride={{
        updates: {
          installChannel: "docker",
          installedVersion: "1.2.3",
          imageTag: "1.2.3",
          updateAvailable: true,
          latest: {
            version: "9.9.9",
            package_url: "https://example.test/pkg.tgz",
            checksum_sha256: "a".repeat(64),
            checksum_signature: "sig",
          },
        },
      }}
    />
  ),
};
