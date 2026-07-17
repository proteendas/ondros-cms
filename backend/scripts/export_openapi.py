"""Export the OpenAPI 3 spec for all API planes to openapi.json.

Run:  docker compose exec backend python -m scripts.export_openapi
      (or locally: cd backend && python -m scripts.export_openapi)
"""
import json
from pathlib import Path

from app.main import app


def main() -> None:
    spec = app.openapi()
    out = Path(__file__).resolve().parents[1] / "openapi.json"
    out.write_text(json.dumps(spec, indent=2, default=str))
    print(f"OpenAPI {spec.get('openapi')} spec with {len(spec.get('paths', {}))} paths -> {out}")


if __name__ == "__main__":
    main()
