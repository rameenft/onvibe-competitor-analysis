import { generateStructured } from "../../lib/gemini";
import { assertOk, getSupabaseClient } from "../../lib/supabase";
import type { AccountMetrics, Platform, ReportContent } from "../../lib/types";

const PLAN_PHASE_SCHEMA = {
  type: "object" as const,
  properties: {
    actions: { type: "array", items: { type: "string" } },
    successMetrics: { type: "array", items: { type: "string" } },
  },
  required: ["actions", "successMetrics"],
};

// The single synthesis pass behind the report. platform_observations is the
// metric-cited detail for each platform's section; the rest is the summary,
// patterns, gaps, experiments and plan.
const REPORT_TOOL = {
  name: "produce_report",
  description: "Produce the written content of a social media competitive analysis report.",
  input_schema: {
    type: "object" as const,
    properties: {
      key_findings: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
        description: "The three most important things learned from this analysis.",
      },
      platform_observations: {
        type: "array",
        description: "One entry per analyzed platform, each with the metric-cited observations for that platform.",
        items: {
          type: "object",
          properties: {
            platform: { type: "string", enum: ["instagram", "tiktok", "linkedin"] },
            observations: {
              type: "array",
              items: { type: "string" },
              minItems: 3,
              maxItems: 5,
              description: "What the data literally shows for this platform. Each cites a specific metric, percentile, or named competitor comparison.",
            },
          },
          required: ["platform", "observations"],
        },
      },
      working_content_patterns: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 5,
        description: "Content patterns that appear to be working in this category.",
      },
      competitive_gaps: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 5,
        description: "The target's most important competitive gaps.",
      },
      experiments: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
        description: "Concrete experiments to run next.",
      },
      plan: {
        type: "object",
        properties: { day30: PLAN_PHASE_SCHEMA, day60: PLAN_PHASE_SCHEMA, day90: PLAN_PHASE_SCHEMA },
        required: ["day30", "day60", "day90"],
      },
    },
    required: [
      "key_findings",
      "platform_observations",
      "working_content_patterns",
      "competitive_gaps",
      "experiments",
      "plan",
    ],
  },
};

const SYSTEM_PROMPT = `You are writing a social media competitive analysis for a business owner. Be specific and \
plain-spoken: ground every point in the data you're given (never invent findings), and keep every bullet to one or \
two sentences.

Produce exactly these parts:
1. key_findings: the three most important things learned — the headline takeaways, not a full list.
2. platform_observations: for each analyzed platform, what the data literally shows. Every point must cite a \
specific metric, percentile, or named competitor comparison — never generic commentary. Never present a raw \
engagement rate as a sign of strong performance if the data includes a low-sample warning for that account — cite \
the warning instead. Where avgViews is present (TikTok, and Instagram video/Reel content), treat it as a reach \
signal distinct from engagement rate — a post can be widely viewed without proportional likes/comments, and that \
gap is worth calling out. For LinkedIn, do not reference "impressions" — that metric is private to each page's own \
admin and isn't in this data; the closest available signal is shares (LinkedIn's own "reposts"). Do not discuss \
follower growth: only current follower counts are available.
3. working_content_patterns: content patterns that appear to work in this category, based on what the top \
performers in the data are doing.
4. competitive_gaps: the target's most important competitive gaps versus the competitor set.
5. experiments: 3-5 concrete experiments to run next, each specific enough to act on immediately.
6. plan: a 30/60/90-day plan. Each phase needs concrete actions AND measurable success metrics (a specific number \
or rate to hit, not "improve engagement"). Day 30 should be quick, low-risk tests; day 60 should build on what \
worked; day 90 should be a clear checkpoint on whether the strategy is working.`;

interface AnalysisContext {
  companyName: string;
  industry: string;
  region: string;
}

type SynthesisOutput = ReportContent & {
  platform_observations: { platform: Platform; observations: string[] }[];
};

// One Gemini call for the whole report. Per-platform metrics go into
// analysis_insights (the evals read them from there) with that platform's
// observations; everything else is saved as the report content.
export async function synthesizeReport(
  analysisId: string,
  context: AnalysisContext,
  perPlatformMetrics: { platform: Platform; accounts: AccountMetrics[] }[],
): Promise<void> {
  const prompt =
    `Company: ${context.companyName}\nIndustry: ${context.industry}\nRegion: ${context.region}\n\n` +
    `Metrics across all analyzed platforms (target + up to 3 competitors per platform, current window):\n` +
    JSON.stringify(perPlatformMetrics, null, 2);

  const { platform_observations, ...content } = await generateStructured<SynthesisOutput>(
    SYSTEM_PROMPT,
    REPORT_TOOL.input_schema,
    prompt,
    REPORT_TOOL.name,
  );

  const supabase = getSupabaseClient();
  assertOk(
    await supabase.from("analysis_insights").upsert(
      perPlatformMetrics.map((metrics) => ({
        analysis_id: analysisId,
        platform: metrics.platform,
        metrics,
        data_observations: platform_observations.find((p) => p.platform === metrics.platform)?.observations ?? [],
        explanations: [],
        recommendations: [],
      })),
      { onConflict: "analysis_id,platform" },
    ),
    "Saving platform metrics and observations",
  );
  assertOk(
    await supabase.from("analysis_reports").upsert(
      [{ analysis_id: analysisId, report_type: "customer" as const, content }],
      { onConflict: "analysis_id,report_type" },
    ),
    "Saving report",
  );
}
