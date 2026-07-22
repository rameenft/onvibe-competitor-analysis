import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET(_request: Request, context: RouteContext<"/api/analyses/[id]">) {
  const { id } = await context.params;
  const supabase = getSupabaseClient();

  const { data: analysis, error } = await supabase.from("analyses").select("*").eq("id", id).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }

  const { data: reports } = await supabase
    .from("analysis_reports")
    .select("report_type, pdf_url")
    .eq("analysis_id", id);

  return NextResponse.json({ analysis, reports: reports ?? [] });
}
