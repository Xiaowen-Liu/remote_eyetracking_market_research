import json
from pathlib import Path

from webgaze_api.main import app


def main() -> None:
    repository_root = Path(__file__).resolve().parents[3]
    destination = repository_root / "packages" / "api-contract" / "openapi.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
    print(f"Wrote {destination.relative_to(repository_root)}")


if __name__ == "__main__":
    main()
