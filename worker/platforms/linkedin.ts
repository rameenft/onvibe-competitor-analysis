import { getApifyClient, getApifyConfig } from "../../lib/apify";
import type { MediaType } from "../../lib/types";
import type { PlatformAdapter, PostData, ProfileData, SnapshotData } from "./types";
import { fetchHistoricalSnapshots } from "./socialblade";

/**
 * VERIFY BEFORE FIRST REAL RUN: scrapier/linkedin-company-scraper-actor
 * (profile) and harvestapi/linkedin-company-posts (posts) field names
 * haven't been confirmed against a live run. Check each actor's Input/Output
 * tabs on the Apify Console before running for real.
 *
 * LinkedIn ToS risk: LinkedIn's terms explicitly prohibit scraping. These
 * are no-login/public-page actors, which reduces but does not eliminate
 * that risk. Proceeding at the user's explicit, informed request.
 *
 * Historical growth: Social Blade's publicly documented coverage does not
 * clearly include LinkedIn, so `fetchHistoricalSnapshots` returning null
 * (a data gap, surfaced explicitly in the report) is the expected outcome
 * here, not necessarily a bug — there may simply be no historical source
 * for LinkedIn follower counts yet.
 */

function normalizeMediaType(raw: unknown): MediaType | null {
  const type = String(raw ?? "").toLowerCase();
  if (type.includes("video")) return "video";
  if (type.includes("image") || type.includes("photo")) return "image";
  if (type.includes("document") || type.includes("pdf")) return "document";
  if (type.includes("article")) return "article";
  if (type.includes("text")) return "text";
  return null;
}

export const linkedinAdapter: PlatformAdapter = {
  async fetchProfile(handle: string): Promise<ProfileData> {
    const apify = getApifyClient();
    const { actors } = getApifyConfig();
    const run = await apify.actor(actors.linkedin.profile).call({ companies: [handle] });
    const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1 });
    const profile = (items[0] ?? {}) as Record<string, unknown>;

    return {
      displayName: (profile.name as string) ?? (profile.companyName as string) ?? null,
      followers: Number(profile.followerCount ?? profile.followers ?? 0),
      following: null, // not a meaningful concept for a LinkedIn company page
      bio: (profile.description as string) ?? (profile.about as string) ?? null,
    };
  },

  async fetchPosts(handle: string, sinceDate: Date): Promise<PostData[]> {
    const apify = getApifyClient();
    const { actors } = getApifyConfig();
    const run = await apify.actor(actors.linkedin.posts).call({ companies: [handle] });
    const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1000 });

    const posts: PostData[] = [];
    for (const raw of items as Record<string, unknown>[]) {
      const postedRaw = raw.postedAt ?? raw.publishedAt ?? raw.date;
      const postedAt = new Date(String(postedRaw));
      if (Number.isNaN(postedAt.getTime()) || postedAt < sinceDate) continue;
      const postUrl = String(raw.url ?? raw.postUrl ?? "");
      if (!postUrl) continue;

      posts.push({
        postUrl,
        caption: (raw.text as string) ?? (raw.content as string) ?? null,
        mediaType: normalizeMediaType(raw.type ?? raw.contentType),
        likes: Number(raw.likeCount ?? raw.reactionCount ?? 0),
        comments: Number(raw.commentCount ?? 0),
        shares: raw.shareCount != null ? Number(raw.shareCount) : null,
        postedAt: postedAt.toISOString(),
        coauthorHandle: null, // LinkedIn company posts have no co-author tag equivalent
      });
    }
    return posts;
  },

  fetchHistoricalSnapshots(handle: string, sinceDate: Date): Promise<SnapshotData[] | null> {
    return fetchHistoricalSnapshots("linkedin", handle, sinceDate);
  },
};
