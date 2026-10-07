import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, getAnthropicConfig } from "../../lib/anthropic";
import classifyPrompt from "../../prompts/classify.json";
import { getSupabaseClient } from "../../lib/supabase";
import type { PostCategory } from "../../lib/types";

// The prompt and tool schema live in prompts/classify.json so the Python
// eval harness (ml/onvibe_ml/evals) scores exactly what production runs.
const CLASSIFY_TOOL = classifyPrompt.tool as Anthropic.Tool;
const SYSTEM_PROMPT = classifyPrompt.system;

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
