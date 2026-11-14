from data_classes.UserProfile import UserProfile
import json
from data_classes.Recipes import Recipe
import os
import sys
from dotenv import load_dotenv
from llm_pipeline.llm import make_client, generate_json_array

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", ".env"))


def _ingredient_name(ing) -> str:
    if isinstance(ing, dict):
        return str(ing.get("name") or ing.get("item") or "")
    if isinstance(ing, (list, tuple)):
        return str(ing[0]) if ing else ""
    return str(ing)


def normalize_ingredient(name: str) -> str:
    """Lowercase and crudely singularize so 'Tomatoes' and 'tomato' match."""
    words = name.lower().replace(",", " ").split()
    words = [w[:-2] if w.endswith("oes") else w[:-1] if w.endswith("s") and not w.endswith("ss") else w for w in words]
    return " ".join(words)


def _same_ingredient(a: str, b: str) -> bool:
    # 'chicken' matches 'chicken breast'; 'rice' must not match 'rice vinegar' only by accident,
    # so require the shorter name to be a whole-word subset of the longer one
    wa, wb = set(a.split()), set(b.split())
    return bool(wa and wb) and (wa <= wb or wb <= wa)


def analyze_meal_prep(recipes, shopping_list) -> dict:
    """Which shopping items appear in 2+ recipes, and which are never used."""
    per_recipe = [{normalize_ingredient(_ingredient_name(i)) for i in r.get("ingredients") or []} - {""} for r in recipes]
    shared, unused = [], []
    for item in shopping_list:
        key = normalize_ingredient(item)
        uses = sum(any(_same_ingredient(key, n) for n in names) for names in per_recipe)
        if uses >= 2:
            shared.append(item)
        if uses == 0:
            unused.append(item)
    return {"sharedIngredients": shared, "unusedItems": unused}


class RecipeLLM:
    def __init__(self, api_key: str = None):
        load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", ".env"))
        # Claude client (see llm_pipeline/llm.py)
        self.client = make_client(api_key)

    def build_user_prompt(self, user: UserProfile, n_recipes: int = 1, pantry_items=None, difficulty=None):
        pantry_line = f"Ingredients already in the pantry (use these first): {', '.join(pantry_items)}" if pantry_items else ""
        difficulty_line = f"Cooking skill level: {difficulty}" if difficulty else ""
        prompt = f"""
            You are a recipe generator. Create {n_recipes} recipes personalized for the following user:
            User ID: {user.user_id}
            Dietary Restrictions: {', '.join(user.dietary_restrictions) if user.dietary_restrictions else 'None'}
            Cuisine Preferences: {', '.join(user.cuisine_preferences) if user.cuisine_preferences else 'None'}
            Budget (USD): {user.budget_usd:.2f}
            Time Available (minutes): {user.time_available}
            Available Appliances: {', '.join(user.appliances) if user.appliances else 'Any'}
            {pantry_line}
            {difficulty_line}

            Guidelines:
            - Respect all dietary restrictions.
            - Stick to the listed cuisines if possible.
            - Keep ingredient costs within the budget.
            - Ensure cooking time does not exceed available time.
            - Only use listed appliances.

            Output format for each recipe:
            Title
            Ingredients: list of lists containing (name, quantity, unit)
            Procedure: a single string combining all instructions
            Appliances: list of appliances required
            Estimated Cost: float in USD
            Estimated Time: float in minutes
            Cuisine Type
            Tags: list of strings

            Return a JSON array of recipe objects using exactly these keys:
            "Title", "Ingredients", "Procedure", "Appliances", "Estimated Cost", "Estimated Time", "Cuisine Type", "Tags".
            Do not use markdown formatting.
            """
        return prompt.strip()

    def generate_recipes(self, user: UserProfile, n_recipes: int = 3, pantry_items=None, difficulty=None):
        prompt = self.build_user_prompt(user, n_recipes, pantry_items, difficulty)
        # log to stderr so stdout stays clean JSON for the Express server
        print("Thinking...", file=sys.stderr)
        raw_recipes = generate_json_array(self.client, prompt)
        return self._parse_recipe_list(raw_recipes, n_recipes)


    def build_meal_prep_prompt(self, user: UserProfile, shopping_list, n_recipes: int = 3, difficulty=None, pantry_items=None):
        pantry_line = f"Already in the pantry (free to use): {', '.join(pantry_items)}" if pantry_items else ""
        difficulty_line = f"Cooking skill level: {difficulty}" if difficulty else ""
        prompt = f"""
            You are a meal prep planner. The user bought (or will buy) the shopping list below.
            Create {n_recipes} recipes that are cooked from this ONE list so nothing is bought for a single meal.

            Shopping list: {', '.join(shopping_list)}
            {pantry_line}

            User:
            Dietary Restrictions: {', '.join(user.dietary_restrictions) if user.dietary_restrictions else 'None'}
            Cuisine Preferences: {', '.join(user.cuisine_preferences) if user.cuisine_preferences else 'None'}
            Time Available per recipe (minutes): {user.time_available}
            Available Appliances: {', '.join(user.appliances) if user.appliances else 'Any'}
            {difficulty_line}

            Meal prep rules:
            - Build the recipes mainly from shopping list items. You may add basic staples (salt, pepper, oil, water, common spices) and pantry items, nothing else.
            - Every recipe must share at least 2 main ingredients with at least one other recipe, and the recipes together should use every shopping list item.
            - Reuse the exact ingredient names from the shopping list so overlap is easy to see.
            - Prefer recipes that reheat or store well.
            - Respect all dietary restrictions, appliances and the time limit.

            Output format for each recipe:
            Title
            Ingredients: list of lists containing (name, quantity, unit)
            Procedure: a single string combining all instructions
            Appliances: list of appliances required
            Estimated Cost: float in USD
            Estimated Time: float in minutes
            Cuisine Type
            Tags: list of strings

            Return a JSON array of recipe objects using exactly these keys:
            "Title", "Ingredients", "Procedure", "Appliances", "Estimated Cost", "Estimated Time", "Cuisine Type", "Tags".
            Do not use markdown formatting.
            """
        return prompt.strip()

    def generate_meal_prep_recipes(self, user: UserProfile, shopping_list, n_recipes: int = 3, difficulty=None, pantry_items=None, max_attempts: int = 2):
        """2-3 recipes tied to one shopping list. Returns (recipes, analysis).

        Overlap and list coverage are measured in code, and the request is retried once
        if the recipes don't actually share ingredients.
        """
        n_recipes = max(2, min(n_recipes, 3))
        prompt = self.build_meal_prep_prompt(user, shopping_list, n_recipes, difficulty, pantry_items)
        best = ([], analyze_meal_prep([], shopping_list))
        for attempt in range(max_attempts):
            print(f"Planning meal prep (attempt {attempt + 1})...", file=sys.stderr)
            raw_recipes = generate_json_array(self.client, prompt)
            recipes = self._parse_recipe_list(raw_recipes, n_recipes)
            analysis = analyze_meal_prep(recipes, shopping_list)
            if len(recipes) >= 2 and analysis["sharedIngredients"]:
                return recipes, analysis
            if len(analysis["sharedIngredients"]) >= len(best[1]["sharedIngredients"]) and recipes:
                best = (recipes, analysis)
        return best

    def _parse_recipe_list(self, raw_recipes, n_recipes):
        if isinstance(raw_recipes, str):
            try:
                raw_recipes = json.loads(raw_recipes)
            except Exception as e:
                print("Failed to parse JSON:", e, file=sys.stderr)
                return []
        if not raw_recipes:
            return []
        if isinstance(raw_recipes, dict):
            raw_recipes = [raw_recipes]
        recipes = []
        for r in raw_recipes[:n_recipes]:
            try:
                recipes.append(self.parse_json(r).__dict__)
            except Exception as e:
                print("Failed to parse recipe:", e, file=sys.stderr)
        return recipes

    def parse_json(self, r: dict) -> Recipe:
        # Handle optional fields safely
        appliances = r.get("Appliances", [])
        if isinstance(appliances, str):
            appliances = [appliances]
        procedure = r.get("Procedure", "")

        return Recipe(
            title=r["Title"],
            ingredients=r["Ingredients"],
            cook_minutes=r["Estimated Time"],
            price_estimate_usd=r["Estimated Cost"],
            cuisine=r["Cuisine Type"],
            tags=r.get("Tags", []),
            appliances=appliances,
            procedure=procedure
        )
