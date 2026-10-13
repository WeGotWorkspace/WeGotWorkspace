import { customAlphabet } from "nanoid";

const gen = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

export const newRowId = () => `r_${gen()}`;
export const newColId = () => `c_${gen()}`;
