import { generateStructured } from "../../lib/gemini";
import classifyPrompt from "../../prompts/classify.json";
import { getSupabaseClient } from "../../lib/supabase";
import type { PostCategory } from "../../lib/types";

// The prompt and tool schema live in prompts/classify.json so the Python
// eval harness (ml/onvibe_ml/evals) scores exactly what production runs.
const CLASSIFY_SCHEMA = classifyPrompt.tool.input_schema;
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
  const postLines = posts.map(
    (p) => `post_id: ${p.id}\ncoauthor_tag: ${p.coauthor_handle ?? "none"}\ncaption: ${p.caption ?? "(no caption)"}`,
  );

  const result = await generateStructured<{ classifications: Classification[] }>(
    SYSTEM_PROMPT,
    CLASSIFY_SCHEMA,
    postLines.join("\n\n---\n\n"),
    "classify_posts",
  );
  return result.classifications;
}

export async function classifyPostsForAccount(accountId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: posts } = await supabase
    .from("posts")
    .select("id, caption, coauthor_handle")
    .eq("account_id", accountId);

  if (!posts || posts.length === 0) return;

  // Chunked so a high-post-volume account across a 90-day, multi-platform
  // window doesn't risk overflowing a single request's context. Chunks run in
  // parallel: Gemini takes over a minute per 40-post chunk, and run one at a
  // time a typical analysis would approach the workflow's 30-minute timeout.
  const results = await Promise.all(chunk(posts, 40).map((batch) => classifyChunk(batch)));
  const allClassifications = results.flat();

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
  await Promise.all(accountIds.map((accountId) => classifyPostsForAccount(accountId)));
}
