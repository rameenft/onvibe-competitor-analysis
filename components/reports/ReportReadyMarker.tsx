"use client";

import { useEffect } from "react";

// Recharts lays out its SVG via a ResizeObserver after mount, so the
// server-rendered HTML exists before charts have actually painted. The
// Playwright print pipeline waits on this attribute (rather than on page
// load) so it doesn't capture a page with empty chart containers.
export function ReportReadyMarker() {
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setTimeout(() => {
        document.documentElement.setAttribute("data-report-ready", "true");
      }, 400);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return null;
}
