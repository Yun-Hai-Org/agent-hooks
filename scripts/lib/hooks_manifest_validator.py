"""Validate .cursor/hooks.json.example against hooks-manifest.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    """Load JSON from *path*."""
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def validate_hooks_manifest(
    manifest_path: Path,
    hooks_path: Path,
) -> list[str]:
    """Return validation error messages; empty list means success."""
    manifest = load_json(manifest_path)
    hooks_doc = load_json(hooks_path)
    content = hooks_path.read_text(encoding="utf-8")

    errors: list[str] = []

    for token in manifest.get("requiredCommandTokens", []):
        if token not in content:
            errors.append(
                f"error: hooks.json.example missing required token: {token}",
            )

    hooks = hooks_doc.get("hooks", {})
    for event in manifest.get("requiredEvents", []):
        entries = hooks.get(event)
        if not isinstance(entries, list) or len(entries) == 0:
            errors.append(f"error: hooks.json.example missing required event: {event}")

    return errors


def main(argv: list[str] | None = None) -> int:
    """CLI entry: validate manifest vs hooks.json.example."""
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 2:
        print(
            "usage: hooks_manifest_validator.py MANIFEST hooks.json.example",
            file=sys.stderr,
        )
        return 2

    manifest_path = Path(args[0])
    hooks_path = Path(args[1])

    if not manifest_path.is_file():
        print(f"error: missing {manifest_path}", file=sys.stderr)
        return 1

    if not hooks_path.is_file():
        print(f"error: missing {hooks_path}", file=sys.stderr)
        return 1

    errors = validate_hooks_manifest(manifest_path, hooks_path)
    for message in errors:
        print(message, file=sys.stderr)

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
