import type { MediaType } from "../../lib/types";

export interface ProfileData {
  displayName: string | null;
  followers: number;
  following: number | null;
  bio: string | null;
}

export interface PostData {
  postUrl: string;
  caption: string | null;
  mediaType: MediaType | null;
  likes: number;
  comments: number;
  shares: number | null;
  // Platform-specific niche metric -- null where a platform doesn't expose
  // it publicly, not just "unset". TikTok always has this (arguably its
  // single most important metric, since it's a video-discovery platform);
  // Instagram exposes it for Reels/videos only. LinkedIn "impressions" are
  // deliberately NOT modeled here -- that's a private, admin-only metric,
  // not obtainable for a competitor's page via public scraping. LinkedIn's
  // repost count (what LinkedIn itself calls "reposts", formerly "shares")
  // is already carried by the `shares` field above -- not a separate metric.
  views: number | null;
  postedAt: string; // ISO timestamp
  coauthorHandle: string | null;
}

export interface PlatformAdapter {
  fetchProfile(handle: string): Promise<ProfileData>;
  fetchPosts(handle: string, sinceDate: Date): Promise<PostData[]>;
}
