import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { DocsSuggestionsFloatingLayer } from "@/text-editor-core/docs-collab/docs-suggestions";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";

import { replaceSuggestion } from "./docs-suggestion-card.stories.fixtures";

import "@/text-editor-core/src/text-editor.css";
import "@/text-editor-core/docs-collab/docs-suggestions/docs-suggestions-floating-layer.css";

const noop = () => {};

function FloatingLayerHarness() {
  const editor = useEditor({
    extensions: [StarterKit.configure({ undoRedo: false })],
    content:
      '<p>Review the <span data-change-id="change-replace-1">final</span> launch checklist.</p>',
    editorProps: {
      attributes: { class: "text-editor-prose focus:outline-none" },
    },
    immediatelyRender: false,
  });

  return (
    <div className="docs-workspace flex min-h-[480px] flex-col border p-6">
      <TextEditorSheet
        editor={editor}
        variant="sheet"
        fill
        overlay={
          <DocsSuggestionsFloatingLayer
            editor={editor}
            visible
            labels={docsLabels}
            suggestions={[replaceSuggestion]}
            currentUserId="u-alex"
            activeChangeId="change-replace-1"
            onSelectSuggestion={noop}
            onAcceptSuggestion={noop}
            onRejectSuggestion={noop}
            onAddReply={noop}
            onToggleReaction={noop}
          />
        }
      />
    </div>
  );
}

const meta = {
  title: "Features/Docs/TextEditor/Docs suggestions/Floating layer",
  component: DocsSuggestionsFloatingLayer,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Margin-mounted suggestion cards anchored to track-change marks in the editor surface.",
      },
    },
  },
} satisfies Meta<typeof DocsSuggestionsFloatingLayer>;

export default meta;

type Story = StoryObj<typeof DocsSuggestionsFloatingLayer>;

export const Default: Story = {
  render: () => <FloatingLayerHarness />,
};
