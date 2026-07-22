import { getSupabaseClient } from "../../lib/supabase";
import { getPlatformAdapter } from "../platforms";
import { weekStartISO } from "../platforms/util";
import type { Account } from "../../lib/types";

export async function scrapeAccount(account: Account, windowDays: number): Promise<void> {
  const supabase = getSupabaseClient();
  const adapter = getPlatformAdapter(account.platform);
  const sinceDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const profile = await adapter.fetchProfile(account.handle);
  await supabase
    .from("accounts")
    .update({
      display_name: profile.displayName,
      followers: profile.followers,
      following: profile.following,
      bio: profile.bio,
      scraped_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  const historicalSnapshots = await adapter.fetchHistoricalSnapshots(account.handle, sinceDate);
  if (historicalSnapshots && historicalSnapshots.length > 0) {
    await supabase.from("account_snapshots").upsert(
      historicalSnapshots.map((s) => ({
        account_id: account.id,
        week_start: s.weekStart,
        followers: s.followers,
        source: "socialblade" as const,
      })),
      { onConflict: "account_id,week_start" },
    );
  }

  // Fill in the current week from the live profile scrape, but only if no
  // historical source already covers it — Social Blade's data typically
  // lags a few days, so this just closes that gap rather than overwriting it.
  await supabase.from("account_snapshots").upsert(
    [
      {
        account_id: account.id,
        week_start: weekStartISO(new Date()),
        followers: profile.followers,
        source: "apify_profile" as const,
      },
    ],
    { onConflict: "account_id,week_start", ignoreDuplicates: true },
  );

  const posts = await adapter.fetchPosts(account.handle, sinceDate);
  if (posts.length > 0) {
    await supabase.from("posts").upsert(
      posts.map((p) => ({
        account_id: account.id,
        platform: account.platform,
        post_url: p.postUrl,
        caption: p.caption,
        media_type: p.mediaType,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        posted_at: p.postedAt,
        coauthor_handle: p.coauthorHandle,
      })),
      { onConflict: "account_id,post_url" },
    );
  }
}

// Sequential, not parallel — keeps Apify concurrency predictable and makes
// a failed run easy to attribute to a specific account.
export async function scrapeAllAccounts(accounts: Account[], windowDays: number): Promise<void> {
  for (const account of accounts) {
    await scrapeAccount(account, windowDays);
  }
}
