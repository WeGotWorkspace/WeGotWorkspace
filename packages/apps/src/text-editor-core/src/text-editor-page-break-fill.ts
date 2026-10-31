import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * With pages on, `tiptap-pagination-plus` lays out pages as full-width floats that push
 * text lines past each page end. It has no forced break. This plugin stretches every
 * top-level page break to the top of the next page end, so whatever follows starts on
 * a new page. The document is never touched: only CSS variables on the break.
 *
 * It also checks the library's page count after each update: the library counts against
 * the layout it saw during the transaction, so after a paper size change it can end one
 * page short or long until the next edit. A stale count gets one more pass.
 */

export const PAGE_BREAK_FILL_META = "textEditorPageBreakFill";

const pageBreakFillKey = new PluginKey("textEditorPageBreakFill");

const BREAK_SELECTOR = ':scope > [data-type="page-break"]';
const PAGE_END_SELECTOR = "[data-rm-pagination] > .rm-page-break > .breaker";
const PAGINATION_CLASS = "rm-with-pagination";
/** Gives up after this many relayout passes without an edit; layout normally settles in one. */
const MAX_RELAYOUT_PASSES = 4;

export type PageEnd = { top: number; bottom: number };

/** Page geometry for page ends that are not rendered yet (the page count lags one pass). */
export type PageEndFallback = { pagePeriod: number; pageEndHeight: number };

export type PageBreakFillOptions = {
  isEnabled: () => boolean;
  fallback: () => PageEndFallback;
};

/**
 * The page end a break belongs to. `contentBottom` is where the content before the break
 * ends. A break right after another break belongs to the next page, so two breaks in a
 * row leave an empty page, as in a word processor.
 */
export function pageEndForBreak(
  contentBottom: number,
  afterAnotherBreak: boolean,
  ends: readonly PageEnd[],
  fallback: PageEndFallback,
): PageEnd {
  const from = afterAnotherBreak ? contentBottom + 0.5 : contentBottom - 0.5;
  const found = ends.find((end) => end.top >= from);
  if (found) return found;
  const last = ends.at(-1);
  if (!last) return { top: from, bottom: from };
  const missing = Math.max(1, Math.ceil((from - last.top) / fallback.pagePeriod));
  const top = last.top + missing * fallback.pagePeriod;
  return { top, bottom: top + fallback.pageEndHeight };
}

/** Page end whose band (footer, gap, header) contains `y`, if any. */
function pageEndAround(y: number, ends: readonly PageEnd[]): PageEnd | undefined {
  return ends.find((end) => y >= end.top - 0.5 && y < end.bottom);
}

function setVar(el: HTMLElement, name: string, px: number): boolean {
  const value = `${Math.round(px * 100) / 100}px`;
  if (el.style.getPropertyValue(name) === value) return false;
  el.style.setProperty(name, value);
  return true;
}

function clearVars(el: HTMLElement): boolean {
  if (!el.style.getPropertyValue("--page-break-fill")) return false;
  el.style.removeProperty("--page-break-fill");
  el.style.removeProperty("--page-break-pull");
  el.style.removeProperty("--page-break-label-shift");
  return true;
}

function readPageEnds(dom: HTMLElement, domTop: number): PageEnd[] {
  return Array.from(dom.querySelectorAll<HTMLElement>(PAGE_END_SELECTOR)).map((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top - domTop, bottom: rect.bottom - domTop };
  });
}

function measuredFallback(ends: readonly PageEnd[], fallback: PageEndFallback): PageEndFallback {
  // The last page end hides its gap and header, so only a middle one has the full height.
  if (ends.length < 2) return fallback;
  return {
    pagePeriod: ends[1].top - ends[0].top,
    pageEndHeight: ends[0].bottom - ends[0].top,
  };
}

/** Lay out every top-level page break. Returns true when any break changed size. */
export function layoutPageBreaks(dom: HTMLElement, options: PageBreakFillOptions): boolean {
  const breaks = Array.from(dom.querySelectorAll<HTMLElement>(BREAK_SELECTOR));
  if (breaks.length === 0) return false;
  if (!options.isEnabled() || !dom.classList.contains(PAGINATION_CLASS)) {
    return breaks.map(clearVars).some(Boolean);
  }

  const domTop = dom.getBoundingClientRect().top;
  const ends = readPageEnds(dom, domTop);
  const fallback = measuredFallback(ends, options.fallback());
  let changed = false;

  for (const el of breaks) {
    const previous = el.previousElementSibling as HTMLElement | null;
    const contentBottom = previous ? previous.getBoundingClientRect().bottom - domTop : 0;
    // Pull the break up against the content before it, past that block's bottom margin.
    const currentPull = Number.parseFloat(el.style.getPropertyValue("--page-break-pull")) || 0;
    const gap = el.getBoundingClientRect().top - domTop - contentBottom;
    changed = setVar(el, "--page-break-pull", Math.max(0, gap + currentPull)) || changed;

    const afterBreak = previous?.matches('[data-type="page-break"]') ?? false;
    const end = pageEndForBreak(contentBottom, afterBreak, ends, fallback);
    changed = setVar(el, "--page-break-fill", Math.max(0, end.top - contentBottom)) || changed;
    // A break that starts inside a page-end band shows its line at the top of the next page.
    const band = pageEndAround(contentBottom, ends);
    changed =
      setVar(el, "--page-break-label-shift", band ? band.bottom - contentBottom : 0) || changed;
  }
  return changed;
}

/** Content runs past the last page, or the last page is empty. */
export function pageCountIsStale(contentBottom: number, ends: readonly PageEnd[]): boolean {
  const last = ends.at(-1);
  if (!last) return false;
  if (contentBottom > last.top + 1) return true;
  const beforeLast = ends.at(-2);
  return beforeLast != null && contentBottom < beforeLast.top - 1;
}

function contentPageCountIsStale(dom: HTMLElement): boolean {
  if (!dom.classList.contains(PAGINATION_CLASS)) return false;
  const lastBlock = dom.lastElementChild;
  if (!lastBlock || lastBlock.matches("[data-rm-pagination]")) return false;
  const domTop = dom.getBoundingClientRect().top;
  return pageCountIsStale(
    lastBlock.getBoundingClientRect().bottom - domTop,
    readPageEnds(dom, domTop),
  );
}

function scheduleRelayout(view: EditorView, frame: { id: number | null }) {
  if (frame.id != null || typeof requestAnimationFrame !== "function") return;
  frame.id = requestAnimationFrame(() => {
    frame.id = null;
    if (view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(PAGE_BREAK_FILL_META, true).setMeta("addToHistory", false));
  });
}

/**
 * Runs after every view update. When a break changed size, one follow-up transaction lets
 * pagination recount pages. Late layout (images, fonts) triggers a pass too.
 */
export function createPageBreakFillPlugin(options: PageBreakFillOptions): Plugin {
  return new Plugin({
    key: pageBreakFillKey,
    view(view) {
      const frame = { id: null as number | null };
      let passes = 0;
      let geometry = "";
      const relayout = () => scheduleRelayout(view, frame);
      view.dom.addEventListener("load", relayout, true);
      void document.fonts?.ready.then(relayout);
      relayout();
      return {
        update(updatedView, previousState) {
          // A new paper size or pages on/off counts as a fresh start, like an edit.
          const nextGeometry = JSON.stringify([options.isEnabled(), options.fallback()]);
          if (updatedView.state.doc !== previousState.doc || nextGeometry !== geometry) passes = 0;
          geometry = nextGeometry;
          const breaksChanged = layoutPageBreaks(updatedView.dom, options);
          const stale = options.isEnabled() && contentPageCountIsStale(updatedView.dom);
          if (!breaksChanged && !stale) return;
          if (passes >= MAX_RELAYOUT_PASSES) return;
          passes += 1;
          relayout();
        },
        destroy() {
          view.dom.removeEventListener("load", relayout, true);
          if (frame.id != null) cancelAnimationFrame(frame.id);
        },
      };
    },
  });
}
