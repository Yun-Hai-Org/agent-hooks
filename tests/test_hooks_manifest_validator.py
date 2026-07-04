"""Tests for hooks_manifest_validator."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.lib.hooks_manifest_validator import (
    load_json,
    main,
    validate_hooks_manifest,
)


@pytest.fixture
def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def test_validate_real_manifest_passes(repo_root: Path) -> None:
    manifest = repo_root / ".cursor" / "hooks-manifest.json"
    hooks = repo_root / ".cursor" / "hooks.json.example"

    errors = validate_hooks_manifest(manifest, hooks)

    assert errors == []


def test_load_json_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    path.write_text(json.dumps({"a": 1}), encoding="utf-8")

    assert load_json(path) == {"a": 1}


def test_missing_required_token(tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.json"
    hooks = tmp_path / "hooks.json"
    manifest.write_text(
        json.dumps({"requiredCommandTokens": ["missing-token"], "requiredEvents": []}),
        encoding="utf-8",
    )
    hooks.write_text(json.dumps({"hooks": {}}), encoding="utf-8")

    errors = validate_hooks_manifest(manifest, hooks)

    assert len(errors) == 1
    assert "missing-token" in errors[0]


def test_missing_required_event(tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.json"
    hooks = tmp_path / "hooks.json"
    manifest.write_text(
        json.dumps({"requiredCommandTokens": [], "requiredEvents": ["stop"]}),
        encoding="utf-8",
    )
    hooks.write_text(json.dumps({"hooks": {}}), encoding="utf-8")

    errors = validate_hooks_manifest(manifest, hooks)

    assert len(errors) == 1
    assert "stop" in errors[0]


def test_main_usage() -> None:
    assert main([]) == 2


def test_main_missing_manifest(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    hooks = tmp_path / "hooks.json"
    hooks.write_text("{}", encoding="utf-8")

    assert main([str(tmp_path / "missing.json"), str(hooks)]) == 1
    assert "missing" in capsys.readouterr().err


def test_main_missing_hooks(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    manifest = tmp_path / "manifest.json"
    manifest.write_text("{}", encoding="utf-8")

    assert main([str(manifest), str(tmp_path / "missing.json")]) == 1
    assert "missing" in capsys.readouterr().err


def test_main_success(tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.json"
    hooks = tmp_path / "hooks.json"
    manifest.write_text(
        json.dumps({"requiredCommandTokens": [], "requiredEvents": []}),
        encoding="utf-8",
    )
    hooks.write_text(json.dumps({"hooks": {}}), encoding="utf-8")

    assert main([str(manifest), str(hooks)]) == 0


def test_main_validation_errors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = tmp_path / "manifest.json"
    hooks = tmp_path / "hooks.json"
    manifest.write_text(
        json.dumps({"requiredCommandTokens": ["tok"], "requiredEvents": []}),
        encoding="utf-8",
    )
    hooks.write_text(json.dumps({"hooks": {}}), encoding="utf-8")

    assert main([str(manifest), str(hooks)]) == 1
    assert "tok" in capsys.readouterr().err
