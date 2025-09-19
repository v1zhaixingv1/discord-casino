#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

REMOTE="${GIT_REMOTE:-origin}"
BRANCH="${GIT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

if ! command -v inotifywait >/dev/null 2>&1; then
  echo "Missing dependency: inotifywait (install via 'sudo apt install inotify-tools')." >&2
  exit 1
fi

echo "Watching $REPO_DIR for changes..."
trap 'echo "Stopping watcher"; exit 0' INT TERM

while true; do
  inotifywait -qq -r -e modify,create,delete,move --exclude '/\\.git/' "$REPO_DIR"
  sleep "${DEBOUNCE_SECONDS:-2}"

  if git diff --quiet && git diff --cached --quiet; then
    continue
  fi

  git add -A
  if git diff --cached --quiet; then
    continue
  fi

  MESSAGE="${AUTO_COMMIT_MESSAGE:-Auto update: $(date --iso-8601=seconds)}"
  if git commit -m "$MESSAGE"; then
    git push "$REMOTE" "$BRANCH"
  fi

done
