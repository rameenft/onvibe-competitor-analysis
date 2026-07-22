import type { Platform } from "../../lib/types";
import { instagramAdapter } from "./instagram";
import { tiktokAdapter } from "./tiktok";
import { linkedinAdapter } from "./linkedin";
import type { PlatformAdapter } from "./types";

const adapters: Record<Platform, PlatformAdapter> = {
  instagram: instagramAdapter,
  tiktok: tiktokAdapter,
  linkedin: linkedinAdapter,
};

export function getPlatformAdapter(platform: Platform): PlatformAdapter {
  return adapters[platform];
}

export type { PlatformAdapter, ProfileData, PostData, SnapshotData } from "./types";
