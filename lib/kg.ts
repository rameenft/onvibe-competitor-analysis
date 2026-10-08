import { getSupabaseClient } from "./supabase";

// Reads the knowledge graph that ml/onvibe_ml/kg persists to Supabase
// (supabase/kg_schema.sql). The graph is built offline by the Python layer, so
// an analysis has no graph data until `python -m onvibe_ml kg build --persist`
// has run after it; callers must treat "no graph" as a normal outcome.

// Same cutoffs as topic_gaps() in ml/onvibe_ml/kg/queries.py: fewer competitor posts than
// this is noise, and a median lift under 1 means the topic doesn't beat the account's norm.
const MIN_POSTS = 3;
const MIN_MEDIAN_LIFT = 1.0;
const ID_CHUNK = 100;
const PAGE_SIZE = 1000; // PostgREST's default row cap per request

export interface TopicGap {
  topic: string;
  /** Median of (post engagement / that account's median engagement) across competitor posts. */
  medianLift: number;
  postCount: number;
  /** Competitor accounts that post about the topic, e.g. "@stanforcreators". */
  accounts: string[];
}

export interface TopicGapsResult {
  gaps: TopicGap[];
  /** Competitor posts the graph holds for this analysis; the evidence base for every gap. */
  competitorPostCount: number;
}

export interface TopicGapInput {
  targetIds: string[];
  rivalIds: string[];
  accountNames: Record<string, string>;
  topicNames: Record<string, string>;
  posts: { id: string; account: string; lift: number | null }[];
  about: { post: string; topic: string }[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Topics competitors post about with above-median engagement that the target never covers. */
export function computeTopicGaps(input: TopicGapInput, limit = 5): TopicGapsResult {
  const targets = new Set(input.targetIds);
  const rivals = new Set(input.rivalIds);
  const postAccount = new Map(input.posts.map((p) => [p.id, p.account]));
  const postLift = new Map(input.posts.map((p) => [p.id, p.lift ?? 0]));

  // topic -> account -> lifts
  const table = new Map<string, Map<string, number[]>>();
  for (const { post, topic } of input.about) {
    const account = postAccount.get(post);
    if (!account) continue;
    const byAccount = table.get(topic) ?? new Map<string, number[]>();
    byAccount.set(account, [...(byAccount.get(account) ?? []), postLift.get(post) ?? 0]);
    table.set(topic, byAccount);
  }

  const gaps: TopicGap[] = [];
  for (const [topic, byAccount] of table) {
    const targetCovers = [...targets].some((a) => byAccount.has(a));
    const rivalLifts = [...rivals].flatMap((a) => byAccount.get(a) ?? []);
    if (targetCovers || rivalLifts.length < MIN_POSTS) continue;
    const medianLift = median(rivalLifts);
    if (medianLift < MIN_MEDIAN_LIFT) continue;
    gaps.push({
      topic: input.topicNames[topic] ?? topic,
      medianLift,
      postCount: rivalLifts.length,
      accounts: [...rivals].filter((a) => byAccount.has(a)).map((a) => input.accountNames[a] ?? a).sort(),
    });
  }

  gaps.sort((a, b) => b.medianLift - a.medianLift || b.postCount - a.postCount || a.topic.localeCompare(b.topic));
  const competitorPostCount = input.posts.filter((p) => rivals.has(p.account)).length;
  return { gaps: gaps.slice(0, limit), competitorPostCount };
}

export interface CompetitorTopics {
  competitor: string;
  topics: { topic: string; medianLift: number; postCount: number }[];
}

/**
 * One entry per competitor: the gap topics it posts about, strongest first, so near-duplicate topics
 * ("photo backup", "backing up photos") read as one line instead of several. A topic several
 * competitors share appears under each of them with the combined lift and post count. Competitors
 * are ordered by their strongest topic, and each keeps its top `perCompetitor` topics.
 */
export function groupGapsByCompetitor(gaps: TopicGap[], perCompetitor = 4): CompetitorTopics[] {
  const byCompetitor = new Map<string, CompetitorTopics["topics"]>();
  for (const gap of gaps) {
    for (const competitor of gap.accounts) {
      byCompetitor.set(competitor, [
        ...(byCompetitor.get(competitor) ?? []),
        { topic: gap.topic, medianLift: gap.medianLift, postCount: gap.postCount },
      ]);
    }
  }
  return [...byCompetitor]
    .map(([competitor, topics]) => ({
      competitor,
      topics: [...topics]
        .sort((a, b) => b.medianLift - a.medianLift || b.postCount - a.postCount || a.topic.localeCompare(b.topic))
        .slice(0, perCompetitor),
    }))
    .sort((a, b) => b.topics[0].medianLift - a.topics[0].medianLift || a.competitor.localeCompare(b.competitor));
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function fetchAll<T>(what: string, page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += ID_CHUNK) out.push(items.slice(i, i + ID_CHUNK));
  return out;
}

/**
 * Topic gaps for one analysis, or null when the graph has nothing for it (not built yet, or built
 * before this analysis ran). Throws if the graph tables can't be read.
 */
export async function getTopicGaps(analysisId: string): Promise<TopicGapsResult | null> {
  const supabase = getSupabaseClient();

  const competes = await fetchAll<{ src: string; dst: string }>("Loading graph competitors", (from, to) =>
    supabase.from("kg_edges").select("src, dst").eq("type", "COMPETES_WITH").eq("analysis_id", analysisId).range(from, to),
  );
  if (competes.length === 0) return null;
  const targetIds = [...new Set(competes.map((e) => e.src))];
  const rivalIds = [...new Set(competes.map((e) => e.dst))];
  const accountIds = [...targetIds, ...rivalIds];

  const accounts = await fetchAll<{ id: string; name: string }>("Loading graph accounts", (from, to) =>
    supabase.from("kg_nodes").select("id, name").in("id", accountIds).range(from, to),
  );
  const accountNames = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  const posted = await fetchAll<{ src: string; dst: string }>("Loading graph posts", (from, to) =>
    supabase.from("kg_edges").select("src, dst").eq("type", "POSTED").in("src", accountIds).range(from, to),
  );
  const postAccount = new Map(posted.map((e) => [e.dst, e.src]));

  const posts: TopicGapInput["posts"] = [];
  const about: TopicGapInput["about"] = [];
  for (const ids of chunks([...postAccount.keys()])) {
    const nodes = await fetchAll<{ id: string; properties: { lift?: number | null } }>("Loading graph post lift", (from, to) =>
      supabase.from("kg_nodes").select("id, properties").in("id", ids).range(from, to),
    );
    for (const n of nodes) posts.push({ id: n.id, account: postAccount.get(n.id)!, lift: n.properties?.lift ?? null });

    const edges = await fetchAll<{ src: string; dst: string }>("Loading graph topics", (from, to) =>
      supabase.from("kg_edges").select("src, dst").eq("type", "ABOUT").in("src", ids).range(from, to),
    );
    for (const e of edges) about.push({ post: e.src, topic: e.dst });
  }

  const topicNames: Record<string, string> = {};
  for (const ids of chunks([...new Set(about.map((e) => e.topic))])) {
    const nodes = await fetchAll<{ id: string; name: string }>("Loading graph topic names", (from, to) =>
      supabase.from("kg_nodes").select("id, name").in("id", ids).range(from, to),
    );
    for (const n of nodes) topicNames[n.id] = n.name;
  }

  return computeTopicGaps({ targetIds, rivalIds, accountNames, topicNames, posts, about }, Infinity);
}
