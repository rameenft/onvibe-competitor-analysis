"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Platform = "instagram" | "tiktok" | "linkedin";

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "linkedin", label: "LinkedIn" },
];

interface CompetitorForm {
  name: string;
  handles: Partial<Record<Platform, string>>;
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

function emptyCompetitors(): CompetitorForm[] {
  return [{ name: "", handles: {} }, { name: "", handles: {} }, { name: "", handles: {} }];
}

type SubmitStage = "idle" | "validating" | "creating";

export default function HomePage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [region, setRegion] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram"]);
  const [targetHandles, setTargetHandles] = useState<Partial<Record<Platform, string>>>({});
  const [competitors, setCompetitors] = useState<CompetitorForm[]>(emptyCompetitors());
  const [stage, setStage] = useState<SubmitStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const submitting = stage !== "idle";

  function togglePlatform(platform: Platform) {
    setPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    );
  }

  function updateCompetitor(index: number, patch: Partial<CompetitorForm>) {
    setCompetitors((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function updateCompetitorHandle(index: number, platform: Platform, value: string) {
    setCompetitors((prev) =>
      prev.map((c, i) => (i === index ? { ...c, handles: { ...c.handles, [platform]: value } } : c)),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = { companyName, industry, region, platforms, targetHandles, competitors };

    try {
      setStage("validating");
      const validateRes = await fetch("/api/validate-handles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const validateData = await validateRes.json();
      if (!validateRes.ok) {
        setError(validateData.error ?? "Handle validation failed.");
        setStage("idle");
        return;
      }
      if (!validateData.allValid) {
        const invalid = (validateData.results as HandleCheck[]).filter((r) => !r.valid);
        setError(
          "Couldn't verify these handles — fix them before running the analysis: " +
            invalid.map((r) => `${r.label} on ${r.platform} (@${r.handle}): ${r.error}`).join("; "),
        );
        setStage("idle");
        return;
      }

      setStage("creating");
      const res = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setStage("idle");
        return;
      }
      router.push(`/analyses/${data.id}`);
    } catch {
      setError("Network error — please try again.");
      setStage("idle");
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Competitive Analysis</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Enter your business and up to three competitors. We&apos;ll analyze weekly growth, engagement, content
        patterns, and collaborations over the last 90 days.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Your business</h2>
          <input
            className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Company name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="Industry / niche"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              required
            />
            <input
              className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="Location / region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              required
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Platforms to analyze</h2>
          <div className="flex gap-4">
            {PLATFORM_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={platforms.includes(option.value)}
                  onChange={() => togglePlatform(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </section>

        {platforms.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
              Your business&apos;s handles
            </h2>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${platforms.length}, 1fr)` }}>
              {platforms.map((platform) => (
                <input
                  key={platform}
                  className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
                  placeholder={`${platform} handle`}
                  value={targetHandles[platform] ?? ""}
                  onChange={(e) => setTargetHandles((prev) => ({ ...prev, [platform]: e.target.value }))}
                  required
                />
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-5">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Three competitors</h2>
          {competitors.map((competitor, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 rounded border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <input
                className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
                placeholder={`Competitor ${index + 1} name`}
                value={competitor.name}
                onChange={(e) => updateCompetitor(index, { name: e.target.value })}
                required
              />
              {platforms.length > 0 && (
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${platforms.length}, 1fr)` }}>
                  {platforms.map((platform) => (
                    <input
                      key={platform}
                      className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
                      placeholder={`${platform} handle`}
                      value={competitor.handles[platform] ?? ""}
                      onChange={(e) => updateCompetitorHandle(index, platform, e.target.value)}
                      required
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || platforms.length === 0}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {stage === "validating"
            ? "Checking handles..."
            : stage === "creating"
              ? "Starting analysis..."
              : "Generate reports"}
        </button>
      </form>
    </main>
  );
}
