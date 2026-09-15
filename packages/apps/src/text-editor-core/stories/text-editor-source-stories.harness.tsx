import { useState, type ComponentProps } from "react";
import { Button } from "@/ui/button";
import { TextEditor } from "@/text-editor-core/src/text-editor";

/** Storybook-only harness: external source toggle (not part of TextEditor). */
export function TextEditorWithSourceToggle(args: ComponentProps<typeof TextEditor>) {
  const [viewSource, setViewSource] = useState(args.viewSource ?? false);

  return (
    <div className="flex h-dvh flex-col">
      <div className="no-print flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button
          type="button"
          variant={viewSource ? "secondary" : "outline"}
          size="md"
          onClick={() => setViewSource((on) => !on)}
        >
          {viewSource ? "Hide source" : "Edit source"}
        </Button>
      </div>
      <TextEditor {...args} viewSource={viewSource} className="min-h-0 flex-1" />
    </div>
  );
}
