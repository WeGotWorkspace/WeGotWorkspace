/**
 * Shared control height scale for Button, IconButton, Input, SelectTrigger,
 * LocaleDatePicker, Textarea (padding/font), and SegmentedControl.
 *
 * | Size | Height |
 * |------|--------|
 * | xs   | 28px   |
 * | sm   | 32px   |
 * | md   | 36px (default — action bar / forms) |
 * | lg   | 40px   |
 * | xl   | 44px (sidebar New / hero CTAs) |
 */
export const CONTROL_SIZE_OPTIONS = ["xs", "sm", "md", "lg", "xl"] as const;

export type ControlSize = (typeof CONTROL_SIZE_OPTIONS)[number];

/** BEM size modifier for a block (`button--size-md`, `input--size-md`, …). */
export function controlSizeClassName(block: string, size: ControlSize): string {
  return `${block}--size-${size}`;
}
