import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { ReportReadyMarker } from "@/components/reports/ReportReadyMarker";
import { CompetitiveLandscapeChart } from "@/components/charts/CompetitiveLandscapeChart";
import { WeeklyGrowthChart } from "@/components/charts/WeeklyGrowthChart";
import { MediaTypeChart } from "@/components/charts/MediaTypeChart";
import { CategoryPerformanceChart } from "@/components/charts/CategoryPerformanceChart";
import type { AccountMetrics, AnalysisInsights, Platform } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}

function InsightBlock({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-6">
      <h4 className="text-sm font-medium uppercase tracking-wide text-neutral-500">{title}</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default async function DetailedReportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { print } = await searchParams;
  const isPrint = print === "1";

  const supabase = getSupabaseClient();
  const { data: analysis } = await supabase.from("analyses").select("*").eq("id", id).maybeSingle();
  if (!analysis) notFound();

  const { data: insightRows } = await supabase.from("analysis_insights").select("*").eq("analysis_id", id);
  const rows = (insightRows ?? []) as unknown as AnalysisInsights[];
  const platformRows = rows.filter((r) => r.platform !== "all");
  const crossPlatformRow = rows.find((r) => r.platform === "all");

  return (
    <main className={`mx-auto max-w-4xl px-6 ${isPrint ? "py-10" : "py-12"}`}>
      <ReportReadyMarker />
      {!isPrint && (
        <Link href={`/analyses/${id}`} className="text-sm text-neutral-500 underline">
          &larr; Back
        </Link>
      )}
      <h1 className="mt-4 text-3xl font-semibold">{analysis.company_name} — Detailed Competitive Analysis</h1>
      <p className="mt-2 text-sm text-neutral-500">
        {analysis.industry} · {analysis.region} · Platforms: {(analysis.platforms as string[]).join(", ")} ·
        Window: last {analysis.window_days} days · Generated {new Date(analysis.created_at).toLocaleDateString()}
      </p>

      {platformRows.map((row) => {
        const metrics = row.metrics as { platform: Platform; accounts: AccountMetrics[] };
        const growthGapAccount = metrics.accounts.find((a) => a.growthDataGap);
        const lowSampleAccounts = metrics.accounts.filter((a) => a.lowSampleWarning);

        return (
          <section key={row.platform} className="mt-12">
            <h2 className="border-b border-neutral-200 pb-2 text-xl font-semibold capitalize dark:border-neutral-800">
              {row.platform}
            </h2>

            <h3 className="mt-6 text-sm font-medium uppercase tracking-wide text-neutral-500">Scoreboard</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                    <th className="py-2 pr-4">Account</th>
                    <th className="py-2 pr-4">Followers</th>
                    <th className="py-2 pr-4">Cumulative growth</th>
                    <th className="py-2 pr-4">Engagement rate</th>
                    <th className="py-2 pr-4">Avg likes</th>
                    <th className="py-2 pr-4">Avg comments</th>
                    <th className="py-2 pr-4">Posts/wk</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.accounts.map((a) => (
                    <tr
                      key={a.accountId}
                      className={`border-b border-neutral-100 dark:border-neutral-900 ${a.role === "target" ? "font-semibold" : ""}`}
                    >
                      <td className="py-2 pr-4">
                        {a.role === "target" ? "★ " : ""}
                        {a.handle}
                      </td>
                      <td className="py-2 pr-4">
                        {a.followers.toLocaleString()}{" "}
                        <span className="text-neutral-400">(p{a.followersPercentile})</span>
                      </td>
                      <td className="py-2 pr-4">
                        {a.growthDataGap ? (
                          <span className="italic text-neutral-400">data gap</span>
                        ) : (
                          `${a.cumulativeGrowthPct?.toFixed(1)}%`
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {(a.engagementRate * 100).toFixed(2)}%{" "}
                        <span className="text-neutral-400">(p{a.engagementRatePercentile})</span>
                        {a.lowSampleWarning && <div className="text-xs text-amber-600">low-sample</div>}
                      </td>
                      <td className="py-2 pr-4">{a.avgLikes}</td>
                      <td className="py-2 pr-4">{a.avgComments}</td>
                      <td className="py-2 pr-4">{a.postsPerWeek}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {growthGapAccount && (
              <p className="mt-2 text-xs italic text-neutral-500">{growthGapAccount.growthDataGap}</p>
            )}
            {lowSampleAccounts.length > 0 && (
              <p className="mt-1 text-xs italic text-amber-600">
                Low-sample: {lowSampleAccounts.map((a) => a.handle).join(", ")} — reach is small enough that the
                engagement rate should be read directionally, not as a sign of outsized performance.
              </p>
            )}

            <h3 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
              Competitive landscape
            </h3>
            <CompetitiveLandscapeChart accounts={metrics.accounts} />

            <h3 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
              Weekly growth ({analysis.window_days}-day window)
            </h3>
            <WeeklyGrowthChart accounts={metrics.accounts} />

            <h3 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
              Content type performance
            </h3>
            <MediaTypeChart accounts={metrics.accounts} />

            <h3 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
              Category performance vs organic baseline
            </h3>
            <CategoryPerformanceChart accounts={metrics.accounts} />

            <h3 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
              Collaboration cadence
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {metrics.accounts.map((a) => (
                <li key={a.accountId}>
                  <span className="font-medium">{a.handle}</span>: {a.collaborationCadence.postCount}{" "}
                  collaboration/paid posts
                  {a.collaborationCadence.vsBaselineMultiplier != null
                    ? `, ${a.collaborationCadence.vsBaselineMultiplier}x baseline engagement`
                    : " (no baseline comparison available)"}
                </li>
              ))}
            </ul>

            <InsightBlock title="What the data show" items={row.data_observations} />
            <InsightBlock title="What we believe may explain it" items={row.explanations} />
            <InsightBlock title="What we recommend testing" items={row.recommendations} />
          </section>
        );
      })}

      {crossPlatformRow && (
        <section className="mt-12">
          <h2 className="border-b border-neutral-200 pb-2 text-xl font-semibold dark:border-neutral-800">
            Cross-platform synthesis
          </h2>
          <InsightBlock title="What the data show" items={crossPlatformRow.data_observations} />
          <InsightBlock title="What we believe may explain it" items={crossPlatformRow.explanations} />
          <InsightBlock title="What we recommend testing" items={crossPlatformRow.recommendations} />
        </section>
      )}

      <footer className="mt-12 border-t border-neutral-200 pt-4 text-xs text-neutral-400 dark:border-neutral-800">
        Data sources: Apify scrapers (profile, posts, historical growth via Social Blade) · Content categorization
        and narrative synthesis: Claude · Competitor set: target + up to 3 competitors per platform.
      </footer>
    </main>
  );
}
