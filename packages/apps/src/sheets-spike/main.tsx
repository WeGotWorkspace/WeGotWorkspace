import "@/lib/random-uuid-polyfill";
import "@/provide-collab-content-codec";
import { createRoot } from "react-dom/client";
import { SheetSpikeApp } from "./sheet-spike-app";
import { registerYcsvShape } from "./ycsv-shape";

registerYcsvShape();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<SheetSpikeApp />);
