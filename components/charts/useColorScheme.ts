"use client";

import { useEffect, useState } from "react";

// Recharts renders raw SVG fill/stroke attributes, which can't reference CSS
// custom properties the way the rest of the app's Tailwind classes can — so
// chart color selection needs an explicit light/dark value in JS. The
// Playwright print pipeline renders in a headless browser with a light
// default profile, which this hook picks up the same way any browser would.
export function useColorScheme(): "light" | "dark" {
  const [scheme, setScheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setScheme(mq.matches ? "dark" : "light");
    const listener = (e: MediaQueryListEvent) => setScheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  return scheme;
}
