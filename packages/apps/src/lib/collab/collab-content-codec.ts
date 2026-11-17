import type * as Y from "yjs";
import type { TextEditorContentFormat } from "@/lib/files/text-content-format";

/**
 * Turns a collaborative document into text and back. Both directions need the
 * editor's schema, which lives in text-editor-core, so lib does not import
 * them (#2116). An entry point provides them once: `main.tsx`, the test setup
 * and Storybook all import `src/provide-collab-content-codec.ts`.
 */
export type CollabContentCodec = {
  /** Serialize a Y.Doc to Markdown or plain text. Reads a copy; never writes to `source`. */
  readContentFromYDoc(source: Y.Doc, format?: TextEditorContentFormat): string;
  /** Write `content` into `target` as the deterministic seed every client produces. */
  applyContentSeedToYDoc(
    target: Y.Doc,
    content: string,
    format?: TextEditorContentFormat,
    seedBase?: string,
  ): void;
};

type CollabContentCodecLoader = () => Promise<CollabContentCodec>;

let loader: CollabContentCodecLoader | null = null;
let loading: Promise<CollabContentCodec> | null = null;

/** Called by an entry point. A later call replaces the loader (tests use it). */
export function provideCollabContentCodec(load: CollabContentCodecLoader): void {
  loader = load;
  loading = null;
}

/**
 * The codec, loaded once. A failed load (a chunk that did not arrive) is not
 * cached, so the next call tries again.
 */
export function loadCollabContentCodec(): Promise<CollabContentCodec> {
  if (!loader) {
    return Promise.reject(
      new Error("No collab content codec: import src/provide-collab-content-codec.ts at startup."),
    );
  }
  if (!loading) {
    const attempt = loader().catch((error: unknown) => {
      if (loading === attempt) loading = null;
      throw error;
    });
    loading = attempt;
  }
  return loading;
}
