import { inertOutsideLayer } from "@/ui/inert-outside-layer";
import { glideHeightOnResize } from "@/ui/size-glide";

/**
 * A centred Dialog / AlertDialog while it is open: everything outside it is inert,
 * and its height glides when its content grows or shrinks (a switch that shows more
 * rows). Returns the cleanup.
 */
export function attachCenteredModal(node: HTMLElement): () => void {
  const releaseInert = inertOutsideLayer(node);
  const stopGlide = glideHeightOnResize(node);
  return () => {
    stopGlide();
    releaseInert();
  };
}
