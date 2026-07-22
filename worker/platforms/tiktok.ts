import { getApifyClient, getApifyConfig } from "../../lib/apify";
import type { MediaType } from "../../lib/types";
import type { PlatformAdapter, PostData, ProfileData, SnapshotData } from "./types";
import { fetchHistoricalSnapshots } from "./socialblade";

/**
 * VERIFY BEFORE FIRST REAL RUN: clockworks/tiktok-profile-scraper and
 * clockworks/tiktok-scraper's exact input/output field names haven't been
 * confirmed against a live run — flagged as an open risk in the build plan.
 * Check the actor's Input/Output tabs on the Apify Console and adjust the
 * input shapes and field names below if they differ. The field names here
 * (authorMeta.fans/nickName, diggCount, commentCount, webVideoUrl, etc.) are
 * the commonly-documented shape for clockworks' TikTok actors, not a
 * confirmed-live mapping.
 */

function postedAtOf(post: Record<string, unknown>): Date | null {
  const createTime = post.createTime ?? post.createTimeISO;
  const date = typeof createTime === "number" ? new Date(createTime * 1000) : new Date(String(createTime));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const tiktokAdapter: PlatformAdapter = {
  async fetchProfile(handle: string): Promise<ProfileData> {
    const apify = getApifyClient();
    const { actors } = getApifyConfig();
    const run = await apify.actor(actors.tiktok.profile).call({ profiles: [handle] });
    const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1 });
    const raw = (items[0] ?? {}) as Record<string, unknown>;
    const meta = (raw.authorMeta ?? raw) as Record<string, unknown>;

    return {
      displayName: (meta.nickName as string) ?? (meta.name as string) ?? null,
      followers: Number(meta.fans ?? meta.followerCount ?? 0),
      following: meta.following != null ? Number(meta.following) : null,
      bio: (meta.signature as string) ?? null,
    };
  },

  async fetchPosts(handle: string, sinceDate: Date): Promise<PostData[]> {
    const apify = getApifyClient();
    const { actors } = getApifyConfig();
    const run = await apify.actor(actors.tiktok.posts).call({
      profiles: [handle],
      resultsPerPage: 100,
    });
    const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1000 });

    const posts: PostData[] = [];
    for (const raw of items as Record<string, unknown>[]) {
      const postedAt = postedAtOf(raw);
      if (!postedAt || postedAt < sinceDate) continue;
      const postUrl = String(raw.webVideoUrl ?? raw.url ?? "");
      if (!postUrl) continue;

      posts.push({
        postUrl,
        caption: (raw.text as string) ?? null,
        mediaType: "video" as MediaType, // TikTok content is video-only
        likes: Number(raw.diggCount ?? 0),
        comments: Number(raw.commentCount ?? 0),
        shares: raw.shareCount != null ? Number(raw.shareCount) : null,
        postedAt: postedAt.toISOString(),
        coauthorHandle: null, // no TikTok equivalent to Instagram's native co-author tag
      });
    }
    return posts;
  },

  fetchHistoricalSnapshots(handle: string, sinceDate: Date): Promise<SnapshotData[] | null> {
    return fetchHistoricalSnapshots("tiktok", handle, sinceDate);
  },
};
