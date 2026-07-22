export type Platform = "instagram" | "tiktok" | "linkedin";
export type AccountRole = "target" | "competitor";
export type AnalysisStatus =
  | "pending"
  | "scraping"
  | "categorizing"
  | "computing"
  | "synthesizing"
  | "rendering"
  | "done"
  | "failed";
export type PostCategory =
  | "collaboration"
  | "campaign"
  | "paid_promotion"
  | "product"
  | "testimonial"
  | "educational"
  | "other";
export type MediaType = "image" | "video" | "reel" | "carousel" | "article" | "document" | "text";
export type ReportType = "detailed" | "customer";
export type SnapshotSource = "socialblade" | "apify_profile";

export interface Analysis {
  id: string;
  company_name: string;
  industry: string;
  region: string;
  platforms: Platform[];
  window_days: number;
  status: AnalysisStatus;
  status_detail: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Account {
  id: string;
  analysis_id: string;
  platform: Platform;
  handle: string;
  role: AccountRole;
  display_name: string | null;
  followers: number | null;
  following: number | null;
  bio: string | null;
  scraped_at: string | null;
}

export interface AccountSnapshot {
  id: string;
  account_id: string;
  week_start: string;
  followers: number;
  source: SnapshotSource;
}

export interface Post {
  id: string;
  account_id: string;
  platform: Platform;
  post_url: string;
  caption: string | null;
  media_type: MediaType | null;
  likes: number;
  comments: number;
  shares: number | null;
  posted_at: string;
  coauthor_handle: string | null;
  scraped_at: string;
}

export interface PostCategoryRow {
  id: string;
  post_id: string;
  category: PostCategory;
  confidence: number | null;
  rationale: string | null;
}

export interface AnalysisInsights {
  id: string;
  analysis_id: string;
  platform: Platform | "all";
  metrics: PlatformMetrics | CrossPlatformMetrics;
  data_observations: string[];
  explanations: string[];
  recommendations: string[];
  created_at: string;
}

export interface AnalysisReport {
  id: string;
  analysis_id: string;
  report_type: ReportType;
  pdf_url: string | null;
  content: unknown;
  created_at: string;
}

// Computed, not stored directly as a table row — shape of worker/pipeline/metrics.ts output.
export interface AccountMetrics {
  accountId: string;
  handle: string;
  role: AccountRole;
  platform: Platform;
  followers: number;
  weeklyGrowth: { weekStart: string; followers: number; growthPct: number | null }[];
  cumulativeGrowthPct: number | null;
  growthDataGap: string | null; // set when snapshot history is missing/insufficient
  postCount: number;
  avgLikes: number;
  avgComments: number;
  avgShares: number | null;
  engagementRate: number;
  postsPerWeek: number;
  engagementRatePercentile: number;
  followersPercentile: number;
  avgLikesPercentile: number;
  lowSampleWarning: string | null; // sense-making guard: set when reach is too small to trust the rate
  mediaTypeBreakdown: Record<string, { postCount: number; avgEngagement: number }>;
  baselineEngagement: number;
  categoryBreakdown: Record<string, { postCount: number; avgEngagement: number; vsBaselineMultiplier: number | null }>;
  collaborationCadence: { postCount: number; avgEngagement: number; vsBaselineMultiplier: number | null };
}

export interface PlatformMetrics {
  platform: Platform;
  accounts: AccountMetrics[];
}

export interface CrossPlatformMetrics {
  platforms: Platform[];
  perPlatform: Record<Platform, AccountMetrics[]>;
}
