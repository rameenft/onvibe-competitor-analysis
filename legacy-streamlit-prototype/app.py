import streamlit as st

from pipeline.categorize import classify_all
from pipeline.charts import generate_all_charts
from pipeline.config import MAX_COMPETITORS, get_supabase_client
from pipeline.metrics import compute_all
from pipeline.report import render_report
from pipeline.scrape import create_analysis, register_accounts, run_scrape
from pipeline.swot import generate_swot_and_recommendations

st.set_page_config(page_title="Instagram Competitive Analysis", layout="centered")
st.title("Instagram Competitive Analysis")
st.caption("Generates a 30-day competitive analysis report: metrics, content-category performance, SWOT, and recommendations.")

supabase = get_supabase_client()

with st.form("analysis_form"):
    company_name = st.text_input("Company name")
    industry = st.text_input("Industry")
    region = st.text_input("Region")
    target_handle = st.text_input("Company's Instagram handle (no @)")
    competitor_input = st.text_area(
        f"Competitor Instagram handles, one per line (up to {MAX_COMPETITORS})",
        height=120,
    )
    submitted = st.form_submit_button("Generate report")

if submitted:
    competitor_handles = [h.strip().lstrip("@") for h in competitor_input.splitlines() if h.strip()]
    if len(competitor_handles) > MAX_COMPETITORS:
        st.error(f"Enter at most {MAX_COMPETITORS} competitors.")
        st.stop()
    if not (company_name and industry and region and target_handle and competitor_handles):
        st.error("All fields are required.")
        st.stop()

    with st.status("Generating report...", expanded=True) as status:
        status.update(label="Creating analysis record...")
        analysis_id = create_analysis(company_name, industry, region)
        account_ids = register_accounts(analysis_id, target_handle, competitor_handles)

        status.update(label="Scraping Instagram data via Apify (last 30 days)...")
        run_scrape(analysis_id, account_ids)

        status.update(label="Categorizing posts with Claude...")
        classify_all(account_ids)

        status.update(label="Computing metrics...")
        accounts = supabase.table("accounts").select("*").eq("analysis_id", analysis_id).execute().data
        metrics = compute_all(accounts)

        status.update(label="Generating charts...")
        chart_paths = generate_all_charts(metrics, "output")

        status.update(label="Synthesizing SWOT and recommendations...")
        result = generate_swot_and_recommendations(company_name, industry, region, metrics)

        status.update(label="Rendering PDF...")
        pdf_path = render_report(
            analysis_id, company_name, industry, region,
            metrics, result["swot"], result["recommendations"], chart_paths,
        )

        status.update(label="Done", state="complete")

    st.success("Report generated.")
    with open(pdf_path, "rb") as f:
        st.download_button("Download PDF report", f, file_name=f"{company_name}_competitive_analysis.pdf")
