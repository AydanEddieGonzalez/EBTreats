"""
Shared Gemini helpers for the JSON-producing pipelines (shopping list, goal chat).

- make_client(): one attempt per request with a hard timeout. The SDK's default retries on a
  busy model can stall for minutes.
- generate_json(): asks for JSON matching a schema and falls back to the next model when one is
  overloaded (5xx), retired (404), rate-limited (429) or times out.

Models are set in backend/.env: GEMINI_MODEL, then GEMINI_FALLBACK_MODELS (comma-separated).
"""
import json
import os
import sys

from dotenv import load_dotenv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(ROOT, "backend", ".env"))

# Google retires old models for new users, so keep these configurable
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
FALLBACK_MODELS = [
    m.strip()
    for m in os.getenv("GEMINI_FALLBACK_MODELS", "gemini-3.6-flash,gemini-3.5-flash").split(",")
    if m.strip()
]
REQUEST_TIMEOUT_MS = 45_000
# A busy model can stall ~40 s before erroring, so every model but the last gets less time.
# A normal response takes 2-10 s.
FALLBACK_AFTER_MS = 12_000


def make_client(api_key: str = None):
    from google import genai
    from google.genai import types

    key = api_key or os.getenv("MY_API_KEY")
    if not key:
        raise ValueError("Missing MY_API_KEY (Gemini). Put it in backend/.env.")
    return genai.Client(
        api_key=key,
        http_options=types.HttpOptions(
            timeout=REQUEST_TIMEOUT_MS,
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
    )


def _is_timeout(e: Exception) -> bool:
    return "timeout" in type(e).__name__.lower() or "timed out" in str(e).lower()


def call_model(client, prompt: str, schema: dict):
    """Return the raw Gemini response, trying each model in turn."""
    from google.genai import errors, types

    models = [GEMINI_MODEL] + [m for m in FALLBACK_MODELS if m != GEMINI_MODEL]
    last_error = None
    for i, model in enumerate(models):
        is_last = i == len(models) - 1
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=schema,
            thinking_config=types.ThinkingConfig(thinking_level="low"),
            http_options=types.HttpOptions(
                timeout=REQUEST_TIMEOUT_MS if is_last else FALLBACK_AFTER_MS,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )
        try:
            return client.models.generate_content(model=model, contents=prompt, config=config)
        except errors.ServerError as e:  # 5xx, e.g. 503 "high demand"
            last_error = e
        except errors.ClientError as e:  # 404 retired model or 429 rate limit: try the next one
            if e.code not in (404, 429):
                raise
            last_error = e
        except Exception as e:
            if not _is_timeout(e):
                raise
            last_error = e
        print(f"{model} unavailable ({last_error}), trying next model", file=sys.stderr)
    raise RuntimeError(f"All Gemini models are unavailable right now: {last_error}")


def generate_json(client, prompt: str, schema: dict):
    """Return the parsed JSON from the model, or None if it was not valid JSON."""
    response = call_model(client, prompt, schema)
    try:
        return json.loads(response.text)
    except Exception as e:
        print("Failed to parse model JSON:", e, file=sys.stderr)
        return None
