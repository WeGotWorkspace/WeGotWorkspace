import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import { UnifiedSearchResultsDropdown } from "@/unified-search-dropdown/src/unified-search-results-dropdown";

const sampleResults: WgwUnifiedSearchResult[] = [
  {
    id: 1,
    sourceType: "file",
    sourceKey: "users/admin/Launch Plan.md",
    title: "Launch Plan",
    extension: "md",
    category: "document",
    contentType: "text/markdown",
    size: 1400,
    modifiedAt: Date.now() / 1000,
    snippet: "Checklist and rollout timeline for alpha launch...",
    metadata: { path: "/users/admin/Launch Plan.md" },
  },
  {
    id: 2,
    sourceType: "file",
    sourceKey: "users/admin/report.csv",
    title: "report.csv",
    extension: "csv",
    category: "spreadsheet",
    contentType: "text/csv",
    size: 3021,
    modifiedAt: Date.now() / 1000,
    snippet: "alpha, 140\nbeta, 98\n",
    metadata: { path: "/users/admin/report.csv" },
  },
  {
    id: 3,
    sourceType: "caldav",
    sourceSubtype: "vevent",
    sourceKey: "admin|default|event-1.ics",
    title: "Team Planning",
    category: "calendar",
    contentType: "text/calendar",
    size: 1024,
    modifiedAt: Date.now() / 1000,
    snippet: "Review milestones and align next sprint deliverables.",
  },
  {
    id: 4,
    sourceType: "carddav",
    sourceKey: "admin|default|contact-1.vcf",
    title: "Ava Coordinator",
    extension: "vcf",
    category: "contact",
    contentType: "text/vcard",
    size: 500,
    modifiedAt: Date.now() / 1000,
    snippet: "Amsterdam, Netherlands",
  },
];

const meta = {
  title: "UI/Patterns/Unified Search Results Dropdown",
  component: UnifiedSearchResultsDropdown,
  tags: ["autodocs"],
  args: {
    query: "alpha",
    results: sampleResults,
    maxResults: 10,
  },
  argTypes: {
    query: { control: "text" },
    loading: { control: "boolean" },
    maxResults: { control: { type: "number", min: 1, max: 20, step: 1 } },
    error: { control: "text" },
    onSelect: { control: false },
    results: { control: false },
  },
  render: (args) => (
    <div style={{ width: "560px", maxWidth: "100%" }}>
      <UnifiedSearchResultsDropdown {...args} />
    </div>
  ),
} satisfies Meta<typeof UnifiedSearchResultsDropdown>;

export default meta;
type Story = StoryObj<typeof UnifiedSearchResultsDropdown>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    loading: true,
    results: [],
  },
};

export const Empty: Story = {
  args: {
    results: [],
  },
};

export const Prompt: Story = {
  args: {
    query: "",
    results: [],
  },
};
