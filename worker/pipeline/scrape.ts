import { assertOk, getSupabaseClient } from "../../lib/supabase";
import { getPlatformAdapter } from "../platforms";
import type { Account } from "../../lib/types";

export async function scrapeAccount(account: Account, windowDays: number): Promise<void> {
  const supabase = getSupabaseClient();
  const adapter = getPlatformAdapter(account.platform);
  const sinceDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const profile = await adapter.fetchProfile(account.handle);
  assertOk(
    await supabase
      .from("accounts")
      .update({
        display_name: profile.displayName,
        followers: profile.followers,
        following: profile.following,
        bio: profile.bio,
        scraped_at: new Date().toISOString(),
      })
      .eq("id", account.id),
    `Saving profile for @${account.handle}`,
  );

  const posts = await adapter.fetchPosts(account.handle, sinceDate);
  if (posts.length > 0) {
    assertOk(
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
        views: p.views,
        posted_at: p.postedAt,
        coauthor_handle: p.coauthorHandle,
      })),
      { onConflict: "account_id,post_url" },
      ),
      `Saving posts for @${account.handle}`,
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
