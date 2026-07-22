import { config as loadEnv } from "dotenv";

// Next.js loads .env.local automatically for the app; the standalone worker
// process (run via tsx, outside Next) does not, so we load it here too.
// `override: false` (dotenv's default) means this is a no-op wherever Next
// already injected the vars.
loadEnv({ path: ".env.local" });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Each getter reads env vars lazily (not at module load) so that, e.g., a
// page that only touches Supabase doesn't fail just because the Apify token
// isn't filled in yet, and so tests can stub individual sections.
export function getApifyConfig() {
  return {
    token: required("APIFY_API_TOKEN"),
    actors: {
      instagram: {
        profile: required("APIFY_IG_PROFILE_ACTOR_ID"),
        posts: required("APIFY_IG_POST_ACTOR_ID"),
      },
      tiktok: {
        profile: required("APIFY_TIKTOK_PROFILE_ACTOR_ID"),
        posts: required("APIFY_TIKTOK_POST_ACTOR_ID"),
      },
      linkedin: {
        posts: required("APIFY_LINKEDIN_POST_ACTOR_ID"),
      },
      socialblade: required("APIFY_SOCIALBLADE_ACTOR_ID"),
    },
  };
}

export function getSupabaseConfig() {
  return {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getAnthropicConfig() {
  return {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: process.env.CLAUDE_MODEL ?? "claude-sonnet-5",
  };
}

export const WORKER_POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
export const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

export const MAX_COMPETITORS = 3;
export const WINDOW_DAYS = 90;
export const SNAPSHOT_WEEKS = 13;

export const PLATFORMS = ["instagram", "tiktok", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];
