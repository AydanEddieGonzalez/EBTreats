"""
Goal chat: a short coaching conversation that turns what the user says into a few concrete,
food-shopping health goals. The goals are saved to the user profile and later passed to the
shopping list generator (llm_pipeline/shopping_list.py) as "goals".

Input:
  {
    "messages": [                      # the conversation so far, oldest first; last one is the user's
      {"role": "user", "text": "I want to lose weight but I love soda"},
      {"role": "assistant", "text": "..."}
    ],
    "goals": ["Eat more vegetables"],  # goals already saved on the profile, optional
    "profile": {                       # optional context from the profile
      "dietaryRestrictions": ["vegetarian"], "budget": 40
    }
  }

Output (GOAL_CHAT_SCHEMA, cleaned up by normalize_reply):
  {
    "reply": "...",                    # what the coach says next
    "goals": ["Swap soda for water or seltzer", "Eat more vegetables"],  # the full updated list
    "done": false                      # true once the goals are clear and the user seems happy
  }
"""
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from llm_pipeline.gemini import generate_json, make_client  # noqa: E402

MAX_GOALS = 5
MAX_GOAL_LENGTH = 80
MAX_MESSAGES = 20         # only the most recent turns are sent to the model
MAX_MESSAGE_LENGTH = 2000

GOAL_CHAT_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {
            "type": "string",
            "description": "The coach's next message to the user. Under 80 words.",
        },
        "goals": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": MAX_GOALS,
            "description": "The user's complete, updated list of health goals, most important first.",
        },
        "done": {
            "type": "boolean",
            "description": "True when the goals are clear and the user has nothing more to add.",
        },
    },
    "required": ["reply", "goals", "done"],
}


def _clean_list(values):
    if not values:
        return []
    if isinstance(values, str):
        values = [values]
    return [str(v).strip() for v in values if str(v).strip()]


def validate_request(request: dict) -> dict:
    if not isinstance(request, dict):
        raise ValueError("Request must be a JSON object")
    messages = []
    for m in request.get("messages") or []:
        if not isinstance(m, dict):
            continue
        role = "assistant" if m.get("role") in ("assistant", "model", "coach") else "user"
        text = str(m.get("text") or m.get("content") or "").strip()[:MAX_MESSAGE_LENGTH]
        if text:
            messages.append({"role": role, "text": text})
    if not messages or messages[-1]["role"] != "user":
        raise ValueError("messages must be a non-empty list ending with a user message")
    return {
        "messages": messages[-MAX_MESSAGES:],
        "goals": _clean_list(request.get("goals"))[:MAX_GOALS],
        "profile": request.get("profile") if isinstance(request.get("profile"), dict) else {},
    }


def build_prompt(request: dict) -> str:
    goals = request["goals"]
    profile = request["profile"]
    restrictions = _clean_list(profile.get("dietaryRestrictions"))
    budget = profile.get("budget")

    goals_text = "\n".join(f"- {g}" for g in goals) if goals else "- (none yet)"
    context = []
    if restrictions:
        context.append(f"Dietary restrictions: {', '.join(restrictions)}")
    if budget:
        context.append(f"Usual grocery budget per trip: ${float(budget):.2f}")
    context_text = "\n".join(context) if context else "Nothing else known."
    conversation = "\n".join(
        f"{'Coach' if m['role'] == 'assistant' else 'User'}: {m['text']}" for m in request["messages"]
    )

    return f"""
You are a friendly, practical nutrition coach inside EBTreats, an app that helps families who
shop with SNAP (EBT) buy healthy food on a budget. Your job in this chat is to understand the
user's health goals and turn them into a short list of concrete goals that can guide a grocery list.

What you know about the user
{context_text}

Goals saved so far
{goals_text}

Conversation so far
{conversation}

How to respond
1. reply: answer the user's last message warmly and briefly (under 80 words, plain language, no
   markdown, no lists). Ask at most one follow-up question, and only if it would change the goals
   (for example who they shop for, a health condition, foods they dislike). Reply in the user's language.
2. goals: return the full updated list, at most {MAX_GOALS}, most important first.
   - Keep saved goals unless the user changes or drops them. Add goals only from what the user
     actually said or clearly agreed to; never invent goals.
   - Write each goal as a short action about food or shopping, under {MAX_GOAL_LENGTH} characters,
     e.g. "Swap soda for water or seltzer", "Eat a vegetable with every dinner", "Choose whole grains".
   - Merge duplicates. If the user says something vague like "eat better", ask what that means to
     them instead of guessing.
3. Health conditions: you can suggest food habits that commonly help (for example less added sugar
   for diabetes), but do not diagnose, name medicines or promise results. If the user mentions a
   condition, suggest checking with their doctor once.
4. Off-topic messages: answer in one sentence and steer back to food goals. Never ask for
   personal details like their full name, address, income or EBT card number.
5. done: true only when the goals are clear and the user has said they are happy or has nothing to add.

Return only JSON matching the provided schema.
""".strip()


def normalize_reply(raw, fallback_goals) -> dict:
    if not isinstance(raw, dict):
        raw = {}
    goals = []
    seen = set()
    for g in _clean_list(raw.get("goals")):
        g = g[:MAX_GOAL_LENGTH].rstrip(" .")
        key = g.lower()
        if key not in seen:
            seen.add(key)
            goals.append(g)
    reply = str(raw.get("reply") or "").strip()
    if not reply:
        # model returned nothing usable: keep the saved goals rather than wiping them
        return {
            "reply": "Sorry, I didn't catch that. Could you tell me a bit more about your goals?",
            "goals": fallback_goals,
            "done": False,
        }
    return {"reply": reply, "goals": goals[:MAX_GOALS], "done": bool(raw.get("done"))}


class GoalChatLLM:
    def __init__(self, api_key: str = None, client=None):
        # client can be a fake in tests
        self.client = client if client is not None else make_client(api_key)

    def chat(self, request: dict) -> dict:
        request = validate_request(request)
        print("Goal chat...", file=sys.stderr)
        raw = generate_json(self.client, build_prompt(request), GOAL_CHAT_SCHEMA)
        return normalize_reply(raw, request["goals"])
