import os

from apify_client import ApifyClient
from anthropic import Anthropic
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

APIFY_API_TOKEN = os.environ["APIFY_API_TOKEN"]
APIFY_PROFILE_ACTOR_ID = os.environ["APIFY_PROFILE_ACTOR_ID"]
APIFY_POST_ACTOR_ID = os.environ["APIFY_POST_ACTOR_ID"]

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]

MAX_COMPETITORS = 5
LOOKBACK_DAYS = 30
CLAUDE_MODEL = "claude-sonnet-5"


def get_apify_client() -> ApifyClient:
    return ApifyClient(APIFY_API_TOKEN)


def get_supabase_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_anthropic_client() -> Anthropic:
    return Anthropic(api_key=ANTHROPIC_API_KEY)
