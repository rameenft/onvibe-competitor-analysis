import { getApifyClient, getApifyConfig } from "../../lib/apify";
import type { MediaType } from "../../lib/types";
import type { PlatformAdapter, PostData, ProfileData, SnapshotData } from "./types";
import { fetchHistoricalSnapshots } from "./socialblade";

// Field names below are ported directly from the working Python prototype
// (pipeline/scrape.py against apify/instagram-profile-scraper and
// apify/instagram-post-scraper), so this adapter is low-risk relative to
// the TikTok/LinkedIn ones.

function normalizeMediaType(raw: unknown): MediaType | null {
  const type = String(raw ?? "").toLowerCase();
  if (type.includes("carousel") || type === "sidecar") return "carousel";
  if (type.includes("reel") || type === "clips") return "reel";
  if (type.includes("video")) return "video";
  if (type.includes("image") || type === "photo") return "image";
  return null;
}

function firstCoauthor(post: Record<string, unknown>): string | null {
  const coauthors = post.coauthorProducers as { username?: string }[] | undefined;
  return coauthors?.[0]?.username ?? null;
}

function postedAtOf(post: Record<string, unknown>): Date {
  const raw = post.timestamp ?? post.takenAt;
  return new Date(String(raw));
}

export const instagramAdapter: PlatformAdapter = {
  async fetchProfile(handle: string): Promise<ProfileData> {
    const apify = getApifyClient();
    const { actors } = getApifyConfig();
    const run = await apify.actor(actors.instagram.profile).call({ usernames: [handle] });
    const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1 });
    const profile = (items[0] ?? {}) as Record<string, unknown>;

    return {
      displayName: (profile.fullName as string) ?? null,
      followers: Number(profile.followersCount ?? 0),
      following: profile.followsCount != null ? Number(profile.followsCount) : null,
      bio: (profile.biography as string) ?? null,
    };
  },

  async fetchPosts(handle: string, sinceDate: Date): Promise<PostData[]> {
    const apify = getApifyClient();
    const { actors } = getApifyConfig();
    const run = await apify.actor(actors.instagram.posts).call({
      username: [handle],
      onlyPostsNewerThan: sinceDate.toISOString().slice(0, 10),
    });
    const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1000 });

    return (items as Record<string, unknown>[])
      .filter((post) => postedAtOf(post) >= sinceDate)
      .map((post) => ({
        postUrl: String(post.url ?? ""),
        caption: (post.caption as string) ?? null,
        mediaType: normalizeMediaType(post.type),
        likes: Number(post.likesCount ?? 0),
        comments: Number(post.commentsCount ?? 0),
        shares: null, // Instagram scrapers don't expose share counts
        postedAt: postedAtOf(post).toISOString(),
        coauthorHandle: firstCoauthor(post),
      }))
      .filter((post) => post.postUrl);
  },

  fetchHistoricalSnapshots(handle: string, sinceDate: Date): Promise<SnapshotData[] | null> {
    return fetchHistoricalSnapshots("instagram", handle, sinceDate);
  },
};
