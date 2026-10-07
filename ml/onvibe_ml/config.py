import json
import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
ML_ROOT = REPO_ROOT / "ml"
DATA_DIR = ML_ROOT / "data"
REPORTS_DIR = ML_ROOT / "reports"
CACHE_DIR = ML_ROOT / ".cache"

# Same env file the TypeScript worker reads (lib/config.ts). Values already in
# the environment (e.g. GitHub Actions secrets) win, matching dotenv's default.
load_dotenv(REPO_ROOT / ".env.local", override=False)


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def supabase_config() -> tuple[str, str]:
    return required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY")


def default_model() -> str:
    """ML_MODEL if set; otherwise Gemini when a Gemini key is configured, else the worker's Claude model."""
    if os.environ.get("ML_MODEL"):
        return os.environ["ML_MODEL"]
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
    return os.environ.get("CLAUDE_MODEL", "claude-sonnet-5")


def load_classify_prompt() -> dict:
    """The production classifier prompt, shared with worker/pipeline/classify.ts."""
    return json.loads((REPO_ROOT / "prompts" / "classify.json").read_text())
