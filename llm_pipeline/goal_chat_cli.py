"""
Command-line entry point for the goal chat, called by POST /goal-chat (backend/goalChat.js).

Reads the request JSON on stdin (see llm_pipeline/goal_chat.py for the fields) and prints one
line of JSON to stdout: { reply, goals, done }, or {"error": "..."} with exit code 1.
Try it:
    echo '{"messages":[{"role":"user","text":"I want to cut back on sugar"}]}' | python llm_pipeline/goal_chat_cli.py
"""
import json
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from llm_pipeline.goal_chat import GoalChatLLM, validate_request  # noqa: E402


def main():
    raw = sys.stdin.read()
    try:
        request = validate_request(json.loads(raw) if raw.strip() else {})
        result = GoalChatLLM().chat(request)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
