import { getApifyClient, getApifyConfig } from "../../lib/apify";
import type { Platform } from "../../lib/types";
import { aggregateToWeekly, type DailyPoint } from "./util";
import type { SnapshotData } from "./types";

/**
 * Historical follower-count history for one account, via an Apify-hosted
 * Social Blade scraper actor, collapsed to one point per week.
 *
 * VERIFY BEFORE FIRST REAL RUN: the exact input/output shape of the
 * configured actor (APIFY_SOCIALBLADE_ACTOR_ID) hasn't been confirmed
 * against a live run — this is the highest-uncertainty integration flagged
 * in the build plan. Check the actor's Input/Output tabs on the Apify
 * Console and adjust `run input` and `extractDailyPoints` below if the
 * field names differ. Also confirm Social Blade actually tracks LinkedIn —
 * public documentation only clearly confirms YouTube/Twitch/Instagram/
 * Twitter/TikTok/Facebook coverage, so a `null` return for LinkedIn accounts
 * is an expected data gap, not necessarily a bug.
 */
export async function fetchHistoricalSnapshots(
  platform: Platform,
  handle: string,
  sinceDate: Date,
): Promise<SnapshotData[] | null> {
  const apify = getApifyClient();
  const { actors } = getApifyConfig();

  const run = await apify.actor(actors.socialblade).call({
    username: handle,
    platform,
  });

  const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1000 });
  if (items.length === 0) return null;

  const dailyPoints = extractDailyPoints(items[0] as Record<string, unknown>, sinceDate);
  if (dailyPoints.length === 0) return null;

  return aggregateToWeekly(dailyPoints);
}

function extractDailyPoints(item: Record<string, unknown>, sinceDate: Date): DailyPoint[] {
  const candidateKeys = ["dailyHistory", "history", "daily", "followerHistory", "stats"];
  let raw: unknown;
  for (const key of candidateKeys) {
    if (Array.isArray(item[key])) {
      raw = item[key];
      break;
    }
  }
  if (!Array.isArray(raw)) return [];

  const points: DailyPoint[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const dateRaw = e.date ?? e.day ?? e.timestamp;
    const followersRaw = e.followers ?? e.followerCount ?? e.subscribers ?? e.value;
    if (dateRaw == null || followersRaw == null) continue;
    const date = new Date(String(dateRaw));
    const followers = Number(followersRaw);
    if (Number.isNaN(date.getTime()) || Number.isNaN(followers)) continue;
    if (date < sinceDate) continue;
    points.push({ date, followers });
  }
  return points;
}
