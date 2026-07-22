import { chromium } from "playwright";
import { getSupabaseClient } from "../../lib/supabase";
import { APP_BASE_URL } from "../../lib/config";
import type { ReportType } from "../../lib/types";

const REPORT_READY_TIMEOUT_MS = 20000;

async function capturePdf(url: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    // Recharts lays out via ResizeObserver after mount — wait for the
    // client-side marker (see components/reports/ReportReadyMarker.tsx)
    // rather than just page load, so charts aren't captured empty. If it
    // never fires for some reason, proceed anyway rather than failing the
    // whole render.
    await page
      .waitForSelector("html[data-report-ready='true']", { timeout: REPORT_READY_TIMEOUT_MS })
      .catch(() => {
        console.warn(`data-report-ready never appeared for ${url}, capturing anyway`);
      });

    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "1.5cm", bottom: "1.5cm", left: "1.2cm", right: "1.2cm" },
    });
  } finally {
    await browser.close();
  }
}

async function uploadReport(analysisId: string, reportType: ReportType, pdf: Buffer): Promise<string> {
  const supabase = getSupabaseClient();
  const path = `${analysisId}/${reportType}.pdf`;

  const { error } = await supabase.storage.from("reports").upload(path, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(`Failed to upload ${reportType} report: ${error.message}`);

  const { data } = supabase.storage.from("reports").getPublicUrl(path);
  return data.publicUrl;
}

// Captures both report pages via the app's own print-mode routes
// (?print=1 hides in-app navigation chrome) and uploads the resulting PDFs
// to Supabase Storage. Reuses the exact same React components/CSS/charts as
// the live in-browser view — there is no separate PDF-specific
// implementation to keep in sync.
export async function renderReports(analysisId: string): Promise<void> {
  const supabase = getSupabaseClient();

  const detailedPdf = await capturePdf(`${APP_BASE_URL}/analyses/${analysisId}/report/detailed?print=1`);
  const detailedUrl = await uploadReport(analysisId, "detailed", detailedPdf);

  const customerPdf = await capturePdf(`${APP_BASE_URL}/analyses/${analysisId}/report/customer?print=1`);
  const customerUrl = await uploadReport(analysisId, "customer", customerPdf);

  // Only pdf_url is in this payload, so the upsert's ON CONFLICT UPDATE only
  // touches that column -- the customer row's `content` (already written by
  // synthesizeCustomerReport) is untouched since it isn't part of this SET.
  await supabase.from("analysis_reports").upsert(
    [
      { analysis_id: analysisId, report_type: "detailed" as const, pdf_url: detailedUrl },
      { analysis_id: analysisId, report_type: "customer" as const, pdf_url: customerUrl },
    ],
    { onConflict: "analysis_id,report_type" },
  );
}
