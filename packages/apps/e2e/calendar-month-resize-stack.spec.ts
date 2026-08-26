import { expect, test, type Page } from "@playwright/test";
import { colorDistance, pngPixelAt, type Rgba } from "./helpers/png-pixel";

/** Mock-tier seeded month (~360 events, anchor 2033-01-12). */
const CALENDAR_SEEDED_WIDE = "apps-calendar--seeded-wide";

type CardBox = {
  summary: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  overlay: boolean;
  dragging: boolean;
  visibility: string;
};

test.describe("Calendar month resize stacking (Storybook)", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  test("resized month card paints above neighboring day cards", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.goto(`/iframe.html?id=${CALENDAR_SEEDED_WIDE}&viewMode=story`);

    const closeMenu = page.getByRole("button", { name: "Close menu" });
    if (await closeMenu.isVisible().catch(() => false)) {
      await closeMenu.click();
    }

    await expect
      .poll(async () => (await collectCards(page)).length, { timeout: 30_000 })
      .toBeGreaterThan(8);

    const originCol = await dayColumn(page, "Monday, January 10, 2033");
    const destCol = await dayColumn(page, "Tuesday, January 11, 2033");
    expect(originCol, "Jan 10 column missing").toBeTruthy();
    expect(destCol, "Jan 11 column missing").toBeTruthy();

    const cards = await collectCards(page);
    const originCards = cardsInColumn(cards, originCol!);
    const destCards = cardsInColumn(cards, destCol!);
    const resized =
      originCards.find((card) => /Design review/i.test(card.summary)) ?? originCards[0];
    expect(
      resized,
      `no visible card in Jan 10 column: ${originCards.map((c) => c.summary)}`,
    ).toBeTruthy();

    const neighbor =
      destCards.find(
        (card) =>
          card.summary !== resized!.summary &&
          rangesOverlap(card.y, card.y + card.height, resized!.y, resized!.y + resized!.height) &&
          card.color &&
          resized!.color &&
          card.color !== resized!.color,
      ) ??
      destCards.find(
        (card) =>
          card.summary !== resized!.summary &&
          rangesOverlap(card.y, card.y + card.height, resized!.y, resized!.y + resized!.height),
      ) ??
      destCards.find((card) => card.summary !== resized!.summary);
    expect(
      neighbor,
      `no visible neighbor in Jan 11 column: ${destCards.map((c) => c.summary)}`,
    ).toBeTruthy();

    const sample = {
      x: destCol!.x + destCol!.width / 2,
      y: clamp(
        resized!.y + resized!.height / 2,
        neighbor!.y + 2,
        neighbor!.y + neighbor!.height - 2,
      ),
    };
    const resizedColor = await samplePagePixel(
      page,
      resized!.x + resized!.width / 2,
      resized!.y + resized!.height / 2,
    );
    const neighborColor = await samplePagePixel(
      page,
      neighbor!.x + neighbor!.width / 2,
      neighbor!.y + neighbor!.height / 2,
    );
    expect(
      colorDistance(resizedColor, neighborColor),
      `need distinct paints to assert stacking: resized=${fmt(resizedColor)} neighbor=${fmt(neighborColor)}`,
    ).toBeGreaterThan(400);

    const handle = await endResizeHandle(page, resized!.summary);
    expect(handle, "end resize handle did not mount").toBeTruthy();

    await page.mouse.move(handle!.x, handle!.y);
    await page.mouse.down();
    await page.mouse.move(sample.x, sample.y, { steps: 16 });

    const liveCards = await collectCards(page);
    const overlay = liveCards.find((card) => card.overlay) ?? null;
    const inCell = liveCards.find(
      (card) => card.dragging && !card.overlay && card.summary === resized!.summary,
    );
    const layer = await dragLayerInfo(page);
    const hit = await paintedHitAt(page, sample.x, sample.y);
    const overlapColor = await samplePagePixel(page, sample.x, sample.y);
    const overlapShot = await page.screenshot({
      clip: clipAround(sample.x, sample.y, 180, 90),
    });
    await testInfo.attach("month-resize-overlap", { body: overlapShot, contentType: "image/png" });
    await testInfo.attach("month-resize-stack-dump", {
      body: JSON.stringify(
        {
          resized,
          neighbor,
          handle,
          sample,
          overlay,
          inCell,
          layer,
          hit,
          colors: {
            resized: resizedColor,
            neighbor: neighborColor,
            overlap: overlapColor,
            distResized: colorDistance(overlapColor, resizedColor),
            distNeighbor: colorDistance(overlapColor, neighborColor),
          },
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    await page.mouse.up();

    expect(overlay, `resize overlay missing: ${JSON.stringify(hit)}`).toBeTruthy();
    expect(overlay!.width, "resize overlay has 0 width").toBeGreaterThan(8);
    expect(overlay!.height, "resize overlay has 0 height").toBeGreaterThan(8);
    expect(
      overlay!.x + overlay!.width,
      "resize overlay did not grow into the next day",
    ).toBeGreaterThan(destCol!.x + 8);
    expect(layer?.popoverOpen, `drag layer is not in the top layer: ${JSON.stringify(layer)}`).toBe(
      true,
    );
    expect(layer?.position, "resize overlay must be viewport-fixed").toBe("fixed");
    expect(inCell, "in-cell resize source missing").toBeTruthy();
    expect(inCell!.visibility, "in-cell resize source must stay hidden").toBe("hidden");
    expect(inCell!.x, "in-cell left edge left the origin day").toBeGreaterThanOrEqual(
      originCol!.x - 2,
    );
    expect(inCell!.x, "in-cell left edge jumped into a later day").toBeLessThan(
      originCol!.x + originCol!.width,
    );
    expect(
      colorDistance(overlapColor, resizedColor),
      `overlap painted neighbor (${fmt(overlapColor)}) over resized card (${fmt(resizedColor)}); hit=${JSON.stringify(hit)}`,
    ).toBeLessThan(colorDistance(overlapColor, neighborColor));
  });
});

function cardsInColumn(cards: CardBox[], col: { x: number; width: number }): CardBox[] {
  const mid = col.x + col.width / 2;
  return cards
    .filter((card) => !card.overlay && card.x < mid && card.x + card.width > mid)
    .sort((a, b) => a.y - b.y);
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return value;
  return Math.min(max, Math.max(min, value));
}

async function dayColumn(page: Page, name: string) {
  const header = page.getByRole("button", { name, exact: true });
  await expect(header).toBeVisible({ timeout: 30_000 });
  return header.boundingBox();
}

function clipAround(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(0, Math.round(x - width / 2)),
    y: Math.max(0, Math.round(y - height / 2)),
    width,
    height,
  };
}

function fmt(c: Rgba): string {
  return `rgba(${c.r},${c.g},${c.b},${c.a})`;
}

async function samplePagePixel(page: Page, x: number, y: number): Promise<Rgba> {
  const buf = await page.screenshot({
    clip: { x: Math.max(0, Math.floor(x)), y: Math.max(0, Math.floor(y)), width: 1, height: 1 },
  });
  return pngPixelAt(buf, 0, 0);
}

async function endResizeHandle(page: Page, summary: string) {
  const card = page
    .locator("event-card")
    .filter({ hasText: new RegExp(summary, "i") })
    .first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.hover();
  const handle = page
    .locator(".event")
    .filter({ has: page.locator("event-card").filter({ hasText: new RegExp(summary, "i") }) })
    .locator("resize-handle[position='end']")
    .first();
  await expect(handle).toBeAttached({ timeout: 10_000 });
  const box = await handle.boundingBox();
  if (!box) return null;
  return { x: box.x + Math.max(box.width / 2, 4), y: box.y + Math.max(box.height / 2, 2) };
}

async function collectCards(page: Page): Promise<CardBox[]> {
  return page.evaluate(() => {
    const out: CardBox[] = [];
    const visit = (root: Document | ShadowRoot) => {
      for (const host of root.querySelectorAll("event-card")) {
        const summary =
          ("summary" in host && typeof host.summary === "string" && host.summary) ||
          host.getAttribute("summary") ||
          "";
        if (!summary) continue;
        const rect = host.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        const wrap = composedClosest(host, ".event");
        const color =
          getComputedStyle(host).getPropertyValue("--_lc-event-bg").trim() ||
          getComputedStyle(host).backgroundColor;
        out.push({
          summary,
          color,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          overlay: Boolean(wrap?.classList.contains("event--drag-overlay")),
          dragging: Boolean(wrap?.classList.contains("event--dragging")),
          visibility: wrap ? getComputedStyle(wrap).visibility : "",
        });
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(document);
    return out;

    function composedClosest(node: Element, selector: string): HTMLElement | null {
      let cur: Element | null = node;
      while (cur) {
        if (cur.matches(selector)) return cur as HTMLElement;
        const parent = cur.parentElement;
        if (parent) {
          cur = parent;
          continue;
        }
        const root = cur.getRootNode();
        cur = root instanceof ShadowRoot ? root.host : null;
      }
      return null;
    }
  });
}

async function dragLayerInfo(page: Page) {
  return page.evaluate(() => {
    const visit = (
      root: Document | ShadowRoot,
    ): { popoverOpen: boolean; position: string } | null => {
      const layer = root.querySelector(".drag-layer");
      if (layer instanceof HTMLElement) {
        return {
          popoverOpen: layer.matches(":popover-open"),
          position: getComputedStyle(layer).position,
        };
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const found = visit(el.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };
    return visit(document);
  });
}

async function paintedHitAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ px, py }) =>
      document
        .elementsFromPoint(px, py)
        .slice(0, 8)
        .map((node) => ({
          localName: node.localName,
          className: typeof node.className === "string" ? node.className : "",
        })),
    { px: x, py: y },
  );
}
