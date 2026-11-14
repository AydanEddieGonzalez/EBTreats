"""
Shared Claude helpers for the JSON-producing pipelines (shopping list, goal chat, recipes).

Settings in backend/.env: ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_FALLBACK_MODELS (comma-separated).
generate_json() asks Claude to answer through a "respond" tool whose input matches a schema, and
falls back to the next model when one is busy (5xx/529), rate-limited (429) or unknown (404).
"""
import json
import os
import sys

from dotenv import load_dotenv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(ROOT, "backend", ".env"))

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5")
CLAUDE_FALLBACK_MODELS = [
    m.strip()
    for m in os.getenv("CLAUDE_FALLBACK_MODELS", "claude-haiku-5-5").split(",")
    if m.strip()
]
CLAUDE_MAX_TOKENS = 8000
REQUEST_TIMEOUT_S = 45


class ClaudeAPIError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(f"{status_code}: {message}")
        self.status_code = status_code


class ClaudeConnectionError(Exception):
    pass


class ClaudeClient:
    """Minimal Claude Messages API client using only the standard library.

    No SDK on purpose: the anthropic package ships compiled files that Windows
    Smart App Control can block, and this needs nothing beyond Python itself.
    """

    API_URL = "https://api.anthropic.com/v1/messages"
    API_VERSION = "2023-06-01"

    def __init__(self, api_key: str, timeout_s: float = REQUEST_TIMEOUT_S):
        self.api_key = api_key
        self.timeout_s = timeout_s

    def create_message(self, **body) -> dict:
        import urllib.error
        import urllib.request

        request = urllib.request.Request(
            self.API_URL,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": self.API_VERSION,
                "content-type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(detail).get("error", {}).get("message", detail)
            except Exception:
                pass
            raise ClaudeAPIError(e.code, detail) from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise ClaudeConnectionError(str(e)) from None


def make_client(api_key: str = None) -> ClaudeClient:
    key = api_key or os.getenv("ANTHROPIC_API_KEY")
    if not key:
        raise ValueError("Missing ANTHROPIC_API_KEY. Put it in backend/.env.")
    return ClaudeClient(key)


def _claude_result(message: dict):
    """The respond tool's input, or JSON parsed from a plain text reply."""
    content = message.get("content") or []
    for block in content:
        if block.get("type") == "tool_use":
            return block.get("input")
    text = "".join(b.get("text", "") for b in content if b.get("type") == "text").strip()
    starts = [i for i in (text.find("{"), text.find("[")) if i != -1]
    if not starts:
        return None
    start = min(starts)
    end = text.rfind("}" if text[start] == "{" else "]")
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


def call_claude(client: ClaudeClient, prompt: str, schema: dict):
    """Return the structured answer for `schema`, trying each Claude model in turn."""
    tool = {
        "name": "respond",
        "description": "Return the answer in exactly this structure.",
        "input_schema": schema,
    }
    models = [CLAUDE_MODEL] + [m for m in CLAUDE_FALLBACK_MODELS if m != CLAUDE_MODEL]
    last_error = None
    for model in models:
        try:
            # tool_choice "auto": newer models reject forcing a specific tool
            message = client.create_message(
                model=model,
                max_tokens=CLAUDE_MAX_TOKENS,
                messages=[{"role": "user", "content": prompt + "\n\nGive your answer by calling the respond tool."}],
                tools=[tool],
                tool_choice={"type": "auto"},
            )
            result = _claude_result(message)
            if result is None:
                print(f"{model} returned no structured answer", file=sys.stderr)
            return result
        except ClaudeAPIError as e:
            if e.status_code not in (404, 429, 500, 502, 503, 529):
                raise
            last_error = e
        except ClaudeConnectionError as e:
            last_error = e
        print(f"{model} unavailable ({last_error}), trying next model", file=sys.stderr)
    raise RuntimeError(f"All Claude models are unavailable right now: {last_error}")


def generate_json(client, prompt: str, schema: dict):
    """Return the structured answer as a dict, or None if Claude gave none."""
    return call_claude(client, prompt, schema)


def generate_json_array(client, prompt: str, key: str = "recipes"):
    """Return a list of objects (used for recipes), or None if Claude gave none."""
    schema = {
        "type": "object",
        "properties": {key: {"type": "array", "items": {"type": "object"}}},
        "required": [key],
    }
    result = call_claude(client, prompt, schema)
    if isinstance(result, list):
        return result
    return (result or {}).get(key)
