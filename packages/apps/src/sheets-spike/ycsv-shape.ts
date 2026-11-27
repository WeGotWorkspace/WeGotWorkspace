/**
 * Registers the YCSV document shape with the shared collab session
 * (lib/collab/collab-document-shape.ts). Integration slice: the shape code lives in
 * prototypes/ycsv; prototypes/ycsv/src/sheets-core (the future package).
 */
import {
  YCSV_SHAPE_ID,
  isYcsvEmpty,
  readYcsv,
  recognisesYcsv,
  seedYcsv,
} from "../../../../prototypes/ycsv/src/sheets-core/collab/shape";
import { registerCollabDocumentShape } from "@/lib/collab/collab-document-shape";

export { YCSV_SHAPE_ID };

export function registerYcsvShape(): void {
  registerCollabDocumentShape({
    id: YCSV_SHAPE_ID,
    recognises: recognisesYcsv,
    isEmpty: isYcsvEmpty,
    read: readYcsv,
    seed: (target, text, { origin, salt }) => seedYcsv(target, text, { origin, salt }),
  });
}
