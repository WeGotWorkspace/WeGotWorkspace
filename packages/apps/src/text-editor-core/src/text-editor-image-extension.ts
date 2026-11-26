import Image from "@tiptap/extension-image";
import type { NodeViewRendererProps } from "@tiptap/core";
import { mergeAttributes } from "@tiptap/react";
import {
  fetchDocsImageContentByNodeId,
  type DocsImageContentFetcher,
} from "@/text-editor-core/src/text-editor-image-content";
import {
  deleteSelectedDocsImage,
  deselectDocsImage,
} from "@/text-editor-core/src/text-editor-image-commands";
import {
  normalizeDocsImageAlign,
  normalizeDocsImageCaption,
  normalizeDocsImageHref,
  normalizeDocsImageWidth,
} from "@/text-editor-core/src/text-editor-image-attrs";
import { createDocsImageNodeView } from "@/text-editor-core/src/text-editor-image-node-view";
import {
  createDocsImagePastePlugin,
  type DocsImageUploadHandler,
} from "@/text-editor-core/src/text-editor-image-paste";
import {
  docsImageMarkdown,
  serializeDocsImageSrc,
  splitImageFragment,
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
        parseHTML: (element) =>
          serializeDocsImageSrc(splitImageFragment(element.getAttribute("src")).src),
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
      width: {
        default: null,
        // `data-*` from our own HTML (copy / paste); markdown carries it in the src fragment.
        parseHTML: (element) =>
          normalizeDocsImageWidth(element.getAttribute("data-width")) ??
          splitImageFragment(element.getAttribute("src")).width,
        renderHTML: (attributes) => {
          const width = normalizeDocsImageWidth(attributes.width);
          return width == null ? {} : { "data-width": String(width) };
        },
      },
      align: {
        default: null,
        parseHTML: (element) =>
          normalizeDocsImageAlign(element.getAttribute("data-align")) ??
          splitImageFragment(element.getAttribute("src")).align,
        renderHTML: (attributes) => {
          const align = normalizeDocsImageAlign(attributes.align);
          return align ? { "data-align": align } : {};
        },
      },
      // `[![alt](src)](url)`: the link around the picture, kept so a save does not drop it.
      href: {
        default: null,
        parseHTML: (element) =>
          normalizeDocsImageHref(
            element.getAttribute("data-href") ?? element.closest("a")?.getAttribute("href"),
          ),
        renderHTML: (attributes) => {
          const href = normalizeDocsImageHref(attributes.href);
          return href ? { "data-href": href } : {};
        },
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
    return (props: NodeViewRendererProps) => createDocsImageNodeView(props, fetchContent);
  },
  addKeyboardShortcuts() {
    return {
      Escape: () => deselectDocsImage(this.editor),
      Backspace: () => deleteSelectedDocsImage(this.editor),
      Delete: () => deleteSelectedDocsImage(this.editor),
    };
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
          state.write(
            docsImageMarkdown(alt, src, {
              width: normalizeDocsImageWidth(node.attrs.width),
              align: normalizeDocsImageAlign(node.attrs.align),
              title: normalizeDocsImageCaption(node.attrs.title),
              href: normalizeDocsImageHref(node.attrs.href),
            }),
          );
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
