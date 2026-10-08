import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { ReportReadyMarker } from "@/components/reports/ReportReadyMarker";
import { OnVibeLetterhead } from "@/components/reports/OnVibeLetterhead";
import { ONVIBE_BRAND } from "@/components/reports/brand";
import { CompetitiveLandscapeChart } from "@/components/charts/CompetitiveLandscapeChart";
import { MediaTypeChart } from "@/components/charts/MediaTypeChart";
import { CategoryPerformanceChart } from "@/components/charts/CategoryPerformanceChart";
import { ViewsPerformanceChart } from "@/components/charts/ViewsPerformanceChart";
import { getTopicGaps, groupGapsByCompetitor, type TopicGapsResult } from "@/lib/kg";
import type { AccountMetrics, AnalysisInsights, Platform, ReportContent } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold" style={{ color: ONVIBE_BRAND.teal }}>
        {title}
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

const PLATFORM_ORDER: Platform[] = ["instagram", "tiktok", "linkedin"];

function ChartHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">{children}</h4>;
}

function PlatformSection({ row }: { row: AnalysisInsights }) {
  const accounts: AccountMetrics[] = row.metrics.accounts;
  const lowSampleAccounts = accounts.filter((a) => a.lowSampleWarning);
  const hasViews = accounts.some((a) => a.avgViews != null);

  return (
    <section className="mt-10">
      <h2 className="border-b border-neutral-200 pb-2 text-lg font-bold capitalize dark:border-neutral-800" style={{ color: ONVIBE_BRAND.teal }}>
        {row.platform}
      </h2>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-4">Account</th>
              <th className="py-2 pr-4">Followers</th>
              <th className="py-2 pr-4">Engagement rate</th>
              <th className="py-2 pr-4">Avg likes</th>
              <th className="py-2 pr-4">Avg comments</th>
              {hasViews && <th className="py-2 pr-4">Avg views</th>}
              <th className="py-2 pr-4">Posts/wk</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr
                key={a.accountId}
                className={`border-b border-neutral-100 dark:border-neutral-900 ${a.role === "target" ? "font-semibold" : ""}`}
              >
                <td className="py-2 pr-4">
                  {a.role === "target" ? "★ " : ""}
                  {a.handle}
                </td>
                <td className="py-2 pr-4">
                  {a.followers.toLocaleString()} <span className="text-neutral-400">(p{a.followersPercentile})</span>
                </td>
                <td className="py-2 pr-4">
                  {(a.engagementRate * 100).toFixed(2)}%{" "}
                  <span className="text-neutral-400">(p{a.engagementRatePercentile})</span>
                  {a.lowSampleWarning && <div className="text-xs text-amber-600">low-sample</div>}
                </td>
                <td className="py-2 pr-4">{a.avgLikes}</td>
                <td className="py-2 pr-4">{a.avgComments}</td>
                {hasViews && (
                  <td className="py-2 pr-4">
                    {a.avgViews != null ? (
                      <>
                        {a.avgViews.toLocaleString()}{" "}
                        {a.avgViewsPercentile != null && (
                          <span className="text-neutral-400">(p{a.avgViewsPercentile})</span>
                        )}
                      </>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                )}
                <td className="py-2 pr-4">{a.postsPerWeek}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lowSampleAccounts.length > 0 && (
        <p className="mt-2 text-xs italic text-amber-600">
          Low-sample: {lowSampleAccounts.map((a) => a.handle).join(", ")} — reach is small enough that the
          engagement rate should be read directionally, not as a sign of outsized performance.
        </p>
      )}

      {row.data_observations.length > 0 && (
        <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-relaxed">
          {row.data_observations.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}

      <ChartHeading>Competitive landscape</ChartHeading>
      <CompetitiveLandscapeChart accounts={accounts} />

      <ChartHeading>Content type performance</ChartHeading>
      <MediaTypeChart accounts={accounts} />

      {hasViews && (
        <>
          <ChartHeading>Views per post</ChartHeading>
          <ViewsPerformanceChart accounts={accounts} />
        </>
      )}

      <ChartHeading>Category performance vs organic baseline</ChartHeading>
      <CategoryPerformanceChart accounts={accounts} />
    </section>
  );
}

// Lift is relative to each account's own median, so a small account's one viral post can read as 40x.
// Past 10x the exact figure says nothing more, so don't print it.
function formatLift(lift: number): string {
  return lift >= 10 ? "over 10×" : `${lift.toFixed(1)}×`;
}

function TopicGaps({ result }: { result: TopicGapsResult }) {
  const competitors = groupGapsByCompetitor(result.gaps);
  if (competitors.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold" style={{ color: ONVIBE_BRAND.teal }}>
        Topics your competitors win on that you haven&apos;t covered
      </h2>
      <ul className="mt-3 space-y-3 text-sm leading-relaxed">
        {competitors.map(({ competitor, topics }) => (
          <li key={competitor}>
            <span className="font-semibold">{competitor}</span>
            <span className="text-neutral-500"> · </span>
            {topics.map((t, i) => (
              <span key={t.topic}>
                {i > 0 && <span className="text-neutral-500">; </span>}
                {t.topic}
                <span className="text-neutral-500">
                  {" "}
                  ({formatLift(t.medianLift)} usual engagement, {t.postCount} posts)
                </span>
              </span>
            ))}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-400">
        From {result.competitorPostCount} competitor posts. Each topic rests on a handful of posts, so treat it as
        a lead to test rather than a conclusion.
      </p>
    </section>
  );
}

const PLAN_ACCENTS =[ONVIBE_BRAND.yellow, ONVIBE_BRAND.teal, ONVIBE_BRAND.coral];

function PlanPhaseCard({
  label,
  accent,
  actions,
  successMetrics,
}: {
  label: string;
  accent: string;
  actions: string[];
  successMetrics: string[];
}) {
  return (
    <div
      className="rounded border border-neutral-200 p-4 dark:border-neutral-800"
      style={{ borderTopWidth: 4, borderTopColor: accent }}
    >
      <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: accent }}>
        {label}
      </h3>
      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Actions</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          {actions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>
      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Success metrics</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          {successMetrics.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default async function CustomerReportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { print } = await searchParams;
  const isPrint = print === "1";

  const supabase = getSupabaseClient();
  const { data: analysis } = await supabase.from("analyses").select("*").eq("id", id).maybeSingle();
  if (!analysis) notFound();

  const { data: insightRows } = await supabase.from("analysis_insights").select("*").eq("analysis_id", id);
  const platformRows = ((insightRows ?? []) as unknown as AnalysisInsights[])
    .filter((r) => PLATFORM_ORDER.includes(r.platform))
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));

  const { data: report } = await supabase
    .from("analysis_reports")
    .select("content")
    .eq("analysis_id", id)
    .eq("report_type", "customer")
    .maybeSingle();

  const content = report?.content as ReportContent | undefined;
  if (!content) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm text-neutral-500">Report not ready yet.</p>
      </main>
    );
  }

  // The gaps stored with the report are the ones its writing was based on. Reports from before
  // that field existed read the graph live; either way a missing or unreadable graph must never
  // stop the report (or its PDF render) from showing.
  let topicGaps: TopicGapsResult | null = content.topic_gaps ?? null;
  if (content.topic_gaps === undefined) {
    try {
      topicGaps = await getTopicGaps(id);
    } catch (error) {
      console.error(`Knowledge graph unavailable for analysis ${id}:`, error);
    }
  }

  return (
    <main className={`mx-auto max-w-3xl ${isPrint ? "pb-10" : "pb-12"}`}>
      <ReportReadyMarker />

      <OnVibeLetterhead label="Competitive Analysis Report" />

      <div className="px-6 pt-8">
        {!isPrint && (
          <Link href={`/analyses/${id}`} className="text-sm text-neutral-500 underline">
            &larr; Back
          </Link>
        )}
        <h1 className="mt-4 text-3xl font-semibold">{analysis.company_name}</h1>
        <p className="mt-2 text-sm text-neutral-500">
          {analysis.industry} · {analysis.region} · Last {analysis.window_days} days
        </p>

        <Section title="The three most important things we learned" items={content.key_findings} />
        {platformRows.map((row) => (
          <PlatformSection key={row.platform} row={row} />
        ))}

        <Section title="Content patterns that appear to be working" items={content.working_content_patterns} />
        <Section title="Your most important competitive gaps" items={content.competitive_gaps} />
        {topicGaps && <TopicGaps result={topicGaps} />}
        <Section title="Experiments to run next" items={content.experiments} />

        <section className="mt-10">
          <h2 className="text-lg font-bold" style={{ color: ONVIBE_BRAND.teal }}>
            30 / 60 / 90-day plan
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <PlanPhaseCard
              label="Day 30"
              accent={PLAN_ACCENTS[0]}
              actions={content.plan.day30.actions}
              successMetrics={content.plan.day30.successMetrics}
            />
            <PlanPhaseCard
              label="Day 60"
              accent={PLAN_ACCENTS[1]}
              actions={content.plan.day60.actions}
              successMetrics={content.plan.day60.successMetrics}
            />
            <PlanPhaseCard
              label="Day 90"
              accent={PLAN_ACCENTS[2]}
              actions={content.plan.day90.actions}
              successMetrics={content.plan.day90.successMetrics}
            />
          </div>
        </section>

        <footer className="mt-12 border-t border-neutral-200 pt-4 text-xs text-neutral-400 dark:border-neutral-800">
          Generated {new Date(analysis.created_at).toLocaleDateString()} by{" "}
          <span className="font-semibold" style={{ color: ONVIBE_BRAND.coral }}>
            OnVibe
          </span>{" "}
          · Data: Apify scrapers (profile and posts) · Content classification and writing: Gemini.
        </footer>
      </div>
    </main>
  );
}
