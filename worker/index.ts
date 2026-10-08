import { WORKER_POLL_INTERVAL_MS } from "../lib/config";
import { resetStuckAnalyses, claimNextAnalysis, runAnalysis } from "./core";

// Always-on worker (`npm run worker`): loops forever, polling Supabase for
// pending analyses and running each one to completion.
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
