"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

interface AnalysisStatusResponse {
  analysis: {
    id: string;
    company_name: string;
    status: string;
    status_detail: string | null;
  };
  reports: { report_type: "detailed" | "customer"; pdf_url: string | null }[];
  error?: string;
}

const STEPS = ["pending", "scraping", "categorizing", "computing", "synthesizing", "rendering", "done"];

export default function AnalysisStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<AnalysisStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/analyses/${id}`);
        const json = (await res.json()) as AnalysisStatusResponse;
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? "Failed to load analysis.");
          return;
        }
        setData(json);
        if (json.analysis.status !== "done" && json.analysis.status !== "failed") {
          setTimeout(poll, 3000);
        }
      } catch {
        if (!cancelled) setError("Network error while checking status.");
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm text-red-600">{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm text-neutral-500">Loading...</p>
      </main>
    );
  }

  const { analysis, reports } = data;
  const stepIndex = STEPS.indexOf(analysis.status);
  const detailedReport = reports.find((r) => r.report_type === "detailed");
  const customerReport = reports.find((r) => r.report_type === "customer");

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">{analysis.company_name}</h1>

      {analysis.status === "failed" ? (
        <div className="mt-6 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p className="font-medium">Analysis failed</p>
          <p className="mt-1">{analysis.status_detail}</p>
        </div>
      ) : (
        <div className="mt-6">
          <ol className="flex flex-col gap-2">
            {STEPS.slice(0, -1).map((step, i) => (
              <li key={step} className="flex items-center gap-3 text-sm">
                <span
                  className={`h-2 w-2 rounded-full ${
                    i < stepIndex || analysis.status === "done"
                      ? "bg-green-500"
                      : i === stepIndex
                        ? "animate-pulse bg-blue-500"
                        : "bg-neutral-300 dark:bg-neutral-700"
                  }`}
                />
                <span className="capitalize">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-neutral-500">{analysis.status_detail}</p>
        </div>
      )}

      {analysis.status === "done" && (
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href={`/analyses/${id}/report/customer`}
            className="rounded bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            View customer-facing report
          </Link>
          <Link
            href={`/analyses/${id}/report/detailed`}
            className="rounded border border-neutral-300 px-4 py-2 text-center text-sm font-medium dark:border-neutral-700"
          >
            View detailed report
          </Link>
          <div className="mt-2 flex gap-3 text-sm">
            {customerReport?.pdf_url && (
              <a href={customerReport.pdf_url} className="underline" target="_blank" rel="noreferrer">
                Download customer PDF
              </a>
            )}
            {detailedReport?.pdf_url && (
              <a href={detailedReport.pdf_url} className="underline" target="_blank" rel="noreferrer">
                Download detailed PDF
              </a>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
