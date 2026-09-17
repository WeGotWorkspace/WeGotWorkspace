import { Extension } from "@tiptap/react";
import { Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { plainTextToFragment } from "@/text-editor-core/src/text-editor-plain-content";

/** Paste clipboard as plain text only (no HTML / rich formatting) in `.txt` mode. */
export const PlainTextPaste = Extension.create({
  name: "plainTextPaste",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("plainTextPaste"),
        props: {
          handlePaste(view, event) {
            const files = event.clipboardData?.files;
            if (
              files &&
              files.length > 0 &&
              [...files].every((file) => file.type.startsWith("image/"))
            ) {
              event.preventDefault();
              return true;
            }
            const plain = event.clipboardData?.getData("text/plain");
            if (plain == null) return false;
            const fragment = plainTextToFragment(plain, view.state.schema);
            if (!fragment) return false;
            event.preventDefault();
            const tr = view.state.tr.replaceSelection(new Slice(fragment, 0, 0));
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
