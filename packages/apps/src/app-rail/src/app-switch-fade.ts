/**
 * The app switch fade (`app-rail.css`) plays once per switch. Some apps mount their
 * workspace twice in quick succession (chrome first, then again when the first
 * answer lands), and a fresh mount would restart the fade from transparent: a visible
 * double flash. A rail that mounts while the first fade is on screen (or just ended)
 * makes its panes carry on from where that fade stands, or skip it once it is over.
 * A tile click lifts the hold, so a deliberate switch always fades. If the first
 * mount was replaced before it was ever painted, nothing has faded yet and the new
 * panes fade as usual.
 */
const SKIP_ATTRIBUTE = "data-app-fade-skip";
/** Matches the animation in `app-rail.css`. */
const FADE_MS = 160;
const HOLD_MS = 1000;
const FADE_NAME = "app-rail-app-in";

/** When the page last put a fade on screen (a frame after it mounted). */
let paintedAt = 0;
let lastRail: HTMLElement | null = null;

if (typeof document !== "undefined") {
  // Capture: the animation belongs to elements that come and go with the workspace.
  document.addEventListener(
    "animationstart",
    (event) => {
      if (event.animationName === FADE_NAME) paintedAt = performance.now();
    },
    true,
  );
}

/** Lets the next mount fade again. */
export function releaseAppFadeHold(): void {
  paintedAt = 0;
}

/**
 * Called when a rail mounts, before the first paint. The panes after it are the ones
 * `app-rail.css` fades.
 */
export function settleAppFade(rail: HTMLElement): void {
  // The same rail again (effects re-run in development): nothing new mounted.
  if (rail === lastRail) return;
  lastRail = rail;
  const elapsed = performance.now() - paintedAt;
  if (paintedAt === 0 || elapsed > HOLD_MS) return;
  for (
    let pane = rail.nextElementSibling;
    pane instanceof HTMLElement;
    pane = pane.nextElementSibling
  ) {
    if (elapsed < FADE_MS) pane.style.animationDelay = `-${Math.round(elapsed)}ms`;
    else pane.setAttribute(SKIP_ATTRIBUTE, "");
  }
}
