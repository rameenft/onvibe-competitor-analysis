"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AccountMetrics } from "@/lib/types";
import { categoricalColor, CHROME } from "./palette";
import { useColorScheme } from "./useColorScheme";

interface Props {
  accounts: AccountMetrics[];
}

function mergeMediaTypeSeries(accounts: AccountMetrics[]): Record<string, number | string>[] {
  const types = new Set<string>();
  for (const account of accounts) {
    for (const type of Object.keys(account.mediaTypeBreakdown)) types.add(type);
  }
  return Array.from(types).map((type) => {
    const row: Record<string, number | string> = { type };
    for (const account of accounts) {
      row[account.handle] = account.mediaTypeBreakdown[type]?.avgEngagement ?? 0;
    }
    return row;
  });
}

// Reels vs static photos vs carousel vs video, etc — avg engagement
// (likes + comments) per media type, grouped by account for comparison.
export function MediaTypeChart({ accounts }: Props) {
  const scheme = useColorScheme();
  const chrome = CHROME[scheme];
  const data = mergeMediaTypeSeries(accounts);

  return (
    <div style={{ width: "100%", height: 340 }} data-chart="media-type">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 20, right: 30, bottom: 10, left: 10 }}>
          <CartesianGrid stroke={chrome.gridline} vertical={false} />
          <XAxis dataKey="type" tick={{ fill: chrome.muted, fontSize: 12 }} stroke={chrome.baseline} />
          <YAxis
            tick={{ fill: chrome.muted, fontSize: 12 }}
            stroke={chrome.baseline}
            label={{
              value: "Avg engagement / post",
              angle: -90,
              position: "insideLeft",
              fill: chrome.textSecondary,
              fontSize: 12,
            }}
          />
          <Tooltip contentStyle={{ background: chrome.surface, border: `1px solid ${chrome.gridline}`, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12, color: chrome.textSecondary }} />
          {accounts.map((account, i) => (
            <Bar
              key={account.accountId}
              dataKey={account.handle}
              name={account.handle}
              fill={categoricalColor(i, scheme)}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
