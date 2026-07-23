import { resetStuckAnalyses, claimNextAnalysis, runAnalysis } from "./core";

// Single claim-and-run cycle: for a scheduled runner with no persistent
// process (GitHub Actions). Checks once for a pending analysis, runs it to
// completion if found, then exits. Scheduling ("run this every N minutes")
// is handled by the runner, not by this script.
async function main(): Promise<void> {
  await resetStuckAnalyses();

  const analysis = await claimNextAnalysis();
  if (!analysis) {
    console.log("No pending analyses.");
    return;
  }

  console.log(`Claimed analysis ${analysis.id} (${analysis.company_name})`);
  await runAnalysis(analysis);
  console.log(`Finished analysis ${analysis.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("run-once crashed:", error);
    process.exit(1);
  });
