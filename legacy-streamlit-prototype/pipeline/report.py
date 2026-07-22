from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML

from pipeline.config import get_supabase_client

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"
OUTPUT_DIR = Path(__file__).parent.parent / "output"

supabase = get_supabase_client()


def render_report(analysis_id: str, company_name: str, industry: str, region: str,
                   metrics: dict, swot: dict, recommendations: dict, chart_paths: dict[str, str]) -> str:
    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))
    template = env.get_template("report_template.html")

    html = template.render(
        company_name=company_name,
        industry=industry,
        region=region,
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        accounts=metrics["accounts"],
        swot=swot,
        recommendations=recommendations,
        chart_followers_vs_engagement=chart_paths["followers_vs_engagement"],
        chart_volume_vs_quality=chart_paths["volume_vs_quality"],
        chart_category_performance=chart_paths["category_performance"],
    )

    pdf_path = OUTPUT_DIR / f"{analysis_id}.pdf"
    HTML(string=html, base_url=str(TEMPLATE_DIR)).write_pdf(str(pdf_path))

    supabase.table("analysis_reports").insert({
        "analysis_id": analysis_id,
        "metrics": metrics,
        "swot": swot,
        "recommendations": recommendations,
        "pdf_path": str(pdf_path),
    }).execute()
    supabase.table("analyses").update({"status": "done"}).eq("id", analysis_id).execute()

    return str(pdf_path)
