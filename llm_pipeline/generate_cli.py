"""
Entry point for POST /generate_recipes in backend/api_call.js.

Reads a JSON payload on stdin:
  { username, pantryItems, time, difficulty, budget, allergens, appliances, cuisines }
Prints one line of JSON to stdout: a list of recipes in the shape the React Generate page renders:
  { name, ingredients: [{item, amount, unit}], instructions: [str], appliances, budget, time, cuisine, tags }
All logging goes to stderr so stdout stays parseable.
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(ROOT)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(ROOT, "backend", ".env"))

from data_classes.UserProfile import UserProfile  # noqa: E402
from llm_pipeline.llm_recipe_generator import RecipeLLM  # noqa: E402

N_RECIPES = 5


def to_frontend(recipe: dict) -> dict:
    ingredients = []
    for ing in recipe.get("ingredients") or []:
        if isinstance(ing, dict):
            name = ing.get("name") or ing.get("item") or ""
            qty = ing.get("quantity") or ing.get("amount") or ""
            unit = ing.get("unit") or ""
        elif isinstance(ing, (list, tuple)):
            name, qty, unit = (list(ing) + ["", "", ""])[:3]
        else:
            name, qty, unit = str(ing), "", ""
        ingredients.append({"item": str(name), "amount": str(qty), "unit": str(unit)})

    procedure = recipe.get("procedure") or ""
    if isinstance(procedure, list):
        instructions = [str(step) for step in procedure]
    else:
        # split the single procedure string into steps on sentence ends or numbered steps
        parts = re.split(r"(?:(?<=[.!?])\s+)|(?:\s*\d+[.)]\s+)", str(procedure))
        instructions = [p.strip() for p in parts if p and p.strip()]

    return {
        "name": recipe.get("title", "Untitled recipe"),
        "ingredients": ingredients,
        "instructions": instructions,
        "appliances": list(recipe.get("appliances") or []),
        "budget": recipe.get("price_estimate_usd", 0),
        "time": recipe.get("cook_minutes", 0),
        "cuisine": recipe.get("cuisine"),
        "tags": list(recipe.get("tags") or []),
    }


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}

    # allergens become dietary restrictions ("No peanut")
    restrictions = {f"No {a.lower()}" for a in payload.get("allergens") or []}
    user = UserProfile(
        dietary_restrictions=restrictions,
        cuisine_preferences=payload.get("cuisines") or [],
        budget_usd=float(payload.get("budget") or 0),
        time_available=int(payload.get("time") or 60),
        appliances=set(payload.get("appliances") or []),
    )

    llm = RecipeLLM()
    recipes = llm.generate_recipes(
        user,
        n_recipes=N_RECIPES,
        pantry_items=payload.get("pantryItems") or [],
        difficulty=payload.get("difficulty"),
    )
    print(json.dumps([to_frontend(r) for r in recipes]))


if __name__ == "__main__":
    main()
