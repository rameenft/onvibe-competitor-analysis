import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { MAX_COMPETITORS, PLATFORMS, WINDOW_DAYS } from "@/lib/config";
import type { Platform } from "@/lib/types";

interface CompetitorInput {
  name: string;
  handles: Partial<Record<Platform, string>>;
}

interface CreateAnalysisBody {
  companyName: string;
  industry: string;
  region: string;
  platforms: Platform[];
  targetHandles: Partial<Record<Platform, string>>;
  competitors: CompetitorInput[];
}

function stripHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

// This route only inserts rows and returns — the actual scrape/classify/
// metrics/synthesize/render pipeline runs in the standalone worker process
// (worker/index.ts), which polls for status='pending' rows. See the build
// plan for why: that pipeline routinely runs past any serverless timeout.
export async function POST(request: Request) {
  const body = (await request.json()) as CreateAnalysisBody;

  if (!body.companyName?.trim() || !body.industry?.trim() || !body.region?.trim()) {
    return NextResponse.json({ error: "Company name, industry, and region are required." }, { status: 400 });
  }
  if (!body.platforms || body.platforms.length === 0) {
    return NextResponse.json({ error: "Select at least one platform." }, { status: 400 });
  }
  if (!body.platforms.every((p) => (PLATFORMS as readonly string[]).includes(p))) {
    return NextResponse.json({ error: "Invalid platform selected." }, { status: 400 });
  }
  if (!body.competitors || body.competitors.length !== MAX_COMPETITORS) {
    return NextResponse.json({ error: `Exactly ${MAX_COMPETITORS} competitors are required.` }, { status: 400 });
  }
  for (const platform of body.platforms) {
    if (!body.targetHandles[platform]?.trim()) {
      return NextResponse.json({ error: `Missing target handle for ${platform}.` }, { status: 400 });
    }
    for (const competitor of body.competitors) {
      if (!competitor.name?.trim() || !competitor.handles[platform]?.trim()) {
        return NextResponse.json(
          { error: `Missing competitor name/handle for ${platform}.` },
          { status: 400 },
        );
      }
    }
  }

  const supabase = getSupabaseClient();

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .insert({
      company_name: body.companyName.trim(),
      industry: body.industry.trim(),
      region: body.region.trim(),
      platforms: body.platforms,
      window_days: WINDOW_DAYS,
      status: "pending",
      status_detail: "Queued.",
    })
    .select()
    .single();

  if (analysisError || !analysis) {
    return NextResponse.json({ error: analysisError?.message ?? "Failed to create analysis." }, { status: 500 });
  }

  const accountRows: Record<string, unknown>[] = [];
  for (const platform of body.platforms) {
    accountRows.push({
      analysis_id: analysis.id,
      platform,
      handle: stripHandle(body.targetHandles[platform]!),
      role: "target",
      display_name: body.companyName.trim(),
    });
    for (const competitor of body.competitors) {
      accountRows.push({
        analysis_id: analysis.id,
        platform,
        handle: stripHandle(competitor.handles[platform]!),
        role: "competitor",
        display_name: competitor.name.trim(),
      });
    }
  }

  const { error: accountsError } = await supabase.from("accounts").insert(accountRows);
  if (accountsError) {
    await supabase
      .from("analyses")
      .update({ status: "failed", status_detail: accountsError.message })
      .eq("id", analysis.id);
    return NextResponse.json({ error: accountsError.message }, { status: 500 });
  }

  return NextResponse.json({ id: analysis.id });
}
