/**
 * The image data each editor `<img>` shows through its `blob:` URL. Export
 * reads the bytes from here: production's CSP (`connect-src 'self'`) refuses
 * a `fetch()` of a `blob:` URL, so re-reading it would fail, offline too.
 */
const shown = new WeakMap<HTMLImageElement, Blob>();

export function rememberShownImageBlob(img: HTMLImageElement, blob: Blob): void {
  shown.set(img, blob);
}

export function forgetShownImageBlob(img: HTMLImageElement): void {
  shown.delete(img);
}

export function shownImageBlobFor(img: HTMLImageElement): Blob | null {
  return shown.get(img) ?? null;
}
