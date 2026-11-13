export { DocsFilePreview } from "@/docs-core/src/docs-file-preview";
export type {
  DocsFilePreviewProps,
  DocsFilePreviewVariant,
} from "@/docs-core/src/docs-file-preview";
export { DocsApp } from "@/docs-core/src/docs-app";
export type { DocsAppProps } from "@/docs-core/src/docs-app-props";
export { DocsWorkspace } from "@/docs-core/src/docs-workspace";
export type { DocsWorkspaceProps } from "@/docs-core/src/docs-workspace-props";
export { DocsHomeWorkspace } from "@/docs-core/src/docs-home-workspace";
export type { DocsHomeWorkspaceProps } from "@/docs-core/src/docs-home-workspace";
export { useDocsHomeList, mapDocsHomeResults } from "@/docs-core/src/use-docs-home-list";
export { sortDocsHomeResults, type DocsHomeFetcher } from "@/lib/files/docs-home-listing";
export {
  applyDocsHomeGroupDisplayNames,
  buildDocsFolderPickerRootLabels,
  buildDocsHomeDrives,
  collectGroupRoots,
  DOCS_DRIVE_UI_PERSONAL_PATH,
  docsHomeGroupSlugFromPrincipalId,
  mergeGroupRoots,
  newDocumentApiPath,
  nextUntitledMarkdownName,
  fallbackUntitledMarkdownName,
  resolveDocsDriveLabel,
  resolveNewDocumentName,
  type DocsHomeDrive,
  type DocsHomeGroupRoot,
} from "@/docs-core/src/docs-home-drives";
export { DOCS_EDITOR_EXTENSIONS } from "@/lib/files/drive-models";
export {
  docsApiPathFromSearch,
  docsHrefFromApiPath,
  docsSearchFromApiPath,
  parseDocsRouteSearch,
  validateDocsRouteSearch,
  type DocsRouteSearch,
} from "@/lib/files/docs-route-search";
export { useOpenDocsFile } from "@/docs-core/src/use-open-docs-file";
export { useDocsDriveHandoff } from "@/docs-core/src/use-docs-drive-handoff";
