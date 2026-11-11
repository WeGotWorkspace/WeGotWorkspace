/**
 * Browse-mode filters for the Docs home listing. The home view lists drive files
 * Docs can open (Markdown + plain text) across My Drive and group drives, backed by
 * unified search browse mode (no `q` required). See the Docs Home Browse plan.
 */
export const DOCS_HOME_SOURCES = ["file"] as const;

export const DOCS_HOME_EXTENSIONS = ["md", "markdown", "txt"] as const;

export const DOCS_HOME_CATEGORIES = ["document"] as const;

/**
 * What the Docs file list shows: the files above plus Word files and Google
 * Drive links, which offer Save as Markdown (#1983). Offline body sync keeps
 * {@link DOCS_HOME_EXTENSIONS}: only those open in the editor.
 */
export const DOCS_HOME_LIST_EXTENSIONS = [...DOCS_HOME_EXTENSIONS, "docx", "gdoc"] as const;

/** The search index files `.gdoc` under `file`, not `document`. */
export const DOCS_HOME_LIST_CATEGORIES = [...DOCS_HOME_CATEGORIES, "file"] as const;

/** Page size for offset/limit pagination (matches the Mail `hasMore` pattern). */
export const DOCS_HOME_PAGE_SIZE = 50;
