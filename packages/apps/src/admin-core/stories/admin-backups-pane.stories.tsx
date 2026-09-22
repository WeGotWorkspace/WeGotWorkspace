import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AdminUpdateBackupItem } from "@/admin-core/src/admin-types";
import type { AdminStoryDataOverride } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminBackupsPane } from "@/admin-core/src/admin-backups-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

const SAMPLE_BACKUPS: AdminUpdateBackupItem[] = [
  {
    name: "sabre-backup-2024-06-01.tar.gz",
    sizeBytes: 12_582_912,
    modifiedAt: "2024-06-01T08:30:00.000Z",
    fromVersion: "1.0.0",
    toVersion: "1.1.0",
    format: "tar.gz",
    downloadable: true,
  },
  {
    name: "pre-update-snapshot.zip",
    sizeBytes: 4_096_000,
    modifiedAt: "2024-05-15T12:00:00.000Z",
    fromVersion: null,
    toVersion: null,
    format: "zip",
    downloadable: true,
  },
];

function BackupsPaneHarness({ dataOverride }: { dataOverride?: AdminStoryDataOverride }) {
  const controller = useAdminPaneStoryController(dataOverride);
  return (
    <AdminStoryScope>
      <AdminBackupsPane controller={controller} />
    </AdminStoryScope>
  );
}

const meta = {
  title: "Shared/Admin/Panes/Backups",
  component: AdminBackupsPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminBackupsPane>;

export default meta;
type Story = StoryObj<typeof AdminBackupsPane>;

export const Empty: Story = {
  render: () => <BackupsPaneHarness />,
};

export const WithBackups: Story = {
  render: () => <BackupsPaneHarness dataOverride={{ updates: { backups: SAMPLE_BACKUPS } }} />,
};
