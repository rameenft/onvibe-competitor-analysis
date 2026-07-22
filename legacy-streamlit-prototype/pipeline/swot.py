import json

from pipeline.config import CLAUDE_MODEL, get_anthropic_client

anthropic = get_anthropic_client()

SWOT_TOOL = {
    "name": "produce_swot_and_recommendations",
    "description": "Produce a data-grounded SWOT analysis and categorized recommendations for the target account.",
    "input_schema": {
        "type": "object",
        "properties": {
            "swot": {
                "type": "object",
                "properties": {
                    "strengths": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
                    "weaknesses": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
                    "opportunities": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
                    "threats": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
                },
                "required": ["strengths", "weaknesses", "opportunities", "threats"],
            },
            "recommendations": {
                "type": "object",
                "properties": {
                    "keep_doing": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
                    "urgent": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
                    "mid_term": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
                    "long_term": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
                },
                "required": ["keep_doing", "urgent", "mid_term", "long_term"],
            },
        },
        "required": ["swot", "recommendations"],
    },
}

SYSTEM_PROMPT = """You are writing the SWOT and recommendations sections of an Instagram
competitive analysis report. Every point must cite a specific metric, percentile, or named
competitor comparison from the data provided — never generic commentary. If a metric is
unavailable (e.g. growth rate), say so explicitly rather than guessing or omitting the topic.
Each recommendation must name the metric it targets. Keep each bullet to one or two sentences."""


def generate_swot_and_recommendations(company_name: str, industry: str, region: str, metrics: dict) -> dict:
    message = anthropic.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[SWOT_TOOL],
        tool_choice={"type": "tool", "name": "produce_swot_and_recommendations"},
        messages=[{
            "role": "user",
            "content": (
                f"Company: {company_name}\nIndustry: {industry}\nRegion: {region}\n\n"
                f"Metrics (last 30 days, target + up to 5 competitors):\n"
                f"{json.dumps(metrics, indent=2)}"
            ),
        }],
    )
    tool_call = next(block for block in message.content if block.type == "tool_use")
    return tool_call.input
