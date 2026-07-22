"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AccountMetrics } from "@/lib/types";
import { categoricalColor, CHROME } from "./palette";
import { useColorScheme } from "./useColorScheme";

interface Props {
  accounts: AccountMetrics[];
}

function mergeWeeklySeries(accounts: AccountMetrics[]): Record<string, number | string>[] {
  const weeks = new Set<string>();
  for (const account of accounts) {
    for (const point of account.weeklyGrowth) weeks.add(point.weekStart);
  }
  return Array.from(weeks)
    .sort()
    .map((weekStart) => {
      const row: Record<string, number | string> = { weekStart };
      for (const account of accounts) {
        const point = account.weeklyGrowth.find((w) => w.weekStart === weekStart);
        if (point) row[account.handle] = point.followers;
      }
      return row;
    });
}

// Weekly follower count over the analysis window, one line per account.
// Accounts with a growthDataGap will simply have fewer/no points here —
// connectNulls keeps a sparse series from breaking the line, but the report
// page is responsible for surfacing the data-gap note alongside the chart.
export function WeeklyGrowthChart({ accounts }: Props) {
  const scheme = useColorScheme();
  const chrome = CHROME[scheme];
  const data = mergeWeeklySeries(accounts);

  return (
    <div style={{ width: "100%", height: 340 }} data-chart="weekly-growth">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 20, right: 30, bottom: 10, left: 10 }}>
          <CartesianGrid stroke={chrome.gridline} />
          <XAxis dataKey="weekStart" tick={{ fill: chrome.muted, fontSize: 11 }} stroke={chrome.baseline} />
          <YAxis
            tick={{ fill: chrome.muted, fontSize: 12 }}
            stroke={chrome.baseline}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <Tooltip
            contentStyle={{ background: chrome.surface, border: `1px solid ${chrome.gridline}`, fontSize: 12 }}
            formatter={(value) => Number(value).toLocaleString()}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: chrome.textSecondary }} />
          {accounts.map((account, i) => (
            <Line
              key={account.accountId}
              type="monotone"
              dataKey={account.handle}
              name={account.handle}
              stroke={categoricalColor(i, scheme)}
              strokeWidth={2}
              dot={{ r: 4, fill: categoricalColor(i, scheme), stroke: chrome.surface, strokeWidth: 2 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
