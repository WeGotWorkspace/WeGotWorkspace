/**
 * Fit to screen (Docs pages): pages wider than the sheet shrink to fit it. The page column
 * is scaled with a transform, so it keeps its layout size and every page breaks exactly
 * where it does at full size. Screen measurements (`getBoundingClientRect`) inside it are
 * scaled too: page layout code divides them by `textEditorScreenScale`.
 */
export const TEXT_EDITOR_FIT_SCALE_VAR = "--text-editor-fit-scale";

/** How much the page column is scaled on screen: 1 when it is not. */
export function textEditorScreenScale(dom: HTMLElement): number {
  const scale = Number.parseFloat(dom.style.getPropertyValue(TEXT_EDITOR_FIT_SCALE_VAR));
  return scale > 0 ? scale : 1;
}

/** Scale that fits `pageWidth` into `available`: shrink only, rounded so resizes settle. */
export function textEditorFitScale(available: number, pageWidth: number): number {
  if (!(available > 0) || !(pageWidth > 0) || available >= pageWidth) return 1;
  return Math.floor((available / pageWidth) * 1000) / 1000;
}
