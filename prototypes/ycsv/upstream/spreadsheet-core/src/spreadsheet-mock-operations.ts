import { parentAndName } from "@/lib/files/api-path";
import { SAMPLE_YCSV } from "@/spreadsheet-core/src/fixtures/sample-sheet";
import { DEFAULT_EMPTY_YCSV } from "@/spreadsheet-core/src/ycsv/ycsv";
import type { SpreadsheetAPIOperations } from "@/spreadsheet-core/src/spreadsheet-types";

const MOCK_FILES: Record<string, string> = {
  "/users/demo/budget.ycsv": SAMPLE_YCSV,
};

/** Storybook / mock shell: in-memory load + rename without Drive API. */
export function createMockSpreadsheetOperations(): SpreadsheetAPIOperations {
  return {
    async loadFile(apiPath) {
      return MOCK_FILES[apiPath] ?? DEFAULT_EMPTY_YCSV;
    },
    async saveFile() {},
    async renameFile(apiPath, newName) {
      const { destination } = parentAndName(apiPath);
      return destination === "/" ? `/${newName}` : `${destination}/${newName}`;
    },
  };
}
