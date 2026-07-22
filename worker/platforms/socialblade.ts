import { getApifyClient, getApifyConfig } from "../../lib/apify";
import type { Platform } from "../../lib/types";
import { aggregateToWeekly, type DailyPoint } from "./util";
import type { SnapshotData } from "./types";

// Confirmed via a live test run against the configured actor
// (amrameng/socialblade-scraper): it supports youtube/tiktok/twitch/
// instagram/facebook only -- no LinkedIn -- so we skip the call entirely
// for LinkedIn rather than sending an invalid `defaultPlatform`.
const SUPPORTED_PLATFORMS: Platform[] = ["instagram", "tiktok"];

const SOCIALBLADE_HISTORY_DAYS_CAP = 31;

/**
 * Historical follower-count history for one account, via an Apify-hosted
 * Social Blade scraper actor, collapsed to one point per week.
 *
 * CONFIRMED LIMITATIONS (from a live test run, not just docs):
 * 1. Social Blade's daily history is capped at 31 days even when requested,
 *    not the full 90-day analysis window -- so cumulative growth can only
 *    ever be historically backfilled for the most recent ~4-5 weeks per run.
 * 2. In practice, the history array came back EMPTY with a
 *    "History failed ... UNAUTHORIZED" warning on a real test account --
 *    Social Blade's historical data appears to require an authenticated
 *    session this actor doesn't have, not just correct input. So today,
 *    fetchHistoricalSnapshots will typically return null (a real, expected
 *    data gap) rather than populated weekly data.
 * 3. Because of (2), the practical path to real growth data is the
 *    `apply_profile` fallback snapshot already written every run
 *    (see worker/pipeline/scrape.ts) -- growth becomes measurable
 *    organically as this tool gets run repeatedly over successive weeks,
 *    same as flagged in the very first conversation about this project.
 */
export async function fetchHistoricalSnapshots(
  platform: Platform,
  handle: string,
  sinceDate: Date,
): Promise<SnapshotData[] | null> {
  if (!SUPPORTED_PLATFORMS.includes(platform)) return null;

  const apify = getApifyClient();
  const { actors } = getApifyConfig();

  const run = await apify.actor(actors.socialblade).call({
    mode: "profiles",
    profiles: [handle],
    defaultPlatform: platform,
    includeHistory: true,
    historyDays: SOCIALBLADE_HISTORY_DAYS_CAP,
    includeGrowth: true,
  });

  const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 5 });
  if (items.length === 0) return null;

  const dailyPoints = extractDailyPoints(items[0] as Record<string, unknown>, sinceDate);
  if (dailyPoints.length === 0) return null;

  return aggregateToWeekly(dailyPoints);
}

// Confirmed real output field: `history` (array, empty when Social Blade
// denies the historical request -- see limitation #2 above). Entry shape
// itself is still a best guess since no populated example has been
// observed live; adjust field names here if/when one is.
function extractDailyPoints(item: Record<string, unknown>, sinceDate: Date): DailyPoint[] {
  const raw = item.history;
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
