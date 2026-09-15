import Image from "@tiptap/extension-image";
import type { NodeViewRendererProps } from "@tiptap/core";
import { mergeAttributes } from "@tiptap/react";
import {
  fetchDocsImageContentByNodeId,
  type DocsImageContentFetcher,
} from "@/text-editor-core/src/text-editor-image-content";
import { createDocsImageNodeView } from "@/text-editor-core/src/text-editor-image-node-view";
import {
  createDocsImagePastePlugin,
  type DocsImageUploadHandler,
} from "@/text-editor-core/src/text-editor-image-paste";
import {
  docsImageMarkdown,
  serializeDocsImageSrc,
} from "@/text-editor-core/src/text-editor-image-src";

declare module "@tiptap/extension-image" {
  interface ImageOptions {
    fetchContent?: DocsImageContentFetcher;
  }
}

type MarkdownSerializeState = {
  write: (text: string) => void;
  closeBlock: (node: { type: unknown }) => void;
};

export type DocsImageStorage = {
  onUploadImageFiles: DocsImageUploadHandler | null;
  markdown: {
    serialize: (
      state: MarkdownSerializeState,
      node: { type: unknown; attrs: Record<string, unknown> },
    ) => void;
  };
};

export const DocsImage = Image.extend({
  addOptions() {
    const parent = this.parent?.();
    return {
      ...parent,
      HTMLAttributes: parent?.HTMLAttributes ?? {},
      allowBase64: false,
      inline: false,
      resize: parent?.resize ?? false,
      fetchContent: fetchDocsImageContentByNodeId,
    };
  },
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => serializeDocsImageSrc(element.getAttribute("src")),
        renderHTML: (attributes) => {
          const src = serializeDocsImageSrc(attributes.src as string | null);
          return src ? { src } : {};
        },
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const src = serializeDocsImageSrc(HTMLAttributes.src as string | null);
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, src ? { src } : { src: "" }),
    ];
  },
  addNodeView() {
    const fetchContent = this.options.fetchContent ?? fetchDocsImageContentByNodeId;
    return (props: NodeViewRendererProps) => createDocsImageNodeView(props.node, fetchContent);
  },
  addStorage() {
    return {
      onUploadImageFiles: null,
      markdown: {
        serialize(
          state: MarkdownSerializeState,
          node: { type: unknown; attrs: Record<string, unknown> },
        ) {
          const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
          const src = typeof node.attrs.src === "string" ? node.attrs.src : null;
          state.write(docsImageMarkdown(alt, src));
          state.closeBlock(node);
        },
      },
    } satisfies DocsImageStorage;
  },
  addProseMirrorPlugins() {
    const parent = this.parent?.() ?? [];
    return [createDocsImagePastePlugin(this.editor), ...parent];
  },
});
