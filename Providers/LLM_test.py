"""Quick check that the Claude key in backend/.env works. Run from the repo root:
    python -m Providers.LLM_test
"""
from llm_pipeline.llm import make_client, generate_json

if __name__ == "__main__":
    answer = generate_json(
        make_client(),
        "Suggest one cheap healthy recipe title.",
        {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]},
    )
    print(answer)
