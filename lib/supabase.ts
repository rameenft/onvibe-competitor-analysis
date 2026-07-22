import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

let client: SupabaseClient | undefined;

// Service-role client: bypasses RLS. This module is shared with the
// standalone worker process (plain tsx/Node, not Next's bundler), so it
// intentionally does NOT import the `server-only` marker package — that
// package throws unconditionally outside webpack/turbopack's "react-server"
// resolution condition. Never import this file from a "use client" component;
// only from Server Components, Route Handlers, or worker/*.
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const { url, serviceRoleKey } = getSupabaseConfig();
    client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}
