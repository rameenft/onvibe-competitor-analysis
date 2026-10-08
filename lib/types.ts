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
// The one report is stored under "customer" (the DB check constraint also allows the retired "detailed").
export type ReportType = "customer";

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
  updated_at: string;
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
  views: number | null;
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
  platform: Platform;
  metrics: PlatformMetrics;
  data_observations: string[];
  explanations: string[];
  recommendations: string[];
  created_at: string;
}

export interface PlanPhase {
  actions: string[];
  successMetrics: string[];
}

// Shape of analysis_reports.content -- the summary half of the report, written by
// worker/pipeline/synthesize.ts. The per-platform observations live in analysis_insights.
export interface ReportContent {
  key_findings: string[];
  working_content_patterns: string[];
  competitive_gaps: string[];
  experiments: string[];
  plan: { day30: PlanPhase; day60: PlanPhase; day90: PlanPhase };
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
  postCount: number;
  avgLikes: number;
  avgComments: number;
  avgShares: number | null;
  // Platform-specific niche metric -- null when the platform doesn't
  // expose it (LinkedIn). See worker/platforms/types.ts for why.
  avgViews: number | null;
  engagementRate: number;
  postsPerWeek: number;
  engagementRatePercentile: number;
  followersPercentile: number;
  avgLikesPercentile: number;
  avgViewsPercentile: number | null;
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
