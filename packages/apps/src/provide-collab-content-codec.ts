/**
 * Gives lib's offline layer the editor's Y.Doc <-> text conversion (#2116).
 * lib may not import text-editor-core; this entry-point file wires it in.
 * The editor chunk loads on first use, not at startup.
 */
import { provideCollabContentCodec } from "@/lib/collab/collab-content-codec";

provideCollabContentCodec(
  () => import("@/text-editor-core/docs-collab/docs-collab-editor-surface"),
);
