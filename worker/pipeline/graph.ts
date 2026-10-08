import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { TopicGap } from "../../lib/kg";

// The knowledge graph is built by the Python layer (ml/onvibe_ml/kg). The worker runs it as a
// subprocess: `kg build --analysis ID --persist --json` extracts entities for posts not cached yet,
// upserts only this analysis' rows into the kg_* tables, and prints the topic gaps as JSON on stdout
// (logs go to stderr, which passes through to the worker's own).

const KG_TIMEOUT_MS = Number(process.env.KG_TIMEOUT_MS) || 10 * 60 * 1000;

export interface KgBuildResult {
  targets: string[];
  competitors: string[];
  /** Every gap, uncapped, most promising first. */
  gaps: TopicGap[];
  targetOnlyTopics: { topic: string; medianLift: number; postCount: number }[];
  competitorPostCount: number;
}

/** Throws if the subprocess output isn't the gaps JSON `kg build --json` prints. */
export function parseKgOutput(stdout: string): KgBuildResult {
  let data: Partial<KgBuildResult> | null;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error(`kg build printed something other than JSON: ${stdout.slice(0, 200)}`);
  }
  if (!data || !Array.isArray(data.gaps) || typeof data.competitorPostCount !== "number") {
    throw new Error("kg build output is missing gaps or competitorPostCount");
  }
  return {
    targets: data.targets ?? [],
    competitors: data.competitors ?? [],
    gaps: data.gaps,
    targetOnlyTopics: data.targetOnlyTopics ?? [],
    competitorPostCount: data.competitorPostCount,
  };
}

function pythonExecutable(): string {
  if (process.env.ML_PYTHON) return process.env.ML_PYTHON;
  const venvPython = path.resolve("ml", ".venv", "bin", "python");
  return existsSync(venvPython) ? venvPython : "python3";
}

/** Runs the Python CLI from ml/ and resolves with its stdout; rejects on nonzero exit, spawn failure or timeout. */
export function runKgBuild(analysisId: string, timeoutMs = KG_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonExecutable(),
      ["-m", "onvibe_ml", "kg", "build", "--analysis", analysisId, "--persist", "--json"],
      { cwd: path.resolve("ml"), stdio: ["ignore", "pipe", "inherit"] },
    );
    let stdout = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`kg build timed out after ${Math.round(timeoutMs / 1000)}s`));
      else if (code !== 0) reject(new Error(`kg build exited with code ${code}`));
      else resolve(stdout);
    });
  });
}

/**
 * Builds and persists this analysis' knowledge graph. Never throws: the graph is an extra on top of
 * the metrics, so a failure (no Python env, timeout, Gemini error) is logged and returns null, and
 * the analysis carries on without topic gaps.
 */
export async function buildKnowledgeGraph(
  analysisId: string,
  run: (analysisId: string) => Promise<string> = runKgBuild,
): Promise<KgBuildResult | null> {
  try {
    const result = parseKgOutput(await run(analysisId));
    console.log(`Knowledge graph built for ${analysisId}: ${result.gaps.length} topic gaps.`);
    return result;
  } catch (error) {
    console.error(`Knowledge graph build failed for ${analysisId}, continuing without it:`, error);
    return null;
  }
}
