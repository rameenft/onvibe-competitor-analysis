"use client";

import { CartesianGrid, Legend, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ResponsiveContainer } from "recharts";
import type { AccountMetrics } from "@/lib/types";
import { categoryColor, CATEGORY_SLOT, CHROME } from "./palette";
import { useColorScheme } from "./useColorScheme";

interface Props {
  accounts: AccountMetrics[];
}

// Content-category engagement vs each account's own organic baseline — one
// row per account (y = handle, categorical), one dot per category present
// (x = avg engagement, log scale), plus a gray baseline tick per row. Direct
// port of the Python prototype's chart_category_performance, adapted to
// Recharts: each category is its own Scatter series (colored, filtered to
// its points across all handles) so the legend carries category identity.
export function CategoryPerformanceChart({ accounts }: Props) {
  const scheme = useColorScheme();
  const chrome = CHROME[scheme];
  const categories = Object.keys(CATEGORY_SLOT).filter((cat) =>
    accounts.some((a) => a.categoryBreakdown[cat]),
  );

  const baselineData = accounts
    .filter((a) => a.baselineEngagement > 0)
    .map((a) => ({ handle: a.handle, baseline: a.baselineEngagement }));

  return (
    <div style={{ width: "100%", height: Math.max(220, 70 * accounts.length) }} data-chart="category-performance">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 20, right: 120, bottom: 20, left: 80 }}>
          <CartesianGrid stroke={chrome.gridline} />
          <XAxis
            type="number"
            dataKey="value"
            name="Avg engagement"
            scale="log"
            domain={["auto", "auto"]}
            tick={{ fill: chrome.muted, fontSize: 12 }}
            stroke={chrome.baseline}
            label={{
              value: "Avg engagement / post (log scale)",
              position: "insideBottom",
              offset: -10,
              fill: chrome.textSecondary,
              fontSize: 12,
            }}
          />
          <YAxis
            type="category"
            dataKey="handle"
            name="Account"
            allowDuplicatedCategory={false}
            tick={{ fill: chrome.textPrimary, fontSize: 12 }}
            stroke={chrome.baseline}
            width={80}
          />
          <Tooltip contentStyle={{ background: chrome.surface, border: `1px solid ${chrome.gridline}`, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12, color: chrome.textSecondary }} layout="vertical" align="right" verticalAlign="middle" />
          <Scatter
            name="Organic baseline"
            data={baselineData.map((d) => ({ handle: d.handle, value: d.baseline }))}
            fill={chrome.baseline}
            shape={(props: { cx?: number; cy?: number }) => (
              <rect x={(props.cx ?? 0) - 1} y={(props.cy ?? 0) - 8} width={2} height={16} fill={chrome.baseline} />
            )}
          />
          {categories.map((category) => (
            <Scatter
              key={category}
              name={category}
              data={accounts
                .filter((a) => a.categoryBreakdown[category])
                .map((a) => ({ handle: a.handle, value: a.categoryBreakdown[category].avgEngagement }))}
              fill={categoryColor(category, scheme)}
              shape={(props: { cx?: number; cy?: number }) => (
                <circle
                  cx={props.cx}
                  cy={props.cy}
                  r={5.5}
                  fill={categoryColor(category, scheme)}
                  stroke={chrome.surface}
                  strokeWidth={2}
                />
              )}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
