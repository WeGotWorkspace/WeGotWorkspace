import type { Meta, StoryObj } from "@storybook/react-vite";
import { NoteTextEditorBody } from "../src/note-text-editor-body";

import "@/notes-core/src/notes-workspace.css";

const sampleMarkdown = `# Weekly sync

First paragraph with **bold** and _italic_ text.

- [ ] Action item one
- [x] Action item two

> Pull quote from the meeting notes.
`;

const meta: Meta<typeof NoteTextEditorBody> = {
  title: "Apps/Notes/Components/TextEditorBody",
  component: NoteTextEditorBody,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="notes-workspace notes-story-scope notes-story-scope--detail">
        <div className="notes-story-scope__detail-body px-6 py-10">
          <div className="mx-auto max-w-2xl">
            <Story />
          </div>
        </div>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NoteTextEditorBody>;

export const Default: Story = {
  args: {
    noteId: "demo-1",
    initialMarkdown: sampleMarkdown,
  },
};

export const ReadOnly: Story = {
  args: {
    noteId: "demo-readonly",
    initialMarkdown: sampleMarkdown,
    readOnly: true,
  },
};
