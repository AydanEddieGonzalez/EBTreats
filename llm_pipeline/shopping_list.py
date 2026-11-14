"""
Healthy shopping list generator: budget and goals in, SNAP-eligible shopping list out.

Input (a dict, e.g. the JSON body the API route receives):
  {
    "budget": 40,                          # USD for this trip, required
    "goals": ["eat more vegetables"],      # free text from the goal chat, optional
    "householdSize": 2,                    # people eating, default 1
    "days": 7,                             # how many days the food should last, default 7
    "dietaryRestrictions": ["vegetarian"], # optional
    "allergens": ["peanut"],               # optional
    "pantryItems": ["rice", "salt"],       # already at home, so not bought again, optional
    "store": {                             # the store picked on the map, optional
      "name": "...", "type": "Supermarket",
      "hasIncentive": true, "incentiveProgram": "Fair Food Network"
    }
  }

Output (SHOPPING_LIST_SCHEMA, then cleaned up by normalize_list):
  {
    "items": [{ "name", "category", "quantity", "unit", "estimatedPrice", "snapEligible", "reason" }],
    "estimatedTotal": 31.5,     # recomputed from the items, not trusted from the model
    "budget": 40,
    "remaining": 8.5,
    "overBudget": false,
    "goalNotes": ["..."],       # how the list supports each goal
    "tips": ["..."]
  }
"""
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from llm_pipeline.gemini import generate_json, make_client  # noqa: E402

CATEGORIES = ["produce", "protein", "dairy", "grains", "pantry", "frozen", "other"]

# JSON schema the model must follow (sent to Gemini as response_json_schema).
SHOPPING_LIST_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "description": "Everything to buy, most important first.",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Plain grocery name, e.g. 'Dried black beans'."},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "quantity": {"type": "number", "description": "How many units to buy."},
                    "unit": {"type": "string", "description": "e.g. 'lb', 'bag', 'dozen', 'can', 'each'."},
                    "estimatedPrice": {"type": "number", "description": "Total USD for this line (quantity x unit price)."},
                    "snapEligible": {"type": "boolean"},
                    "reason": {"type": "string", "description": "One short sentence: why this item, tied to a goal if possible."},
                },
                "required": ["name", "category", "quantity", "unit", "estimatedPrice", "snapEligible", "reason"],
            },
        },
        "estimatedTotal": {"type": "number"},
        "goalNotes": {
            "type": "array",
            "items": {"type": "string"},
            "description": "One note per goal on how the list supports it.",
        },
        "tips": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Up to 3 short money-saving or storage tips.",
        },
    },
    "required": ["items", "estimatedTotal", "goalNotes", "tips"],
}


def _clean_list(values):
    if not values:
        return []
    if isinstance(values, str):
        values = [values]
    return [str(v).strip() for v in values if str(v).strip()]


def _store_line(store):
    if not store or not store.get("name"):
        return "Store: not chosen yet; assume a typical US supermarket."
    line = f"Store: {store['name']}"
    if store.get("type"):
        line += f" ({store['type']})"
    line += ". Only include things this kind of store is likely to sell."
    if store.get("hasIncentive"):
        run_by = f" (run by {store['incentiveProgram']})" if store.get("incentiveProgram") else ""
        line += (
            f" This store has a SNAP fruit and vegetable incentive program{run_by}: SNAP purchases "
            "of fresh fruits and vegetables earn extra money back, so lean the list toward fresh produce."
        )
    return line


def build_prompt(request: dict) -> str:
    budget = float(request["budget"])
    household = int(request.get("householdSize") or 1)
    days = int(request.get("days") or 7)
    goals = _clean_list(request.get("goals"))
    restrictions = _clean_list(request.get("dietaryRestrictions"))
    allergens = _clean_list(request.get("allergens"))
    pantry = _clean_list(request.get("pantryItems"))

    goals_text = "\n".join(f"- {g}" for g in goals) if goals else "- Eat healthier in general"

    return f"""
You are a nutrition-minded grocery planner for a household that pays with SNAP (EBT).
Build one shopping list for a single store trip.

Household
- Budget for this trip: ${budget:.2f} (hard limit)
- People eating: {household}
- The food should cover about {days} days of home cooking (it does not need to cover every meal).
- Dietary restrictions: {', '.join(restrictions) if restrictions else 'None'}
- Allergies (never include these or anything containing them): {', '.join(allergens) if allergens else 'None'}
- Already at home, do not buy again: {', '.join(pantry) if pantry else 'Nothing listed'}
- {_store_line(request.get('store'))}

Health goals
{goals_text}

Rules
1. SNAP-eligible food only: no hot or ready-to-eat prepared food, alcohol, tobacco, vitamins or
   supplements, pet food, or non-food items (soap, paper towels). Set snapEligible to true only
   when the item qualifies.
2. Keep estimatedTotal at or below ${budget * 0.95:.2f} (95% of the budget) so price differences
   between stores do not push the user over budget.
3. Use realistic current US grocery prices for store brands. estimatedPrice is the price for the
   whole line (quantity times unit price).
4. Build a balanced list: about half the spending on fruits and vegetables (fresh, frozen or
   canned with no added salt or sugar), then lean proteins (beans, lentils, eggs, chicken,
   canned fish), whole grains, and low-fat dairy if the diet allows it.
5. Stretch the budget: prefer dried beans, oats, brown rice, frozen vegetables, bananas,
   carrots, cabbage, eggs and other low-cost staples over expensive or pre-cut items.
   No sugary drinks, candy or chips.
6. Pick ingredients that combine into a few simple meals and share ingredients, so nothing is wasted.
7. Every item's reason is one short sentence, tied to a health goal when possible.
8. goalNotes has one note per health goal saying how the list supports it. tips has at most 3
   short, practical tips.

Return only JSON that matches the provided schema. Do not use markdown.
""".strip()


def _to_number(value, default=0.0):
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return default


def normalize_list(raw, budget: float) -> dict:
    """Coerce model output into the documented shape and recompute the total."""
    if isinstance(raw, list):  # model returned only the items array
        raw = {"items": raw}
    if not isinstance(raw, dict):
        raw = {}

    items = []
    for item in raw.get("items") or []:
        if not isinstance(item, dict) or not str(item.get("name", "")).strip():
            continue
        if item.get("snapEligible") is False:
            continue  # never show an item the user cannot buy with EBT
        category = str(item.get("category", "other")).lower()
        items.append({
            "name": str(item["name"]).strip(),
            "category": category if category in CATEGORIES else "other",
            "quantity": _to_number(item.get("quantity"), 1.0),
            "unit": str(item.get("unit") or "each").strip(),
            "estimatedPrice": max(_to_number(item.get("estimatedPrice")), 0.0),
            "snapEligible": True,
            "reason": str(item.get("reason") or "").strip(),
        })

    total = round(sum(i["estimatedPrice"] for i in items), 2)
    budget = round(float(budget), 2)
    return {
        "items": items,
        "estimatedTotal": total,
        "budget": budget,
        "remaining": round(budget - total, 2),
        "overBudget": total > budget,
        "goalNotes": _clean_list(raw.get("goalNotes")),
        "tips": _clean_list(raw.get("tips"))[:3],
    }


def validate_request(request: dict) -> dict:
    if not isinstance(request, dict):
        raise ValueError("Request must be a JSON object")
    try:
        budget = float(request.get("budget"))
    except (TypeError, ValueError):
        raise ValueError("budget is required and must be a number")
    if budget <= 0:
        raise ValueError("budget must be greater than 0")
    return {**request, "budget": budget}


class ShoppingListLLM:
    def __init__(self, api_key: str = None, client=None):
        # client can be a fake in tests
        self.client = client if client is not None else make_client(api_key)

    def generate(self, request: dict) -> dict:
        request = validate_request(request)
        prompt = build_prompt(request)
        # log to stderr so stdout stays clean JSON for the Express server
        print("Building shopping list...", file=sys.stderr)
        raw = generate_json(self.client, prompt, SHOPPING_LIST_SCHEMA)
        return normalize_list(raw or {}, request["budget"])
