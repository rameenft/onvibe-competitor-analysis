import { getSupabaseClient } from "../../lib/supabase";
import { weekStartISO } from "../platforms/util";
import type { Account, AccountMetrics, Platform } from "../../lib/types";

// Sense-making guard: an account can post a high engagement *rate* on a
// trivially small absolute audience/interaction count. Flag that explicitly
// rather than letting the rate alone imply the account is thriving.
const LOW_FOLLOWER_THRESHOLD = 1000;
const LOW_INTERACTION_THRESHOLD = 10;

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function percentileRank(value: number, all: number[]): number {
  if (all.length === 0) return 0;
  const belowOrEqual = all.filter((v) => v <= value).length;
  return Math.round((100 * belowOrEqual) / all.length);
}

async function computeGrowth(accountId: string, windowDays: number) {
  const supabase = getSupabaseClient();
  const sinceWeek = weekStartISO(new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000));
  const { data: snapshots } = await supabase
    .from("account_snapshots")
    .select("week_start, followers")
    .eq("account_id", accountId)
    .gte("week_start", sinceWeek)
    .order("week_start", { ascending: true });

  const rows = snapshots ?? [];
  const weeklyGrowth = rows.map((row, i) => {
    const prev = rows[i - 1];
    const growthPct =
      prev && prev.followers > 0 ? round(((row.followers - prev.followers) / prev.followers) * 100) : null;
    return { weekStart: row.week_start, followers: row.followers, growthPct };
  });

  let cumulativeGrowthPct: number | null = null;
  let growthDataGap: string | null = null;
  if (rows.length >= 2) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    cumulativeGrowthPct =
      first.followers > 0 ? round(((last.followers - first.followers) / first.followers) * 100) : null;
  } else {
    growthDataGap =
      "Fewer than two weekly snapshots are available for this account in the window — growth requires at least " +
      "two data points and is a data gap here, not a zero.";
  }

  return { weeklyGrowth, cumulativeGrowthPct, growthDataGap };
}

interface PostRow {
  id: string;
  likes: number;
  comments: number;
  shares: number | null;
  media_type: string | null;
  post_categories: { category: string } | { category: string }[] | null;
}

async function fetchPosts(accountId: string): Promise<PostRow[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("posts")
    .select("id, likes, comments, shares, media_type, post_categories(category)")
    .eq("account_id", accountId);
  return (data ?? []) as unknown as PostRow[];
}

function categoryOf(row: PostRow): string | null {
  const cat = row.post_categories;
  if (!cat) return null;
  return Array.isArray(cat) ? (cat[0]?.category ?? null) : cat.category;
}

function computeMediaTypeBreakdown(posts: PostRow[]): Record<string, { postCount: number; avgEngagement: number }> {
  const byType = new Map<string, number[]>();
  for (const post of posts) {
    const type = post.media_type ?? "unknown";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(post.likes + post.comments);
  }
  const result: Record<string, { postCount: number; avgEngagement: number }> = {};
  for (const [type, values] of byType) {
    result[type] = { postCount: values.length, avgEngagement: round(average(values)) };
  }
  return result;
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function computeCollaborationCadence(posts: PostRow[]) {
  const baseline = average(posts.map((p) => p.likes + p.comments));
  const collabPosts = posts.filter((p) => {
    const cat = categoryOf(p);
    return cat === "collaboration" || cat === "paid_promotion";
  });
  const collabAvg = average(collabPosts.map((p) => p.likes + p.comments));

  return {
    postCount: collabPosts.length,
    avgEngagement: round(collabAvg),
    vsBaselineMultiplier: baseline > 0 && collabPosts.length > 0 ? round(collabAvg / baseline) : null,
  };
}

export async function computeAccountMetrics(account: Account, windowDays: number): Promise<AccountMetrics> {
  const posts = await fetchPosts(account.id);
  const { weeklyGrowth, cumulativeGrowthPct, growthDataGap } = await computeGrowth(account.id, windowDays);

  const followers = account.followers ?? 0;
  const postCount = posts.length;
  const avgLikes = average(posts.map((p) => p.likes));
  const avgComments = average(posts.map((p) => p.comments));
  const sharesValues = posts.map((p) => p.shares).filter((s): s is number => s != null);
  const avgShares = sharesValues.length ? average(sharesValues) : null;

  const engagementRate = followers > 0 ? (avgLikes + avgComments + (avgShares ?? 0)) / followers : 0;
  const postsPerWeek = postCount / (windowDays / 7);

  const totalAvgInteractions = avgLikes + avgComments;
  const lowSampleWarning =
    followers < LOW_FOLLOWER_THRESHOLD || totalAvgInteractions < LOW_INTERACTION_THRESHOLD
      ? `Reach is small (${followers.toLocaleString()} followers, ~${round(totalAvgInteractions, 1)} avg ` +
        `interactions/post) — treat the engagement rate as low-sample and directionally indicative, not a sign ` +
        `of outsized performance.`
      : null;

  return {
    accountId: account.id,
    handle: account.handle,
    role: account.role,
    platform: account.platform,
    followers,
    weeklyGrowth,
    cumulativeGrowthPct,
    growthDataGap,
    postCount,
    avgLikes: round(avgLikes),
    avgComments: round(avgComments),
    avgShares: avgShares != null ? round(avgShares) : null,
    engagementRate: round(engagementRate, 4),
    postsPerWeek: round(postsPerWeek),
    engagementRatePercentile: 0, // filled in by attachPercentiles
    followersPercentile: 0,
    avgLikesPercentile: 0,
    lowSampleWarning,
    mediaTypeBreakdown: computeMediaTypeBreakdown(posts),
    collaborationCadence: computeCollaborationCadence(posts),
  };
}

// Percentiles are computed within one platform's target+competitor set —
// the same relative-context approach as the Python prototype's
// attach_percentiles, just applied per platform now instead of globally.
function attachPercentiles(accounts: AccountMetrics[]): AccountMetrics[] {
  const engagementRates = accounts.map((a) => a.engagementRate);
  const followerCounts = accounts.map((a) => a.followers);
  const avgLikesValues = accounts.map((a) => a.avgLikes);

  return accounts.map((a) => ({
    ...a,
    engagementRatePercentile: percentileRank(a.engagementRate, engagementRates),
    followersPercentile: percentileRank(a.followers, followerCounts),
    avgLikesPercentile: percentileRank(a.avgLikes, avgLikesValues),
  }));
}

export async function computePlatformMetrics(accounts: Account[], platform: Platform, windowDays: number) {
  const platformAccounts = accounts.filter((a) => a.platform === platform);
  const metrics = await Promise.all(platformAccounts.map((a) => computeAccountMetrics(a, windowDays)));
  return { platform, accounts: attachPercentiles(metrics) };
}
