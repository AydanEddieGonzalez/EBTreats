from data_classes.UserProfile import UserProfile
from data_classes.Recipes import Recipe
from llm_pipeline.llm_recipe_generator import RecipeLLM
import json

INGREDIENT_THRESHOLD = 0.75
NUM_RECIPES = 5

class Validator:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.recipeLLM = RecipeLLM(api_key)

    def regenerate_recipes(self, user: UserProfile):
        return self.recipeLLM.generate_recipes(user)

    def validate(self, user: UserProfile, recipes: list[Recipe]):
        valid = [r for r in recipes if self.is_valid_recipe(user, r)]
        attempts = 0
        # regenerate_recipes returns a list; cap retries so a strict diet can't loop forever
        while len(valid) < NUM_RECIPES and attempts < 3:
            attempts += 1
            for new_recipe in self.regenerate_recipes(user):
                if self.is_valid_recipe(user, new_recipe):
                    valid.append(new_recipe)
        return valid[:NUM_RECIPES]

    def is_valid_recipe(self, user: UserProfile, recipe):
        if not user.dietary_restrictions:
            return True
        ingredients = recipe.get("ingredients") if isinstance(recipe, dict) else recipe.ingredients
        client = self.recipeLLM.client
        prompt = f"""
        Return JSON:
        {{
            "valid": boolean
        }}
        Does the recipe contain ANY ingredient that violates the user's dietary restrictions?
        "valid" must be true ONLY if no ingredient violates the restrictions.
        Recipe ingredients: {ingredients}
        User restrictions: {user.dietary_restrictions}
        Output ONLY JSON.
        """
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        try:
            result = json.loads(response.text)
            return bool(result.get("valid", False))
        except Exception:
            print("VALIDATION JSON ERROR:", response.text)
            return False
