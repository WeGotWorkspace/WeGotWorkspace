import {
  TEXT_EDITOR_FORMAT_BAR_FULL,
  type TextEditorFormatBarConfig,
} from "@/text-editor-core/src";
import { useDocsFormatBarPlacement } from "@/lib/docs-format-bar-placement";

/**
 * The Docs editor's format bar, or none (plain text, or a viewer who cannot format). Where it
 * sits follows the device's Docs setting.
 */
export function useDocsFormatBarConfig(hidden: boolean): TextEditorFormatBarConfig | false {
  const placement = useDocsFormatBarPlacement();
  if (hidden) return false;
  return { groups: TEXT_EDITOR_FORMAT_BAR_FULL, showPrint: false, size: "lg", placement };
}
