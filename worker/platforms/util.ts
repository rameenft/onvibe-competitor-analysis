export interface DailyPoint {
  date: Date;
  followers: number;
}

// Monday of the ISO week containing `date`, as YYYY-MM-DD (UTC).
export function weekStartISO(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diffToMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

// Collapses arbitrary-granularity historical points (daily or otherwise)
// into one point per ISO week — the latest point seen for that week wins —
// so a source's raw daily history and any coarser-grained source both
// produce the same weekly shape account_snapshots expects.
export function aggregateToWeekly(points: DailyPoint[]): { weekStart: string; followers: number }[] {
  const byWeek = new Map<string, DailyPoint>();
  for (const point of points) {
    const week = weekStartISO(point.date);
    const existing = byWeek.get(week);
    if (!existing || point.date >= existing.date) {
      byWeek.set(week, point);
    }
  }
  return Array.from(byWeek.entries())
    .map(([weekStart, point]) => ({ weekStart, followers: point.followers }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
