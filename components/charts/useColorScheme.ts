"use client";

import { useSyncExternalStore } from "react";

// Recharts renders raw SVG fill/stroke attributes, which can't reference CSS
// custom properties the way the rest of the app's Tailwind classes can — so
// chart color selection needs an explicit light/dark value in JS. The
// Playwright print pipeline renders in a headless browser with a light
// default profile, which this hook picks up the same way any browser would.
const QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useColorScheme(): "light" | "dark" {
  return useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(QUERY).matches ? "dark" : "light"),
    () => "light", // server render and first hydration pass
  );
}
