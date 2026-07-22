import { getAnthropicClient, getAnthropicConfig } from "../../lib/anthropic";
import { getSupabaseClient } from "../../lib/supabase";
import type { AccountMetrics, Platform } from "../../lib/types";

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

export async function synthesizeCrossPlatformInsights(
  analysisId: string,
  context: AnalysisContext,
  perPlatformMetrics: { platform: Platform; accounts: AccountMetrics[] }[],
): Promise<void> {
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
}
