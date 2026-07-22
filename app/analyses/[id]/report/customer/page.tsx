import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { ReportReadyMarker } from "@/components/reports/ReportReadyMarker";
import { ONVIBE_BRAND } from "@/components/reports/brand";
import type { CustomerReportContent } from "@/lib/types";

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

const PLAN_ACCENTS = [ONVIBE_BRAND.yellow, ONVIBE_BRAND.teal, ONVIBE_BRAND.coral];

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

  const { data: report } = await supabase
    .from("analysis_reports")
    .select("content")
    .eq("analysis_id", id)
    .eq("report_type", "customer")
    .maybeSingle();

  const content = report?.content as CustomerReportContent | undefined;
  if (!content) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm text-neutral-500">Report not ready yet.</p>
      </main>
    );
  }

  return (
    <main className={`mx-auto max-w-2xl ${isPrint ? "pb-10" : "pb-12"}`}>
      <ReportReadyMarker />

      {/* OnVibe letterhead -- brand belongs on the report chrome, since
          OnVibe produces this report for its client, not on the client's
          own name/identity below. */}
      <div className="flex items-center justify-between px-6 py-5" style={{ backgroundColor: ONVIBE_BRAND.yellow }}>
        <div className="flex items-center gap-2">
          <div
            className="h-0 w-0"
            style={{
              borderLeft: "9px solid transparent",
              borderRight: "9px solid transparent",
              borderTop: `16px solid ${ONVIBE_BRAND.coral}`,
            }}
          />
          <span className="text-lg font-black tracking-tight" style={{ color: ONVIBE_BRAND.ink }}>
            OnVibe
          </span>
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: ONVIBE_BRAND.ink }}>
          Competitive Analysis Report
        </span>
      </div>

      <div className="px-6 pt-8">
        {!isPrint && (
          <Link href={`/analyses/${id}`} className="text-sm text-neutral-500 underline">
            &larr; Back
          </Link>
        )}
        <h1 className="mt-4 text-3xl font-semibold">{analysis.company_name}</h1>
        <p className="mt-2 text-sm text-neutral-500">
          {analysis.industry} · {analysis.region} · Competitive analysis summary
        </p>

        <Section title="The three most important things we learned" items={content.key_findings} />
        <Section title="Content patterns that appear to be working" items={content.working_content_patterns} />
        <Section title="Your most important competitive gaps" items={content.competitive_gaps} />
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
          · A full methodology writeup is available in the detailed report.
        </footer>
      </div>
    </main>
  );
}
