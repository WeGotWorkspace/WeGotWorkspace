/**
 * Publish an element's height as a CSS custom property on a host, and keep it
 * current. Chrome that floats over a scroller (frosted bars) uses it so the
 * scroller can reserve that space. Returns a cleanup for `useEffect`.
 */
export function publishElementHeight(
  host: HTMLElement | null | undefined,
  element: HTMLElement | null | undefined,
  property: `--${string}`,
): (() => void) | undefined {
  if (!host || !element) return;
  const publish = () => host.style.setProperty(property, `${element.offsetHeight}px`);
  publish();
  if (typeof ResizeObserver === "undefined") return () => host.style.removeProperty(property);
  const observer = new ResizeObserver(publish);
  observer.observe(element);
  return () => {
    observer.disconnect();
    host.style.removeProperty(property);
  };
}
