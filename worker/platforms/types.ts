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
  postedAt: string; // ISO timestamp
  coauthorHandle: string | null;
}

export interface SnapshotData {
  weekStart: string; // YYYY-MM-DD, Monday of the week
  followers: number;
}

export interface PlatformAdapter {
  fetchProfile(handle: string): Promise<ProfileData>;
  fetchPosts(handle: string, sinceDate: Date): Promise<PostData[]>;
  // Returns null (not an empty array) when no historical data exists at all
  // for this account — a real data gap to surface explicitly, not a silent
  // zero-growth result.
  fetchHistoricalSnapshots(handle: string, sinceDate: Date): Promise<SnapshotData[] | null>;
}
