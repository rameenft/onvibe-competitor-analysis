"use client";

import {
  CartesianGrid,
  Legend,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import type { AccountMetrics } from "@/lib/types";
import { categoricalColor, CHROME } from "./palette";
import { useColorScheme } from "./useColorScheme";

interface Props {
  accounts: AccountMetrics[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

// Competitive landscape: followers (log x) vs engagement rate (y). Up to
// 4 series (target + 3 competitors), which is exactly the slot cap the
// palette validates for all-pairs scatter contexts — direct labels are
// mandatory at this series count, not optional, per the dataviz skill.
export function CompetitiveLandscapeChart({ accounts }: Props) {
  const scheme = useColorScheme();
  const chrome = CHROME[scheme];

  const medianFollowers = median(accounts.map((a) => a.followers));
  const medianEr = median(accounts.map((a) => a.engagementRate * 100));

  return (
    <div style={{ width: "100%", height: 420 }} data-chart="competitive-landscape">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 30, bottom: 40, left: 20 }}>
          <CartesianGrid stroke={chrome.gridline} />
          <XAxis
            type="number"
            dataKey="followers"
            name="Followers"
            scale="log"
            domain={["auto", "auto"]}
            tick={{ fill: chrome.muted, fontSize: 12 }}
            stroke={chrome.baseline}
            label={{
              value: "Followers (log scale)",
              position: "bottom",
              offset: 0,
              fill: chrome.textSecondary,
              fontSize: 12,
            }}
          />
          <YAxis
            type="number"
            dataKey="engagementRateDisplay"
            name="Engagement rate"
            tick={{ fill: chrome.muted, fontSize: 12 }}
            stroke={chrome.baseline}
            unit="%"
            label={{
              value: "Engagement rate (%)",
              angle: -90,
              position: "insideLeft",
              fill: chrome.textSecondary,
              fontSize: 12,
            }}
          />
          <ReferenceLine x={medianFollowers} stroke={chrome.baseline} strokeDasharray="4 4" />
          <ReferenceLine y={medianEr} stroke={chrome.baseline} strokeDasharray="4 4" />
          <Tooltip
            contentStyle={{ background: chrome.surface, border: `1px solid ${chrome.gridline}`, fontSize: 12 }}
            formatter={(value, name) => [
              name === "Engagement rate" ? `${Number(value).toFixed(2)}%` : Number(value).toLocaleString(),
              name,
            ]}
          />
          <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 12, color: chrome.textSecondary }} />
          {accounts.map((account, i) => {
            const color = categoricalColor(i, scheme);
            const isTarget = account.role === "target";
            return (
              <Scatter
                key={account.accountId}
                name={account.handle}
                data={[
                  {
                    followers: account.followers,
                    engagementRateDisplay: account.engagementRate * 100,
                    handle: account.handle,
                  },
                ]}
                fill={color}
                shape={(props: { cx?: number; cy?: number }) => (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={isTarget ? 7 : 5.5}
                    fill={color}
                    stroke={chrome.surface}
                    strokeWidth={2}
                  />
                )}
              >
                <LabelList
                  dataKey="handle"
                  position="top"
                  style={{ fill: chrome.textPrimary, fontSize: 11, fontWeight: isTarget ? 600 : 400 }}
                />
              </Scatter>
            );
          })}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
