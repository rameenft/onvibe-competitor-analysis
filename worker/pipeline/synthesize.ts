import { getAnthropicClient, getAnthropicConfig } from "../../lib/anthropic";
import { getSupabaseClient } from "../../lib/supabase";
import type { AccountMetrics, CustomerReportContent, Platform } from "../../lib/types";

// Replaces the Python prototype's SWOT+recommendations schema with the
// three explicit buckets the user's report structure is built around.
const INSIGHTS_TOOL = {
  name: "produce_insights",
  description:
    "Produce data-grounded observations, candidate explanations, and testable recommendations for a competitive analysis.",
  input_schema: {
    type: "object" as const,
    properties: {
      data_observations: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 6,
        description: "Objective, metric-cited statements — what the data literally shows. No interpretation here.",
      },
      explanations: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 5,
        description:
          "Interpretive hypotheses that might explain the observations. Must read as inference, not fact " +
          "(e.g. 'this may be because...', 'a plausible driver is...').",
      },
      recommendations: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 6,
        description:
          "Framed as experiments to test, not directives — each names the metric it targets and what success " +
          "would look like.",
      },
    },
    required: ["data_observations", "explanations", "recommendations"],
  },
};

const SYSTEM_PROMPT = `You are producing the insights section of a social media competitive analysis. Structure your \
output into exactly three buckets, and do not blend them:

1. data_observations: what the data literally shows. Every point must cite a specific metric, percentile, or \
named competitor comparison from the data provided — never generic commentary. If a metric is unavailable (e.g. \
a growth data gap), say so explicitly rather than guessing or omitting the topic. Never state a raw engagement \
rate as a sign of strong performance if the data includes a low-sample warning for that account — cite the \
warning instead.

2. explanations: your best-guess reasoning for WHY the observations might be true. These are hypotheses, not \
facts — phrase them accordingly ("this may be because...", "a plausible driver is..."). Ground each in the \
observations above; do not introduce new unsupported claims.

3. recommendations: concrete experiments to run, each naming the metric it targets and what a successful \
outcome would look like. Frame as tests, not commands.

Keep each bullet to one or two sentences.`;

interface AnalysisContext {
  companyName: string;
  industry: string;
  region: string;
}

interface Insights {
  data_observations: string[];
  explanations: string[];
  recommendations: string[];
}

async function callSynthesisTool(prompt: string): Promise<Insights> {
  const anthropic = getAnthropicClient();
  const { model } = getAnthropicConfig();

  const message = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [INSIGHTS_TOOL],
    tool_choice: { type: "tool", name: "produce_insights" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { data_observations: [], explanations: [], recommendations: [] };
  }
  return toolUse.input as Insights;
}

export async function synthesizePlatformInsights(
  analysisId: string,
  platform: Platform,
  context: AnalysisContext,
  metrics: { platform: Platform; accounts: AccountMetrics[] },
): Promise<void> {
  const prompt =
    `Company: ${context.companyName}\nIndustry: ${context.industry}\nRegion: ${context.region}\n` +
    `Platform: ${platform}\n\nMetrics (target + up to 3 competitors, current window):\n` +
    JSON.stringify(metrics, null, 2);

  const insights = await callSynthesisTool(prompt);

  const supabase = getSupabaseClient();
  await supabase.from("analysis_insights").upsert(
    [
      {
        analysis_id: analysisId,
        platform,
        metrics,
        data_observations: insights.data_observations,
        explanations: insights.explanations,
        recommendations: insights.recommendations,
      },
    ],
    { onConflict: "analysis_id,platform" },
  );
}

const PLAN_PHASE_SCHEMA = {
  type: "object" as const,
  properties: {
    actions: { type: "array", items: { type: "string" } },
    successMetrics: { type: "array", items: { type: "string" } },
  },
  required: ["actions", "successMetrics"],
};

// A distinct synthesis pass for the customer-facing report's specific
// structure — this doesn't map 1:1 from the detailed report's three-bucket
// data_observations/explanations/recommendations framework, so it gets its
// own tool schema rather than being sliced out of that one.
const CUSTOMER_REPORT_TOOL = {
  name: "produce_customer_report",
  description: "Produce the condensed customer-facing summary of a competitive analysis.",
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
    required: ["key_findings", "working_content_patterns", "competitive_gaps", "experiments", "plan"],
  },
};

const CUSTOMER_SYSTEM_PROMPT = `You are writing the customer-facing summary of a social media competitive \
analysis. The reader is a business owner, not an analyst — simplify the structure considerably and drop \
methodology, percentiles, and raw metric tables entirely. Still ground every point in the underlying data you're \
given (don't invent findings), but state it in plain business language.

Produce exactly five things:
1. key_findings: the three most important things learned — the headline takeaways, not a full list.
2. working_content_patterns: content patterns that appear to work in this category, based on what the top \
performers in the data are doing.
3. competitive_gaps: the target's most important competitive gaps versus the competitor set.
4. experiments: 3-5 concrete experiments to run next, each specific enough to act on immediately.
5. plan: a 30/60/90-day plan. Each phase needs concrete actions AND measurable success metrics (a specific \
number or rate to hit, not "improve engagement"). Day 30 should be quick, low-risk tests; day 60 should build on \
what worked; day 90 should be a clear checkpoint on whether the strategy is working.

Keep every bullet short — one sentence each.`;

async function callCustomerReportTool(prompt: string): Promise<CustomerReportContent> {
  const anthropic = getAnthropicClient();
  const { model } = getAnthropicConfig();

  const message = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: CUSTOMER_SYSTEM_PROMPT,
    tools: [CUSTOMER_REPORT_TOOL],
    tool_choice: { type: "tool", name: "produce_customer_report" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return {
      key_findings: [],
      working_content_patterns: [],
      competitive_gaps: [],
      experiments: [],
      plan: { day30: { actions: [], successMetrics: [] }, day60: { actions: [], successMetrics: [] }, day90: { actions: [], successMetrics: [] } },
    };
  }
  return toolUse.input as CustomerReportContent;
}

export async function synthesizeCustomerReport(
  analysisId: string,
  context: AnalysisContext,
  perPlatformMetrics: { platform: Platform; accounts: AccountMetrics[] }[],
  crossPlatformInsights: Insights,
): Promise<void> {
  const prompt =
    `Company: ${context.companyName}\nIndustry: ${context.industry}\nRegion: ${context.region}\n\n` +
    `Full metrics across all analyzed platforms:\n${JSON.stringify(perPlatformMetrics, null, 2)}\n\n` +
    `Detailed-report findings already produced for this analysis (use these as grounding, don't contradict them):\n` +
    JSON.stringify(crossPlatformInsights, null, 2);

  const content = await callCustomerReportTool(prompt);

  const supabase = getSupabaseClient();
  await supabase.from("analysis_reports").upsert(
    [{ analysis_id: analysisId, report_type: "customer" as const, content }],
    { onConflict: "analysis_id,report_type" },
  );
}

export async function synthesizeCrossPlatformInsights(
  analysisId: string,
  context: AnalysisContext,
  perPlatformMetrics: { platform: Platform; accounts: AccountMetrics[] }[],
): Promise<Insights> {
  const prompt =
    `Company: ${context.companyName}\nIndustry: ${context.industry}\nRegion: ${context.region}\n\n` +
    `Metrics across all analyzed platforms (target + up to 3 competitors per platform):\n` +
    JSON.stringify(perPlatformMetrics, null, 2) +
    `\n\nSynthesize across platforms — where does the picture agree or diverge between platforms? Call that out ` +
    `explicitly rather than just repeating each platform's findings separately.`;

  const insights = await callSynthesisTool(prompt);

  const supabase = getSupabaseClient();
  await supabase.from("analysis_insights").upsert(
    [
      {
        analysis_id: analysisId,
        platform: "all",
        metrics: { platforms: perPlatformMetrics.map((m) => m.platform) },
        data_observations: insights.data_observations,
        explanations: insights.explanations,
        recommendations: insights.recommendations,
      },
    ],
    { onConflict: "analysis_id,platform" },
  );

  return insights;
}
