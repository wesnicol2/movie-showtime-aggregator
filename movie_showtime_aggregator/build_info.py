"""Identify the exact code deployed by a Test/Production image.

CI bakes the commit and its timestamp into the Docker image. No Git checkout
is included in the image. Local checkout fallback is best effort only.
"""

import functools
import os
import subprocess
from pathlib import Path

UNKNOWN = "unknown"
_REPO_ROOT = Path(__file__).resolve().parent.parent


def _git(*args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=_REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def _from_git() -> dict | None:
    if not (_REPO_ROOT / ".git").exists():
        return None
    commit = _git("rev-parse", "HEAD")
    if not commit:
        return None
    return {
        "commit": commit,
        "dirty": bool(_git("status", "--porcelain")),
        "source": "git",
        "branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
        "commit_at": _git("show", "-s", "--format=%cI", "HEAD"),
    }


def _from_env() -> dict | None:
    commit = (os.getenv("APP_COMMIT") or "").strip()
    if not commit or commit == UNKNOWN:
        return None
    return {
        "commit": commit,
        "dirty": False,
        "source": "image",
        "branch": (os.getenv("APP_BRANCH") or "").strip() or None,
        "commit_at": (os.getenv("APP_COMMIT_AT") or "").strip() or None,
    }


@functools.cache
def build_info() -> dict:
    """Report verifiable build provenance, never a guessed SHA or timestamp."""
    info = _from_env() or _from_git() or {
        "commit": UNKNOWN,
        "dirty": False,
        "source": UNKNOWN,
        "branch": None,
        "commit_at": None,
    }
    commit = info["commit"]
    info["commit_short"] = commit[:7] if commit != UNKNOWN else UNKNOWN
    info["image_tag"] = (os.getenv("APP_IMAGE_TAG") or "").strip() or None
    info["built_at"] = (os.getenv("APP_BUILT_AT") or "").strip() or None
    return info
