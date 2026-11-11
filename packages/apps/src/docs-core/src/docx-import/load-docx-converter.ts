/**
 * The only way into the Word converter: mammoth, fflate and a headless editor
 * load on first use, so the Drive and Docs bundles do not grow (#1983, #1619).
 */
function loadConverter() {
  return Promise.all([
    import("@/docs-core/src/docx-import/save-docx-as-markdown"),
    import("@/docs-core/src/docx-import/docx-to-markdown"),
    import("@/docs-core/src/docx-import/docx-import-drive-io"),
  ]);
}

export async function runSaveDocxAsMarkdown(sourcePath: string, signal?: AbortSignal) {
  const [{ saveDocxAsMarkdown }, { convertDocxToMarkdown }, { createDocxImportDriveIo }] =
    await loadConverter();
  return saveDocxAsMarkdown(sourcePath, createDocxImportDriveIo(signal), convertDocxToMarkdown);
}

export async function runImportDocxFile(file: File, docPath: string, signal?: AbortSignal) {
  const [{ importDocxFile }, { convertDocxToMarkdown }, { createDocxImportDriveIo }] =
    await loadConverter();
  return importDocxFile(file, docPath, createDocxImportDriveIo(signal), convertDocxToMarkdown);
}
