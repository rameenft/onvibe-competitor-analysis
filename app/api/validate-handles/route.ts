import { NextResponse } from "next/server";
import { getPlatformAdapter } from "@/worker/platforms";
import { createLimiter } from "@/lib/concurrency";
import { cleanHandle } from "@/lib/handles";
import type { Platform } from "@/lib/types";

// Each handle is a separate Apify run of ~10-30s, so they go out in parallel
// (capped) instead of running one after another.
const MAX_CONCURRENT_CHECKS = 6;
const MAX_HANDLES = 15;

interface CompetitorInput {
  name: string;
  handles: Partial<Record<Platform, string>>;
}

interface ValidateBody {
  platforms: Platform[];
  targetHandles: Partial<Record<Platform, string>>;
  competitors: CompetitorInput[];
}

interface HandleCheck {
  platform: Platform;
  role: "target" | "competitor";
  label: string;
  handle: string;
  valid: boolean;
  followers?: number;
  error?: string;
}

async function checkHandle(platform: Platform, handle: string): Promise<{ valid: boolean; followers?: number; error?: string }> {
  try {
    const adapter = getPlatformAdapter(platform);
    const profile = await adapter.fetchProfile(handle);
    // A profile actor that found nothing typically comes back with every
    // field empty/zero -- a real account (even brand-new, zero-follower)
    // almost always has at least a display name. This heuristic may need
    // adjustment once seen against real TikTok/LinkedIn actor output, same
    // as the other "verify against a live run" caveats in worker/platforms/.
    if (profile.followers === 0 && !profile.displayName && !profile.bio) {
      return { valid: false, error: "Account not found or the actor returned no data for this handle." };
    }
    return { valid: true, followers: profile.followers };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Lookup failed." };
  }
}

// A dedicated, cheap pre-flight check -- confirms every target/competitor
// handle actually resolves before /api/analyses creates a row and the
// worker kicks off the full (paid) scrape -> classify -> synthesize
// pipeline. Costs one extra profile-only Apify call per account, which is
// a small price against wasting the expensive part of the run on a typo'd
// or wrong handle.
export async function POST(request: Request) {
  let body: ValidateBody;
  try {
    body = (await request.json()) as ValidateBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body.platforms || body.platforms.length === 0) {
    return NextResponse.json({ error: "Select at least one platform." }, { status: 400 });
  }

  const jobs: { platform: Platform; role: "target" | "competitor"; label: string; handle: string }[] = [];
  for (const platform of body.platforms) {
    const targetHandle = body.targetHandles[platform];
    if (targetHandle?.trim()) {
      jobs.push({ platform, role: "target", label: "Your business", handle: targetHandle });
    }
    for (const competitor of body.competitors ?? []) {
      const handle = competitor.handles[platform];
      if (handle?.trim()) {
        jobs.push({
          platform,
          role: "competitor",
          label: competitor.name?.trim() || "Competitor",
          handle,
        });
      }
    }
  }

  if (jobs.length > MAX_HANDLES) {
    return NextResponse.json({ error: `Too many handles (max ${MAX_HANDLES}).` }, { status: 400 });
  }

  const limit = createLimiter(MAX_CONCURRENT_CHECKS);
  const results: HandleCheck[] = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const handle = cleanHandle(job.handle);
        if (!handle) {
          return { ...job, valid: false, error: "Handles may only contain letters, numbers, dots, underscores and hyphens." };
        }
        return { ...job, handle, ...(await checkHandle(job.platform, handle)) };
      }),
    ),
  );

  const allValid = results.length > 0 && results.every((r) => r.valid);
  return NextResponse.json({ allValid, results });
}
