"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AccountMetrics } from "@/lib/types";
import { categoricalColor, CHROME } from "./palette";
import { useColorScheme } from "./useColorScheme";

interface Props {
  accounts: AccountMetrics[];
}

// Views is TikTok's single most important metric (a video-discovery
// platform) and available for Instagram Reels/video -- not a general
// "engagement" number, so it gets its own chart rather than folding into
// engagement rate math. Only rendered by the report page when at least one
// account in the set actually has a views figure.
export function ViewsPerformanceChart({ accounts }: Props) {
  const scheme = useColorScheme();
  const chrome = CHROME[scheme];
  const data = accounts
    .filter((a) => a.avgViews != null)
    .map((a) => ({ handle: a.handle, views: a.avgViews as number }));

  return (
    <div style={{ width: "100%", height: 300 }} data-chart="views-performance">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 20, right: 30, bottom: 10, left: 20 }}>
          <CartesianGrid stroke={chrome.gridline} vertical={false} />
          <XAxis dataKey="handle" tick={{ fill: chrome.textPrimary, fontSize: 12 }} stroke={chrome.baseline} />
          <YAxis
            tick={{ fill: chrome.muted, fontSize: 12 }}
            stroke={chrome.baseline}
            tickFormatter={(v: number) => v.toLocaleString()}
            label={{
              value: "Avg views / post",
              angle: -90,
              position: "insideLeft",
              fill: chrome.textSecondary,
              fontSize: 12,
            }}
          />
          <Tooltip
            contentStyle={{ background: chrome.surface, border: `1px solid ${chrome.gridline}`, fontSize: 12 }}
            formatter={(value) => Number(value).toLocaleString()}
          />
          <Bar dataKey="views" name="Avg views" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {data.map((entry, i) => (
              <Cell key={entry.handle} fill={categoricalColor(i, scheme)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
