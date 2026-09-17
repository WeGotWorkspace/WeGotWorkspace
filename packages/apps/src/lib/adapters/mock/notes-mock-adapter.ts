import type { Note } from "@/lib/models/note";
import type { NotesAdapter } from "@/lib/adapters/notes-adapter";

const INITIAL_NOTEBOOKS = ["The Journal", "Field Observations", "Drafts", "Published"];
const INITIAL_TAGS = ["architecture", "nordic", "modernism", "essay", "travel", "criticism"];

const INITIAL_NOTES: Note[] = [
  {
    id: "1",
    title: "Endless scroll",
    category: "Essay",
    date: "12 Oct 2024",
    starred: true,
    excerpt:
      "The silence of a library is not the absence of sound, but rather the presence of intense focus. We must consider...",
    body: [
      "<h1>Endless scroll</h1> We must consider how space dictates thought. A high ceiling invites abstraction; a narrow corridor forces momentum. In designing digital workspaces, we have too often favored the momentum of the corridor - the endless scroll - over the contemplation of the high-ceilinged room.",
      "Consider the library at Oxford. The wood-paneled walls don't just insulate sound; they create an atmosphere of permanence. When you sit there, you are not merely a user of data, but a participant in a lineage of inquiry. Digital tools should strive for this same sense of gravitas.",
      "Every sentence we commit to paper - or to screen - should feel as though it is being carved into a physical medium. The ease with which we can delete digital text has led to a degradation of intent.",
    ],
    notebook: "The Journal",
    tags: ["architecture", "essay"],
    wordCount: 1248,
  },
  {
    id: "2",
    title: "Atlantic light",
    category: "Monograph",
    date: "08 Oct 2024",
    excerpt:
      "Sharp granite edges meet the Atlantic. The light here has a crystalline quality that refuses to be captured by...",
    body: [
      "Sharp granite edges meet the Atlantic. The light here has a crystalline quality that refuses to be captured by photography - it must be remembered, or written.",
      "The villages cling to the inlets as if the sea might decide, at any moment, to take them back. There is a humility in that arrangement that the inland cities have forgotten.",
    ],
    notebook: "Field Observations",
    tags: ["nordic", "travel"],
    wordCount: 842,
  },
  {
    id: "3",
    title: "Bauhaus today",
    category: "Research",
    date: "29 Sep 2024",
    excerpt:
      "When the Bauhaus movement first proposed its principles, the world was a different place. Today, we must ask...",
    body: [
      "When the Bauhaus movement first proposed its principles, the world was a different place. Today, we must ask whether the doctrine of pure function still serves us, or whether ornament - long exiled - has earned its return.",
      "The pendulum has swung. The minimalism of the last two decades was a reaction against excess. The next reaction is already underway.",
    ],
    notebook: "The Journal",
    tags: ["modernism", "criticism"],
    wordCount: 1567,
  },
  {
    id: "4",
    title: "The weight of paper",
    category: "Review",
    date: "24 Sep 2024",
    archived: true,
    excerpt:
      "The tactile nature of paper is irreplaceable. The smell of ink, the grain of the page, the physical weight of...",
    body: [
      "The tactile nature of paper is irreplaceable. The smell of ink, the grain of the page, the physical weight of a bound volume - these are not nostalgic affectations. They are part of how meaning is transmitted.",
    ],
    notebook: "Drafts",
    tags: ["essay", "criticism"],
    wordCount: 612,
  },
];

export const notesMockAdapter: NotesAdapter = {
  getSeedData() {
    return {
      notes: INITIAL_NOTES,
      notebooks: INITIAL_NOTEBOOKS,
      tags: INITIAL_TAGS,
      notebookCollections: [
        { id: "The Journal", name: "The Journal", color: "#14b8a6", isSharee: false },
        { id: "Field Observations", name: "Field Observations", color: "#0ea5e9", isSharee: false },
        { id: "Drafts", name: "Drafts", color: "#f59e0b", isSharee: false },
        { id: "Published", name: "Published", color: "#8b5cf6", isSharee: false },
      ],
    };
  },
};
