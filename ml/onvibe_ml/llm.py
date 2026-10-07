"""Schema-constrained LLM calls with cost tracking, on Gemini or Claude.

The provider is picked from the model name ("gemini-*" -> Google, anything else -> Anthropic),
so evals can compare models across providers with the same prompt and schema.
"""

import json
import threading
from dataclasses import dataclass, field
from functools import lru_cache

from .config import required

# USD per million tokens (input, output), used only to report what an eval or graph build cost.
# Gemini output includes thinking tokens. Unknown models are reported as tokens without dollars.
PRICING = {
    "gemini-3.8-flash": (0.75, 3.75),  # through 2026-12-31; $1.50 / $7.50 from 2027
    "gemini-3.5-flash": (1.50, 9.00),
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-3.1-flash-lite": (0.25, 1.50),
    "gemini-2.5-flash": (0.30, 2.50),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-5-5": (4.0, 20.0),
}

# These Claude models reject a forced tool_choice; ask for the tool in the prompt instead.
NO_FORCED_TOOL = {"claude-opus-5-5", "claude-fable-5-1", "claude-mythos-5-1"}


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add(self, input_tokens: int, output_tokens: int) -> None:
        with self._lock:
            self.input_tokens += input_tokens
            self.output_tokens += output_tokens
            self.calls += 1

    def cost_usd(self, model: str) -> float | None:
        if model not in PRICING:
            return None
        input_rate, output_rate = PRICING[model]
        return (self.input_tokens * input_rate + self.output_tokens * output_rate) / 1_000_000

    def summary(self, model: str) -> str:
        cost = self.cost_usd(model)
        cost_text = f"${cost:.3f}" if cost is not None else "cost unknown for this model"
        return f"{self.calls} calls, {self.input_tokens:,} in / {self.output_tokens:,} out tokens, {cost_text}"


def is_gemini(model: str) -> bool:
    return model.startswith("gemini")


_gemini = None
_gemini_lock = threading.Lock()


def gemini_client():
    # Created once under a lock: callers run in threads, and a duplicate Client that gets
    # garbage-collected closes the HTTP connection the surviving one is still using.
    global _gemini
    with _gemini_lock:
        if _gemini is None:
            from google import genai
            from google.genai import types

            # Free-tier rate limits are tight, so retry 429s with backoff instead of failing the batch.
            retry = types.HttpRetryOptions(attempts=6, initial_delay=2.0, max_delay=60.0)
            _gemini = genai.Client(
                api_key=required("GEMINI_API_KEY"), http_options=types.HttpOptions(retry_options=retry)
            )
        return _gemini


@lru_cache(maxsize=1)
def anthropic_client():
    import anthropic

    return anthropic.Anthropic(max_retries=4)


def call_tool(model: str, system: str, tool: dict, user_content: str, usage: Usage, max_tokens: int = 16000) -> dict:
    """Run one request whose answer must match `tool["input_schema"]`, and return that object."""
    if is_gemini(model):
        return _call_gemini(model, system, tool, user_content, usage, max_tokens)
    return _call_anthropic(model, system, tool, user_content, usage, max_tokens)


def _call_gemini(model: str, system: str, tool: dict, user_content: str, usage: Usage, max_tokens: int) -> dict:
    from google.genai import types

    response = gemini_client().models.generate_content(
        model=model,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_json_schema=tool["input_schema"],
            max_output_tokens=max_tokens,
        ),
    )
    meta = response.usage_metadata
    usage.add(
        meta.prompt_token_count or 0,
        (meta.candidates_token_count or 0) + (meta.thoughts_token_count or 0),
    )
    candidate = response.candidates[0] if response.candidates else None
    finish = candidate.finish_reason.name if candidate and candidate.finish_reason else "NONE"
    if finish == "MAX_TOKENS":
        raise RuntimeError(f"{tool['name']}: response hit max_output_tokens ({max_tokens}); use a smaller batch")
    if not response.text:
        raise RuntimeError(f"{tool['name']}: empty response from {model} (finish_reason={finish})")
    return json.loads(response.text)


def _call_anthropic(model: str, system: str, tool: dict, user_content: str, usage: Usage, max_tokens: int) -> dict:
    if model in NO_FORCED_TOOL:
        system = f"{system}\n\nRespond only by calling the {tool['name']} tool."
        tool_choice = {"type": "auto"}
    else:
        tool_choice = {"type": "tool", "name": tool["name"]}

    response = anthropic_client().messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        tools=[tool],
        tool_choice=tool_choice,
        messages=[{"role": "user", "content": user_content}],
    )
    usage.add(response.usage.input_tokens, response.usage.output_tokens)

    if response.stop_reason == "max_tokens":
        raise RuntimeError(f"{tool['name']}: response hit max_tokens ({max_tokens}); use a smaller batch")
    for block in response.content:
        if block.type == "tool_use" and block.name == tool["name"]:
            return block.input
    raise RuntimeError(f"{tool['name']}: model did not call the tool (stop_reason={response.stop_reason})")
