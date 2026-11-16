import type { DriveApiSource } from "@/drive-core/src/drive-api-source";
import type { UseDriveDocsHandoff } from "@/drive-core/src/drive-docs-handoff";

export type DriveAppProps = {
  /** When set (e.g. Storybook live story), bypasses default API routing. */
  apiSource?: DriveApiSource;
  /**
   * Docs' hand-off hook: open in Docs and Save as Markdown. The host passes
   * it in so Drive does not import Docs; without it neither action shows.
   */
  useDocsHandoff?: UseDriveDocsHandoff;
};
