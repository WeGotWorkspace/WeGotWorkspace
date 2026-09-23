import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WgwUnifiedSearchData, WgwUnifiedSearchParams } from "@/lib/api/wgw/search";
import { UnifiedSearchApiDropdown } from "@/unified-search-dropdown/src/unified-search-api-dropdown";

async function mockFetcher(
  params: Omit<WgwUnifiedSearchParams, "signal"> & { signal?: AbortSignal },
): Promise<WgwUnifiedSearchData> {
  const q = (params.q ?? "").toLowerCase();
  const base = [
    {
      id: 1,
      sourceType: "file",
      sourceKey: "users/admin/Project Alpha.md",
      title: "Project Alpha",
      extension: "md",
      category: "document",
      contentType: "text/markdown",
      size: 1200,
      modifiedAt: 1_720_000_000,
      snippet: "Roadmap and launch notes for alpha.",
      tokenScore: 20,
      metadata: { path: "/users/admin/Project Alpha.md" },
    },
    {
      id: 2,
      sourceType: "caldav",
      sourceKey: "admin|default|alpha-kickoff.ics",
      title: "Alpha Kickoff",
      category: "calendar",
      contentType: "text/calendar",
      size: 800,
      modifiedAt: 1_720_000_100,
      snippet: "Kickoff meeting summary and attendees.",
      tokenScore: 14,
      metadata: {},
    },
  ];
  const results = base.filter(
    (item) => item.title.toLowerCase().includes(q) || q.includes("alpha"),
  );
  return {
    query: params.q ?? "",
    limit: params.limit ?? 10,
    offset: params.offset ?? 0,
    hasMore: false,
    sources: params.sources ?? ["file", "caldav", "carddav"],
    filters: {},
    results,
  };
}

const meta = {
  title: "UI/Patterns/Unified Search Api Dropdown",
  component: UnifiedSearchApiDropdown,
  tags: ["autodocs"],
  args: {
    query: "alpha",
    limit: 10,
    debounceMs: 0,
    fetcher: mockFetcher,
  },
  argTypes: {
    query: { control: "text" },
    limit: { control: { type: "number", min: 1, max: 20, step: 1 } },
    minQueryLength: { control: { type: "number", min: 1, max: 5, step: 1 } },
    debounceMs: { control: { type: "number", min: 0, max: 600, step: 10 } },
    fetcher: { control: false },
    onSelect: { control: false },
  },
  render: (args) => (
    <div style={{ width: "560px", maxWidth: "100%" }}>
      <UnifiedSearchApiDropdown {...args} />
    </div>
  ),
} satisfies Meta<typeof UnifiedSearchApiDropdown>;

export default meta;
type Story = StoryObj<typeof UnifiedSearchApiDropdown>;

export const Default: Story = {};

export const ShortQueryPrompt: Story = {
  args: {
    query: "a",
    minQueryLength: 2,
  },
};
