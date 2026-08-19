import { html, LitElement, type PropertyValues, unsafeCSS } from "lit";
import componentStyle from "./SwipeContainer.css?inline";

type SwipeIntent = "x" | "y" | null;
type SnapStopMode = "always" | "normal";

export class SwipeContainer extends LitElement {
  static properties = {
    currentIndex: { type: Number, attribute: "current-index" },
    scrollSnapStop: { type: String, attribute: "scroll-snap-stop" },
    disabled: { type: Boolean, attribute: "disabled", reflect: true },
    dir: { type: String, reflect: true },
  };

  /* tailwind-exception: Uses stylesheet import compiled from Tailwind @apply for Shadow DOM swipe behavior. */
  static styles = unsafeCSS(componentStyle);

  #currentIndex = 0;
  declare scrollSnapStop: SnapStopMode;
  declare disabled: boolean;
  declare dir: string;

  #container: HTMLDivElement | null = null;
  #dragX = 0;
  #pointerId: number | null = null;
  #intent: SwipeIntent = null;
  #startX = 0;
  #startY = 0;
  #lastX = 0;
  #lastT = 0;
  #velocityX = 0;
  #pageOffsets: number[] = [0];
  #pageWidths: number[] = [1];
  #maxOffsetX = 0;
  #pages: HTMLElement[] = [];
  #maxIndex = 0;
  #pendingAnimate = false;
  #swipeCommitDistance = 0.5;
  #swipeCommitVelocity = 0.75;
  #edgeResistance = 0.5;
  #resizeObserver: ResizeObserver | null = null;
  #observedPages = new Set<Element>();

  constructor() {
    super();
    this.scrollSnapStop = "normal";
    this.disabled = false;
    this.dir = "";
  }

  get currentIndex(): number {
    return this.#currentIndex;
  }

  set currentIndex(value: number) {
    const safeIndex = Number.isFinite(value) ? Math.trunc(value) : 0;
    const oldValue = this.#currentIndex;
    if (safeIndex === oldValue) return;
    this.#currentIndex = safeIndex;
    this.requestUpdate("currentIndex", oldValue);
  }

  #onSlotChange = (): void => {
    this.#updatePages();
    this.#onResize();
  };

  #onResize = (): void => {
    this.#measurePages();
    this.#applyCurrentIndex(false);
  };

  #onPointerDown = (e: PointerEvent): void => {
    if (this.disabled || e.pointerType !== "touch") return;
    this.#pointerId = e.pointerId;
    this.#intent = null;
    this.#startX = e.clientX;
    this.#startY = e.clientY;
    this.#lastX = e.clientX;
    this.#lastT = performance.now();
    this.#velocityX = 0;
    this.#dragX = 0;
    this.#measurePages();
    if (this.#container) this.#container.style.transition = "none";
  };

  #onPointerMove = (e: PointerEvent): void => {
    if (this.disabled) {
      this.#cancelActiveSwipe();
      return;
    }
    if (e.pointerId !== this.#pointerId) return;
    const dx = e.clientX - this.#startX;
    const dy = e.clientY - this.#startY;
    const directionSign = this.#isRtl() ? -1 : 1;

    if (!this.#intent) {
      const distance = Math.hypot(dx, dy);
      if (distance < 6) return;
      this.#intent = Math.abs(dx) > Math.abs(dy) * 1.1 ? "x" : "y";
    }

    if (this.#intent === "y") return;

    e.preventDefault();

    const now = performance.now();
    const dt = Math.max(1, now - this.#lastT);
    const instantVelocityX = (e.clientX - this.#lastX) / dt;
    this.#velocityX = this.#velocityX * 0.78 + instantVelocityX * 0.22;
    this.#lastX = e.clientX;
    this.#lastT = now;

    let nextDrag = dx;
    const activeIndex = this.#getCurrentIndex();
    const logicalDrag = nextDrag * directionSign;
    const currentLogicalOffset = this.#getLogicalOffsetForIndex(activeIndex);
    const atStartPushingOut = currentLogicalOffset <= 0.5 && logicalDrag > 0;
    const atEndPushingOut = currentLogicalOffset >= this.#maxOffsetX - 0.5 && logicalDrag < 0;
    if (atStartPushingOut || atEndPushingOut) {
      nextDrag = logicalDrag * this.#edgeResistance * directionSign;
    }
    this.#dragX = nextDrag;
    this.#transformContainer();
  };

  #onPointerUp = (e: PointerEvent): void => {
    if (this.disabled) {
      this.#cancelActiveSwipe();
      return;
    }
    if (e.pointerId !== this.#pointerId) return;
    this.#pointerId = null;

    if (this.#intent !== "x") {
      this.#dragX = 0;
      return;
    }

    const directionSign = this.#isRtl() ? -1 : 1;
    const distance = this.#dragX * directionSign;
    const velocityX = this.#velocityX * directionSign;
    let direction = 0;
    if (distance < 0 || (distance === 0 && velocityX < 0)) direction = 1;
    if (distance > 0 || (distance === 0 && velocityX > 0)) direction = -1;
    const activeIndex = this.#getCurrentIndex();
    const activePageWidth = this.#pageWidths[activeIndex] || this.clientWidth || 1;
    const progress = Math.abs(distance) / activePageWidth;
    const fastSwipe = Math.abs(velocityX) > this.#swipeCommitVelocity;
    const farSwipe = progress > this.#swipeCommitDistance;
    const committedByFlick = Math.abs(velocityX) > 0.55 && progress > 0.12;
    const currentLogicalOffset = this.#getLogicalOffsetForIndex(activeIndex);
    const canMoveForward = currentLogicalOffset < this.#maxOffsetX - 0.5;
    let nextIndex = activeIndex;

    if (farSwipe || fastSwipe || committedByFlick) {
      // Native iOS pager feel: commit at most one page per gesture.
      if (direction > 0 && canMoveForward) {
        nextIndex = Math.min(this.#maxIndex, activeIndex + 1);
      } else if (direction < 0) {
        nextIndex = Math.max(0, activeIndex - 1);
      }
    }

    this.#dragX = 0;
    this.#requestSnap(nextIndex, true);
  };

  render() {
    return html`<div class="container"><slot @slotchange=${this.#onSlotChange}></slot></div>`;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) {
      this.#container ??= this.renderRoot.querySelector(".container");
      this.#resizeObserver ??= new ResizeObserver(() => this.#onResize());
      this.addEventListener("pointerdown", this.#onPointerDown, { passive: true });
      this.addEventListener("pointermove", this.#onPointerMove, { passive: false });
      this.addEventListener("pointerup", this.#onPointerUp);
      this.addEventListener("pointercancel", this.#onPointerUp);
      window.addEventListener("resize", this.#onResize, { passive: true });
      this.#resizeObserver.observe(this);
      this.#updatePages();
      this.#onResize();
    }
  }

  firstUpdated(): void {
    this.#container = this.renderRoot.querySelector(".container");
    // Intentional self-assignments: re-run the property setters now that the
    // container exists (they scroll/apply snap state to it).
    // eslint-disable-next-line no-self-assign
    this.currentIndex = this.currentIndex;
    // eslint-disable-next-line no-self-assign
    this.scrollSnapStop = this.scrollSnapStop;
    this.#resizeObserver = new ResizeObserver(() => this.#onResize());
    this.addEventListener("pointerdown", this.#onPointerDown, { passive: true });
    this.addEventListener("pointermove", this.#onPointerMove, { passive: false });
    this.addEventListener("pointerup", this.#onPointerUp);
    this.addEventListener("pointercancel", this.#onPointerUp);
    window.addEventListener("resize", this.#onResize, { passive: true });

    this.#updatePages();
    this.#resizeObserver.observe(this);
    this.#onResize();
  }

  updated(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("disabled") && this.disabled) {
      this.#cancelActiveSwipe();
    }

    if (changedProperties.has("scrollSnapStop")) {
      const normalizedSnapStop = this.#normalizeSnapStop(this.scrollSnapStop);
      if (normalizedSnapStop !== this.scrollSnapStop) {
        this.scrollSnapStop = normalizedSnapStop;
        return;
      }
      this.style.setProperty("--_lc-swipe-snap-stop", this.scrollSnapStop);
    }

    if (changedProperties.has("dir")) {
      this.#measurePages();
      this.#applyCurrentIndex(false);
    }

    if (changedProperties.has("currentIndex")) {
      this.#applyCurrentIndex(this.#pendingAnimate);
      this.#pendingAnimate = false;
      // First paint (undefined → 0/N) is not a user swipe. Emitting `change` on
      // week remount wrote Monday back through React/URL and fought the dropdown.
      if (changedProperties.get("currentIndex") !== undefined) {
        this.dispatchEvent(new CustomEvent("change"));
      }
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("pointerdown", this.#onPointerDown);
    this.removeEventListener("pointermove", this.#onPointerMove);
    this.removeEventListener("pointerup", this.#onPointerUp);
    this.removeEventListener("pointercancel", this.#onPointerUp);
    window.removeEventListener("resize", this.#onResize);
    this.#resizeObserver?.disconnect();
    this.#observedPages.clear();
  }

  #updatePages(): void {
    if (this.#resizeObserver) {
      this.#observedPages.forEach((page) => {
        this.#resizeObserver?.unobserve(page);
      });
      this.#observedPages.clear();
    }
    this.#pages = Array.from(this.children) as HTMLElement[];
    this.#maxIndex = Math.max(0, this.#pages.length - 1);
    if (this.#resizeObserver) {
      this.#pages.forEach((page) => {
        this.#resizeObserver?.observe(page);
        this.#observedPages.add(page);
      });
    }
  }

  /**
   * Re-read page widths and re-apply the snap transform. Call after an ancestor
   * scale/opacity animation: `getBoundingClientRect` follows that transform while
   * `clientWidth` does not, so a mid-animation measure leaves a stale translate.
   */
  remeasure(): void {
    this.#updatePages();
    this.#measurePages();
    this.#applyCurrentIndex(false);
  }

  #measurePages(): void {
    // offsetWidth / clientWidth ignore CSS transforms on ancestors (range-zoom
    // scale on `.content`). getBoundingClientRect does not — a measure during
    // day→week zoom-out made the 7-day stack look ~3% wider than the swipe
    // viewport, invented a leftover maxOffsetX, and left translate3d(-28px)
    // on the grid after the scale was removed (sidebar is outside this host).
    const widths = this.#pages.map((page) => Math.max(1, page.offsetWidth));
    let acc = 0;
    const offsets = widths.map((width) => {
      const offset = acc;
      acc += width;
      return offset;
    });
    const contentWidth = acc;
    const viewportWidth = this.clientWidth || 1;
    const maxOffsetX = Math.max(0, contentWidth - viewportWidth);

    // Support "virtual pages" for a single very wide child.
    // Example: one timeline element can snap every --column-width pixels.
    const columnWidth = this.#resolveColumnWidth();
    if (this.#pages.length === 1 && columnWidth > 0.5) {
      const step = Math.max(1, columnWidth);
      const virtualOffsets: number[] = [0];
      const virtualWidths: number[] = [step];
      for (let nextOffset = step; nextOffset < maxOffsetX - 0.5; nextOffset += step) {
        virtualOffsets.push(nextOffset);
        virtualWidths.push(step);
      }
      if (maxOffsetX > 0.5) {
        const lastOffset = virtualOffsets[virtualOffsets.length - 1] ?? 0;
        if (Math.abs(lastOffset - maxOffsetX) > 0.5) {
          virtualOffsets.push(maxOffsetX);
          virtualWidths.push(step);
        }
      }
      this.#pageOffsets = virtualOffsets;
      this.#pageWidths = virtualWidths;
    } else {
      this.#pageWidths = widths.length ? widths : [1];
      this.#pageOffsets = offsets.length ? offsets : [0];
    }
    this.#maxOffsetX = maxOffsetX;
    this.#maxIndex = Math.max(0, this.#pageOffsets.length - 1);
  }

  #resolveColumnWidth(): number {
    const value = getComputedStyle(this).getPropertyValue("--column-width").trim();
    if (!value) return 0;
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.inlineSize = value;
    this.renderRoot.append(probe);
    const measuredWidth = probe.offsetWidth;
    probe.remove();
    return Number.isFinite(measuredWidth) ? measuredWidth : 0;
  }

  #isRtl(): boolean {
    return getComputedStyle(this).direction === "rtl";
  }

  #normalizeSnapStop(value: unknown): SnapStopMode {
    return value === "always" ? "always" : "normal";
  }

  #cancelActiveSwipe(): void {
    if (this.#pointerId === null && this.#dragX === 0) return;
    this.#pointerId = null;
    this.#intent = null;
    this.#dragX = 0;
    this.#velocityX = 0;
    if (this.#container) {
      this.#container.style.transition = "none";
    }
    this.#transformContainer();
  }

  #getOffsetForIndex(index: number): number {
    const baseOffset = this.#pageOffsets[index] || 0;
    return Math.min(this.#maxOffsetX, Math.max(0, baseOffset));
  }

  #getLogicalOffsetForIndex(index: number): number {
    return this.#getOffsetForIndex(index);
  }

  #normalizeIndex(index: number): number {
    const safeIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
    return Math.max(0, Math.min(this.#maxIndex, safeIndex));
  }

  #getCurrentIndex(): number {
    return this.#normalizeIndex(this.currentIndex);
  }

  #requestSnap(index: number, animate: boolean): void {
    const normalized = this.#normalizeIndex(index);
    if (normalized === this.currentIndex) {
      this.#applyCurrentIndex(animate);
      return;
    }
    this.#pendingAnimate = animate;
    this.currentIndex = normalized;
  }

  #applyCurrentIndex(animate: boolean): void {
    this.#measurePages();
    if (this.#container) {
      this.#container.style.transition = animate
        ? "transform 620ms cubic-bezier(0.22, 1, 0.36, 1)"
        : "none";
    }
    this.#transformContainer();
  }

  #transformContainer(): void {
    if (!this.#container) return;
    const clampedOffset = this.#getOffsetForIndex(this.#getCurrentIndex());
    const x = (this.#isRtl() ? clampedOffset : -clampedOffset) + this.#dragX;
    this.#container.style.transform = `translate3d(${x}px, 0, 0)`;
  }
}

if (!customElements.get("swipe-container")) {
  const SwipeContainerConstructor = SwipeContainer as unknown as CustomElementConstructor;
  customElements.define("swipe-container", SwipeContainerConstructor);
}
