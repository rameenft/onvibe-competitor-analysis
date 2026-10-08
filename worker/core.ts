import { assertOk, getSupabaseClient } from "../lib/supabase";
import { scrapeAllAccounts } from "./pipeline/scrape";
import { classifyAll } from "./pipeline/classify";
import { computePlatformMetrics } from "./pipeline/metrics";
import {
  synthesizePlatformInsights,
  synthesizeCrossPlatformInsights,
  synthesizeCustomerReport,
} from "./pipeline/synthesize";
import { renderReports } from "./pipeline/render";
import type { Account, Analysis, Platform } from "../lib/types";

const STUCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const NON_TERMINAL_STATUSES = ["scraping", "categorizing", "computing", "synthesizing", "rendering"];

// Crash recovery, kept intentionally cheap: anything stuck in a
// non-terminal status past the timeout gets marked failed for a manual
// retry, rather than building full step-checkpointing. Idempotent
// upserts (posts, snapshots, post_categories) already make a retried run
// safe to re-run from scratch.
//
// Checks updated_at (last activity), not created_at (time of creation) --
// a healthy run that's simply taking a while ages the same way by
// created_at as one that's genuinely stuck, so this must only flag rows
// with no *recent* progress, not just rows that happen to be old.
export async function resetStuckAnalyses(): Promise<void> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MS).toISOString();
  assertOk(
    await supabase
      .from("analyses")
      .update({
        status: "failed",
        status_detail: "Worker restarted mid-run past the stuck-job timeout; retry manually.",
      })
      .in("status", NON_TERMINAL_STATUSES)
      .lt("updated_at", cutoff),
    "Resetting stuck analyses",
  );
}

export async function claimNextAnalysis(): Promise<Analysis | null> {
  const supabase = getSupabaseClient();
  const { data: candidates } = await supabase
    .from("analyses")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  const candidate = candidates?.[0];
  if (!candidate) return null;

  // Conditional update (still filtered on status='pending') is what stops
  // two runs from double-claiming the same row.
  const { data: claimed } = await supabase
    .from("analyses")
    .update({ status: "scraping", status_detail: "Starting scrape..." })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  return (claimed as Analysis | null) ?? null;
}

async function updateStatus(analysisId: string, status: string, detail: string): Promise<void> {
  const supabase = getSupabaseClient();
  assertOk(
    await supabase.from("analyses").update({ status, status_detail: detail }).eq("id", analysisId),
    `Updating status to ${status}`,
  );
}

export async function runAnalysis(analysis: Analysis): Promise<void> {
  const supabase = getSupabaseClient();
  try {
    const { data: accounts } = assertOk(
      await supabase.from("accounts").select("*").eq("analysis_id", analysis.id),
      "Loading accounts",
    );
    const accountList = (accounts ?? []) as Account[];
    const platforms = analysis.platforms as Platform[];
    const context = {
      companyName: analysis.company_name,
      industry: analysis.industry,
      region: analysis.region,
    };

    await updateStatus(analysis.id, "scraping", "Scraping profiles, posts, and historical growth...");
    await scrapeAllAccounts(accountList, analysis.window_days);

    await updateStatus(analysis.id, "categorizing", "Classifying post content with Gemini...");
    await classifyAll(accountList.map((a) => a.id));

    await updateStatus(analysis.id, "computing", "Computing metrics...");
    const perPlatformMetrics = await Promise.all(
      platforms.map((platform) => computePlatformMetrics(accountList, platform, analysis.window_days)),
    );

    await updateStatus(analysis.id, "synthesizing", "Synthesizing insights with Gemini...");
    for (const metrics of perPlatformMetrics) {
      await synthesizePlatformInsights(analysis.id, metrics.platform, context, metrics);
    }
    // Always write an 'all' rollup row, even for a single-platform analysis,
    // so report pages can rely on it existing rather than branching on
    // platform count.
    const crossPlatformInsights = await synthesizeCrossPlatformInsights(analysis.id, context, perPlatformMetrics);
    await synthesizeCustomerReport(analysis.id, context, perPlatformMetrics, crossPlatformInsights);

    await updateStatus(analysis.id, "rendering", "Rendering reports...");
    await renderReports(analysis.id);

    assertOk(
      await supabase
        .from("analyses")
        .update({ status: "done", status_detail: "Complete.", completed_at: new Date().toISOString() })
        .eq("id", analysis.id),
      "Marking analysis done",
    );
  } catch (error) {
    console.error(`Analysis ${analysis.id} failed:`, error);
    const { error: markError } = await supabase
      .from("analyses")
      .update({
        status: "failed",
        status_detail: error instanceof Error ? error.message : "Unknown error",
      })
      .eq("id", analysis.id);
    if (markError) console.error(`Could not mark analysis ${analysis.id} failed:`, markError.message);
  }
}
