import { WORKER_POLL_INTERVAL_MS } from "../lib/config";
import { resetStuckAnalyses, claimNextAnalysis, runAnalysis } from "./core";

// Always-on mode: for local dev (`npm run worker`) or a persistent host.
// Loops forever, polling for new work. For a scheduled runner with no
// persistent process (e.g. GitHub Actions), use run-once.ts instead.
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
