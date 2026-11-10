import type { SaveAsMarkdownRefusal } from "@/docs-core/src/docx-import/save-docx-as-markdown";

/** Words for Save as Markdown (#1983) and Import Word file (#1619). Plain language, no file-format jargon beyond names people see. */
export const docxImportLabels = {
  saveAsMarkdown: "Save as Markdown",
  offlineReason: "Needs a connection: images and the new document are saved in Drive.",
  saving: (name: string) => `Saving “${name}” as Markdown…`,
  failed: (name: string) => `Could not save “${name}” as Markdown. Nothing was created.`,
  openDocxInDocs: "Word files open as a copy: choose Save as Markdown in the file’s menu.",
  refusals: {
    "ole-container":
      "This is an old Word file (.doc) or a password-protected file. Save it as .docx without a password in Word, then try again.",
    "not-a-zip": "This file is not a Word document.",
    "corrupt-zip": "This Word file is damaged and cannot be read.",
    "not-a-docx": "This file has no Word document inside.",
    "too-large": "This Word file is too large to convert in the browser.",
    unreadable: "This Word file could not be read.",
    "doc-too-large": "The document would be larger than 2 MB, the most a document can hold.",
  } satisfies Record<SaveAsMarkdownRefusal, string>,
  googleLinkTitle: "This file only links to Google Docs",
  googleLinkDescription: (name: string) =>
    `“${name}” holds no text, only a link to a document in Google Docs.`,
  googleLinkSteps:
    "Open the document in Google Docs and choose File → Download → Microsoft Word (.docx). Upload that file here, then choose Save as Markdown.",
  reportTitle: "Some parts did not come across",
  reportDescription: (name: string) =>
    `This document was made from “${name}”. These parts of the Word file are not in it:`,
  close: "OK",
  importWordFile: "Import Word file",
  newDocumentMenu: "More ways to make a document",
  importing: (name: string) => `Importing “${name}”…`,
  importFailed: (name: string) => `Could not import “${name}”. Nothing was created.`,
  importDialogTitle: "Import Word file",
  importDialogDescription: (name: string) =>
    `Choose a name and folder for the document made from “${name}”.`,
  importDialogConfirm: "Import",
} as const;
