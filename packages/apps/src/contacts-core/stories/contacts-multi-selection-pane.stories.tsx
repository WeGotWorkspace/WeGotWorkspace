import type { Meta, StoryObj } from "@storybook/react-vite";
import { Trash2 } from "lucide-react";
import { MultiSelectionView } from "@/multi-selection-view/src/multi-selection-view";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { ContactsStoryScope } from "./contacts-story-scope";

const L = defaultContactsLabels;

function ContactsMultiSelectionPaneHarness({ count = 2 }: { count?: number }) {
  return (
    <ContactsStoryScope variant="detail">
      <MultiSelectionView
        count={count}
        label="Multiple selection"
        title={(n) => `${n} ${n === 1 ? "contact" : "contacts"} selected`}
        actions={[
          {
            id: "delete",
            label: L.selectionDelete,
            icon: <Trash2 className="size-4" />,
            onClick: () => {},
          },
        ]}
      />
    </ContactsStoryScope>
  );
}

const meta = {
  title: "Features/Contacts/Panes/Multi selection",
  component: ContactsMultiSelectionPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ContactsMultiSelectionPaneHarness>;

export default meta;
type Story = StoryObj<typeof ContactsMultiSelectionPaneHarness>;

export const Default: Story = {
  args: { count: 2 },
};

export const Single: Story = {
  args: { count: 1 },
};
