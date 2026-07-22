import { getSupabaseClient } from "../lib/supabase";
import { WORKER_POLL_INTERVAL_MS } from "../lib/config";
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

// Crash recovery, kept intentionally cheap: on startup, anything stuck in a
// non-terminal status past the timeout gets marked failed for a manual
// retry, rather than building full step-checkpointing. Idempotent
// upserts (posts, snapshots, post_categories) already make a retried run
// safe to re-run from scratch.
async function resetStuckAnalyses(): Promise<void> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MS).toISOString();
  await supabase
    .from("analyses")
    .update({
      status: "failed",
      status_detail: "Worker restarted mid-run past the stuck-job timeout; retry manually.",
    })
    .in("status", NON_TERMINAL_STATUSES)
    .lt("created_at", cutoff);
}

async function claimNextAnalysis(): Promise<Analysis | null> {
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
  // two worker instances from double-claiming the same row.
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
  await supabase.from("analyses").update({ status, status_detail: detail }).eq("id", analysisId);
}

async function runAnalysis(analysis: Analysis): Promise<void> {
  const supabase = getSupabaseClient();
  try {
    const { data: accounts } = await supabase.from("accounts").select("*").eq("analysis_id", analysis.id);
    const accountList = (accounts ?? []) as Account[];
    const platforms = analysis.platforms as Platform[];
    const context = {
      companyName: analysis.company_name,
      industry: analysis.industry,
      region: analysis.region,
    };

    await updateStatus(analysis.id, "scraping", "Scraping profiles, posts, and historical growth...");
    await scrapeAllAccounts(accountList, analysis.window_days);

    await updateStatus(analysis.id, "categorizing", "Classifying post content with Claude...");
    await classifyAll(accountList.map((a) => a.id));

    await updateStatus(analysis.id, "computing", "Computing metrics...");
    const perPlatformMetrics = await Promise.all(
      platforms.map((platform) => computePlatformMetrics(accountList, platform, analysis.window_days)),
    );

    await updateStatus(analysis.id, "synthesizing", "Synthesizing insights with Claude...");
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

    await supabase
      .from("analyses")
      .update({ status: "done", status_detail: "Complete.", completed_at: new Date().toISOString() })
      .eq("id", analysis.id);
  } catch (error) {
    console.error(`Analysis ${analysis.id} failed:`, error);
    await supabase
      .from("analyses")
      .update({
        status: "failed",
        status_detail: error instanceof Error ? error.message : "Unknown error",
      })
      .eq("id", analysis.id);
  }
}

async function pollLoop(): Promise<void> {
  await resetStuckAnalyses();
  console.log("Worker started, polling for pending analyses...");

  for (;;) {
    const analysis = await claimNextAnalysis();
    if (analysis) {
      console.log(`Claimed analysis ${analysis.id} (${analysis.company_name})`);
      await runAnalysis(analysis);
    } else {
      await new Promise((resolve) => setTimeout(resolve, WORKER_POLL_INTERVAL_MS));
    }
  }
}

pollLoop().catch((error) => {
  console.error("Worker crashed:", error);
  process.exit(1);
});
