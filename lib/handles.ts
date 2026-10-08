// Handles go straight into scraper-actor input, so reject anything that isn't
// shaped like a username or company slug.
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export function cleanHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, "");
  return HANDLE_PATTERN.test(handle) ? handle : null;
}
