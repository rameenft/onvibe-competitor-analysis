import { getAnthropicClient, getAnthropicConfig } from "../../lib/anthropic";
import { getSupabaseClient } from "../../lib/supabase";
import type { PostCategory } from "../../lib/types";

const CATEGORIES: PostCategory[] = [
  "collaboration",
  "campaign",
  "paid_promotion",
  "product",
  "testimonial",
  "educational",
  "other",
];

// Same tool-use pattern as the Python prototype's pipeline/categorize.py,
// ported to the Anthropic TS SDK.
const CLASSIFY_TOOL = {
  name: "classify_posts",
  description: "Classify each social media post into exactly one content category.",
  input_schema: {
    type: "object" as const,
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            post_id: { type: "string" },
            category: { type: "string", enum: CATEGORIES },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string" },
          },
          required: ["post_id", "category", "confidence", "rationale"],
        },
      },
    },
    required: ["classifications"],
  },
};

const SYSTEM_PROMPT = `You are classifying social media posts (Instagram, TikTok, or LinkedIn) for a competitive analysis report.
A tagged co-author alone does not automatically mean paid influencer marketing — read the
caption for signals of employee advocacy, institutional partnership, or genuine collaboration
before defaulting to "collaboration" vs "paid_promotion". Only use "paid_promotion" when the
caption or a coauthor tag clearly signals sponsorship (e.g. "Paid partnership", "#ad", explicit
sponsorship language). Keep rationale to one sentence.`;

interface Classification {
  post_id: string;
  category: PostCategory;
  confidence: number;
  rationale: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function classifyChunk(posts: { id: string; caption: string | null; coauthor_handle: string | null }[]) {
  const anthropic = getAnthropicClient();
  const { model } = getAnthropicConfig();

  const postLines = posts.map(
    (p) => `post_id: ${p.id}\ncoauthor_tag: ${p.coauthor_handle ?? "none"}\ncaption: ${p.caption ?? "(no caption)"}`,
  );

  const message = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_posts" },
    messages: [{ role: "user", content: postLines.join("\n\n---\n\n") }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return [];
  return (toolUse.input as { classifications: Classification[] }).classifications;
}

export async function classifyPostsForAccount(accountId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: posts } = await supabase
    .from("posts")
    .select("id, caption, coauthor_handle")
    .eq("account_id", accountId);

  if (!posts || posts.length === 0) return;

  // Chunked so a high-post-volume account across a 90-day, multi-platform
  // window doesn't risk overflowing a single request's context.
  const allClassifications: Classification[] = [];
  for (const batch of chunk(posts, 40)) {
    allClassifications.push(...(await classifyChunk(batch)));
  }

  if (allClassifications.length === 0) return;

  await supabase.from("post_categories").upsert(
    allClassifications.map((c) => ({
      post_id: c.post_id,
      category: c.category,
      confidence: c.confidence,
      rationale: c.rationale,
    })),
    { onConflict: "post_id" },
  );
}

export async function classifyAll(accountIds: string[]): Promise<void> {
  for (const accountId of accountIds) {
    await classifyPostsForAccount(accountId);
  }
}
