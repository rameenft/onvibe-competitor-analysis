import { getGithubDispatchConfig } from "./config";

const WORKFLOW_FILE = "worker.yml";

// Best-effort: tells the GitHub Actions worker to run right now instead of
// waiting for its next scheduled tick -- which can be delayed by hours in
// practice (GitHub silently throttles `schedule` triggers, especially on
// repos without much other activity; confirmed by observing multi-hour
// gaps against a 5-minute cron). Never throws: the scheduled run remains
// the fallback if this fails or isn't configured, so a dispatch failure
// must never break analysis creation itself.
export async function triggerWorkerDispatch(): Promise<void> {
  const config = getGithubDispatchConfig();
  if (!config) {
    console.warn("GITHUB_DISPATCH_TOKEN/GITHUB_REPO not set — skipping instant dispatch, relying on the schedule.");
    return;
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${config.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      },
    );
    if (!res.ok) {
      console.warn(`GitHub workflow dispatch failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn("GitHub workflow dispatch request failed:", err);
  }
}
