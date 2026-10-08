import { generateStructured } from "../../lib/gemini";
import classifyPrompt from "../../prompts/classify.json";
import { assertOk, getSupabaseClient } from "../../lib/supabase";
import { createLimiter } from "../../lib/concurrency";
import type { PostCategory } from "../../lib/types";

// The prompt and tool schema live in prompts/classify.json so the Python
// eval harness (ml/onvibe_ml/evals) scores exactly what production runs.
const CLASSIFY_SCHEMA = classifyPrompt.tool.input_schema;
const SYSTEM_PROMPT = classifyPrompt.system;
const VALID_CATEGORIES = new Set<string>(classifyPrompt.categories);

const CHUNK_SIZE = 40;
// Gemini takes over a minute per 40-post chunk, so chunks run in parallel, but
// capped: every account's chunks share this limit so a 12-account analysis
// can't fire dozens of requests at once and hit rate limits.
const MAX_CONCURRENT_CHUNKS = 4;
// More than this share of posts left unclassified after a retry fails the run
// instead of quietly producing category metrics from a fraction of the data.
const MAX_UNCLASSIFIED_SHARE = 0.2;

interface Classification {
  post_id: string;
  category: PostCategory;
  confidence: number;
  rationale: string;
}

interface PostToClassify {
  id: string;
  caption: string | null;
  coauthor_handle: string | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function classifyChunk(accountHandle: string, posts: PostToClassify[]): Promise<Classification[]> {
  const postLines = posts.map(
    (p) =>
      `post_id: ${p.id}\naccount: @${accountHandle}\ncoauthor_tag: ${p.coauthor_handle ?? "none"}\n` +
      `caption: ${p.caption ?? "(no caption)"}`,
  );

  const result = await generateStructured<{ classifications: Classification[] }>(
    SYSTEM_PROMPT,
    CLASSIFY_SCHEMA,
    postLines.join("\n\n---\n\n"),
    "classify_posts",
  );
  return keepValid(result.classifications ?? [], posts);
}

// The model's output is untrusted: keep only ids that were actually in the
// batch, with a known category, once each. A single invented post_id would
// otherwise violate the foreign key and fail the entire upsert.
export function keepValid(classifications: Classification[], posts: { id: string }[]): Classification[] {
  const wanted = new Set(posts.map((p) => p.id));
  const seen = new Set<string>();
  const valid: Classification[] = [];
  for (const c of classifications) {
    if (!wanted.has(c.post_id) || seen.has(c.post_id) || !VALID_CATEGORIES.has(c.category)) continue;
    seen.add(c.post_id);
    valid.push({ ...c, confidence: Math.min(1, Math.max(0, Number(c.confidence) || 0)) });
  }
  return valid;
}

async function classifyWithRetry(accountHandle: string, batch: PostToClassify[]): Promise<Classification[]> {
  const first = await classifyChunk(accountHandle, batch);
  const done = new Set(first.map((c) => c.post_id));
  const missing = batch.filter((p) => !done.has(p.id));
  if (missing.length === 0) return first;

  const second = await classifyChunk(accountHandle, missing);
  return [...first, ...second];
}

export async function classifyPostsForAccount(
  accountId: string,
  limit: <T>(task: () => Promise<T>) => Promise<T> = createLimiter(MAX_CONCURRENT_CHUNKS),
): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: posts } = assertOk(
    await supabase.from("posts").select("id, caption, coauthor_handle").eq("account_id", accountId),
    "Loading posts to classify",
  );
  const { data: account } = assertOk(
    await supabase.from("accounts").select("handle").eq("id", accountId).single(),
    "Loading account handle",
  );

  if (!posts || posts.length === 0) return;

  const results = await Promise.all(
    chunk(posts as PostToClassify[], CHUNK_SIZE).map((batch) =>
      limit(() => classifyWithRetry(account?.handle ?? "unknown", batch)),
    ),
  );
  const allClassifications = results.flat();

  const unclassified = posts.length - allClassifications.length;
  if (unclassified > 0) {
    console.warn(`@${account?.handle}: ${unclassified} of ${posts.length} posts left unclassified after retry.`);
  }
  if (unclassified / posts.length > MAX_UNCLASSIFIED_SHARE) {
    throw new Error(
      `Classification failed for @${account?.handle}: ${unclassified} of ${posts.length} posts got no valid category.`,
    );
  }
  if (allClassifications.length === 0) return;

  assertOk(
    await supabase.from("post_categories").upsert(
      allClassifications.map((c) => ({
        post_id: c.post_id,
        category: c.category,
        confidence: c.confidence,
        rationale: c.rationale,
      })),
      { onConflict: "post_id" },
    ),
    `Saving categories for @${account?.handle}`,
  );
}

export async function classifyAll(accountIds: string[]): Promise<void> {
  const limit = createLimiter(MAX_CONCURRENT_CHUNKS);
  await Promise.all(accountIds.map((accountId) => classifyPostsForAccount(accountId, limit)));
}
