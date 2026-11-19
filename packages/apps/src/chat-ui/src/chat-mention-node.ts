import { mergeAttributes, Node } from "@tiptap/core";

export type ChatMentionNodeAttrs = { id: string; label: string };

/**
 * A picked @mention in the composer: one inline block that shows "@Name" and goes
 * with one Backspace (Slack, Linear, GitHub). It saves as the text "@Name", so the
 * body stays plain markdown and `parseChatMentions` still finds it.
 */
export const ChatMentionNode = Node.create({
  name: "chatMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      // Rendered once, as data-* below.
      id: { default: "", renderHTML: () => ({}) },
      label: { default: "", renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-chat-mention]",
        getAttrs: (element) => ({
          id: (element as HTMLElement).getAttribute("data-chat-mention") ?? "",
          label: (element as HTMLElement).getAttribute("data-label") ?? "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-chat-mention": node.attrs.id,
        "data-label": node.attrs.label,
        class: "chat-mention-chip",
        contenteditable: "false",
      }),
      `@${node.attrs.label}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.label}`;
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void }, node: { attrs: ChatMentionNodeAttrs }) {
          state.write(`@${node.attrs.label}`);
        },
        parse: {},
      },
    };
  },
});
