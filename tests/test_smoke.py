"""Smoke tests: every agent module must at least compile.

This catches SyntaxErrors (like a duplicated elif-after-else block)
before they reach the hourly GitHub Actions run.
"""
import py_compile
from pathlib import Path

import pytest

AGENT_DIR = Path(__file__).parent.parent / 'agent'
PY_FILES = sorted(AGENT_DIR.rglob('*.py'))


@pytest.mark.parametrize('path', PY_FILES, ids=lambda p: str(p.relative_to(AGENT_DIR)))
def test_module_compiles(path: Path):
    py_compile.compile(str(path), doraise=True)


def test_found_modules():
    # Sanity: make sure the glob actually found the codebase
    names = {p.name for p in PY_FILES}
    assert 'main.py' in names and 'business_rules.py' in names
