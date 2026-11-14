"""
Command-line entry point for the shopping list generator, for an Express route to call the same
way POST /generate_recipes calls generate_cli.py:

    const list = await runPython(path.resolve(__dirname, '../llm_pipeline/shopping_list_cli.py'), [], req.body);

Reads the request JSON on stdin (see llm_pipeline/shopping_list.py for the fields) and prints one
line of JSON to stdout: the shopping list, or {"error": "..."} with exit code 1.
Try it:
    echo '{"budget": 40, "goals": ["eat more vegetables"]}' | python llm_pipeline/shopping_list_cli.py
"""
import json
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from llm_pipeline.shopping_list import ShoppingListLLM, validate_request  # noqa: E402


def main():
    raw = sys.stdin.read()
    try:
        request = validate_request(json.loads(raw) if raw.strip() else {})
        result = ShoppingListLLM().generate(request)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
