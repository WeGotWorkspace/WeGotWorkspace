export { docToFile, fileToDoc, type FileToDocOptions } from "./doc";
export { newColId, newRowId } from "./ids";
export {
  deleteColumn,
  deleteRow,
  editBase,
  insertColumn,
  insertRowAfter,
  setCell,
  type EditBase,
} from "./mutate";
export { toFileForm, toIdForm, type ColInfo } from "./refs";
